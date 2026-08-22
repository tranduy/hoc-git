# Automatic Session Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically rediscover the current Fabet mirror from `https://fabet.com`, authenticate with encrypted credentials, and refresh dependent read-only provider sessions without routing provider traffic through the authentication tunnel or leaking browser processes.

**Architecture:** Add a portable authentication-egress boundary with direct, configured proxy, and local WARP-SOCKS implementations. Run Fabet discovery/login in a temporary egress-scoped browser, persist encrypted authentication state, then reopen the verified mirror in a direct persistent browser and atomically validate/publish provider launches. Session recovery is single-flight, reason-driven, bounded by backoff, and independent from CMD.

**Tech Stack:** TypeScript 5.9, Node.js 22, Playwright 1.55, Fastify, Zod contracts, Vitest, Windows DPAPI, Cloudflare WARP CLI adapter.

## Global Constraints

- Every authentication cycle starts at exactly `https://fabet.com/`; a stored mirror is never the next cycle's entry point.
- Credentials, cookies, storage state, and launch tokens must never appear in source, `.env`, localStorage, URLs, screenshots, stdout, or public API responses.
- CMD remains independent; Fabet recovery must not restart, invalidate, or delay CMD.
- Only explicit authentication evidence can trigger login. Empty catalogs, schema diagnostics, suspension, and ordinary timeouts cannot.
- Authentication egress is restricted to root discovery/login. Provider launch and catalog traffic must be direct.
- At most one authentication and one provider-launch transaction may run per credential source.
- All temporary contexts/pages close in `finally`; shutdown cancels recovery and closes owned processes.
- This feature is read-only and cannot submit a bet.
- Preserve all unrelated dirty-worktree changes. Stage only feature-specific hunks/files.

---

## File Structure

- Create `apps/api/src/sessions/auth-egress.ts`: portable egress contracts and direct/configured-proxy implementations.
- Create `apps/api/src/sessions/warp-socks-egress.ts`: bounded WARP proxy-mode lease behind an injectable CLI.
- Create `apps/api/src/sessions/fabet-origin-attestation.ts`: validate redirected origin and Fabet page/API identity before credential use.
- Create `apps/api/src/sessions/session-recovery-policy.ts`: auth-failure classification, backoff, and retry state.
- Modify `apps/api/src/sessions/fabet-browser.ts`: split temporary authentication browser from direct provider browser and export/import encrypted state.
- Modify `apps/api/src/sessions/session-manager.ts`: credential-source recovery transaction and single-flight provider refresh.
- Modify `apps/api/src/sessions/session-services.ts`: choose available egresses and wire cleanup without making WARP mandatory.
- Modify `packages/contracts/src/domain.ts` and `packages/contracts/src/schemas.ts`: expose precise recovery reasons and retry time.
- Modify `apps/api/src/routes/sessions.ts` and `apps/web/src/pages/sessions-page.tsx`: accept root-only Fabet configuration and show actionable status without secrets.
- Add focused tests beside every module and one read-only integration test under `tests/integration`.

---

### Task 1: Recovery Contracts and Failure Policy

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Modify: `packages/contracts/src/schemas.test.ts`
- Create: `apps/api/src/sessions/session-recovery-policy.ts`
- Create: `apps/api/src/sessions/session-recovery-policy.test.ts`

**Interfaces:**
- Produces: `SessionHealthReason` values `AUTH_EGRESS_UNAVAILABLE`, `INTERACTIVE_AUTH_REQUIRED`, `AUTH_BACKOFF`, `PROVIDER_VALIDATION_FAILED`.
- Produces: `RedactedSessionStatus.nextRetryAtMs: number | null`.
- Produces:

```ts
export type RecoverySignal =
  | { readonly kind: "AUTH_EXPIRED"; readonly status?: 401 | 403 }
  | { readonly kind: "LOGIN_PAGE" }
  | { readonly kind: "TOKEN_EXPIRED"; readonly expiredAtMs: number }
  | { readonly kind: "EMPTY_CATALOG" }
  | { readonly kind: "SCHEMA_ERROR" }
  | { readonly kind: "TIMEOUT" };

export function requiresAuthentication(signal: RecoverySignal, nowMs: number): boolean;
export function recoveryDelayMs(consecutiveFailures: number, jitterUnit: number): number;
```

- [ ] **Step 1: Write contract and policy tests that fail**

Add schema assertions for the four new reasons and nullable retry timestamp. Add table tests proving only `AUTH_EXPIRED`, `LOGIN_PAGE`, and an elapsed `TOKEN_EXPIRED` require login. Assert backoff bases of 5s, 15s, 60s, and 300s, with `jitterUnit=0` producing the base exactly and attempts above four capped at 300s.

- [ ] **Step 2: Run the focused tests and record RED**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/session-recovery-policy.test.ts
```

Expected: failures because the reasons, field, and policy module do not exist.

- [ ] **Step 3: Add the minimal contracts and pure policy**

Implement `requiresAuthentication` as an exhaustive switch. Implement capped backoff without timers or mutable global state:

```ts
const bases = [5_000, 15_000, 60_000, 300_000] as const;
const base = bases[Math.min(consecutiveFailures, bases.length - 1)]!;
return Math.round(base * (1 + Math.max(0, Math.min(1, jitterUnit)) * 0.2));
```

Update every existing redacted status fixture with `nextRetryAtMs: null`.

- [ ] **Step 4: Run focused tests and typechecks**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/session-recovery-policy.test.ts
npm.cmd run typecheck --workspace @tool-chenh/contracts
npm.cmd run typecheck --workspace @tool-chenh/api
```

Expected: all pass.

- [ ] **Step 5: Commit only Task 1 hunks**

```powershell
git add -p packages/contracts/src/domain.ts packages/contracts/src/schemas.ts packages/contracts/src/schemas.test.ts
git add apps/api/src/sessions/session-recovery-policy.ts apps/api/src/sessions/session-recovery-policy.test.ts
git commit -m "feat: define session recovery policy"
```

---

### Task 2: Portable Authentication Egress

**Files:**
- Create: `apps/api/src/sessions/auth-egress.ts`
- Create: `apps/api/src/sessions/auth-egress.test.ts`
- Create: `apps/api/src/sessions/warp-socks-egress.ts`
- Create: `apps/api/src/sessions/warp-socks-egress.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AuthEgressLease {
  readonly name: string;
  readonly playwrightProxy: { readonly server: string } | null;
  release(): Promise<void>;
}

export interface AuthEgress {
  readonly name: string;
  acquire(signal: AbortSignal): Promise<AuthEgressLease>;
}

export class DirectAuthEgress implements AuthEgress {}
export class ConfiguredProxyAuthEgress implements AuthEgress {
  constructor(proxyUrl: string);
}

export interface WarpCli {
  status(): Promise<{ readonly connected: boolean; readonly mode: string }>;
  setMode(mode: "proxy" | "warp" | "doh" | "warp+doh" | "dot" | "warp+dot" | "tunnel_only"): Promise<void>;
  setProxyPort(port: number): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export class WarpSocksAuthEgress implements AuthEgress {
  constructor(input: { readonly cli: WarpCli; readonly port: number; readonly leasePath: string });
}
```

- [ ] **Step 1: Write failing egress tests**

Test HTTPS/SOCKS/HTTP proxy URL validation, direct leases with `playwrightProxy=null`, WARP acquisition ordering (`status -> setMode(proxy) -> setProxyPort -> connect`), concurrent acquisition sharing one lease, idempotent release, restoration of only state changed by the adapter, abort behavior, and recovery of a stale lease file.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/auth-egress.test.ts src/sessions/warp-socks-egress.test.ts
```

Expected: module-not-found failures.

- [ ] **Step 3: Implement direct/configured proxy and WARP lease**

Use `spawn("warp-cli.exe", ...)` only inside the concrete CLI adapter. Pass arguments as an array, hide the window, cap stdout/stderr, enforce a 10-second command timeout, and redact command failures. Write the lease atomically with only `{version, ownerPid, originalMode, originalConnected, port, acquiredAtMs}`. Never store credentials or URLs in it.

- [ ] **Step 4: Run focused tests and API typecheck**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/auth-egress.test.ts src/sessions/warp-socks-egress.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
```

Expected: pass without invoking the real WARP CLI.

- [ ] **Step 5: Commit Task 2 files**

```powershell
git add apps/api/src/sessions/auth-egress.ts apps/api/src/sessions/auth-egress.test.ts apps/api/src/sessions/warp-socks-egress.ts apps/api/src/sessions/warp-socks-egress.test.ts
git commit -m "feat: add portable authentication egress"
```

---

### Task 3: Browser Redirect Attestation and Split Network Phases

**Files:**
- Create: `apps/api/src/sessions/fabet-origin-attestation.ts`
- Create: `apps/api/src/sessions/fabet-origin-attestation.test.ts`
- Modify: `apps/api/src/sessions/fabet-browser.ts`
- Modify: `apps/api/src/sessions/fabet-browser.test.ts`

**Interfaces:**
- Consumes: `AuthEgress`, `AuthEgressLease` from Task 2.
- Produces:

```ts
export interface FabetOriginEvidence {
  readonly entryUrl: "https://fabet.com/";
  readonly finalUrl: string;
  readonly finalHostname: string;
  readonly loginFormPresent: boolean;
  readonly lobbyPresent: boolean;
  readonly sameOriginApiObserved: boolean;
}

export function attestFabetOrigin(evidence: FabetOriginEvidence): { readonly finalUrl: string; readonly finalHostname: string };

export interface FabetAuthenticationResult {
  readonly finalUrl: string;
  readonly finalHostname: string;
  readonly encryptedStateId: string;
}
```

- [ ] **Step 1: Write attestation and split-route tests**

Reject HTTP, URL credentials, IP literals, unrelated redirects, missing Fabet controls, error/captive pages, and no same-origin API evidence. In browser automation tests, assert the authentication context receives the egress proxy, is closed before direct context creation, the direct context receives no proxy option, and `login` always navigates to `https://fabet.com/` regardless of stored/configured mirror.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/fabet-origin-attestation.test.ts src/sessions/fabet-browser.test.ts
```

Expected: attestation module is missing and existing login accepts arbitrary entry URLs.

- [ ] **Step 3: Implement browser attestation and phase split**

Refactor the automation boundary to:

```ts
authenticate(input: {
  readonly rootUrl: "https://fabet.com/";
  readonly username: string;
  readonly password: string;
  readonly egress: AuthEgress;
  readonly signal: AbortSignal;
}): Promise<FabetAuthenticationResult>;

openDirectAuthenticatedLobby(input: {
  readonly authentication: FabetAuthenticationResult;
  readonly signal: AbortSignal;
}): Promise<void>;
```

Encrypt exported storage state through `SecretVault`; never write clear JSON to disk. Close the temporary context and release its egress lease in nested `finally` blocks before opening the direct lobby. Keep provider page reuse/idle closing behavior intact.

- [ ] **Step 4: Run focused tests and resource regression tests**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/fabet-origin-attestation.test.ts src/sessions/fabet-browser.test.ts
npm.cmd test --workspace @tool-chenh/api -- --run src/providers/browser-resource-policy.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
```

Expected: all pass; proxy is absent from provider contexts.

- [ ] **Step 5: Commit Task 3 hunks**

```powershell
git add apps/api/src/sessions/fabet-origin-attestation.ts apps/api/src/sessions/fabet-origin-attestation.test.ts
git add -p apps/api/src/sessions/fabet-browser.ts apps/api/src/sessions/fabet-browser.test.ts
git commit -m "feat: attest and split Fabet authentication traffic"
```

---

### Task 4: Credential-Source Recovery Transaction

**Files:**
- Modify: `apps/api/src/sessions/types.ts`
- Modify: `apps/api/src/sessions/session-manager.ts`
- Modify: `apps/api/src/sessions/session-manager.test.ts`

**Interfaces:**
- Consumes: recovery policy from Task 1 and browser result from Task 3.
- Produces:

```ts
export interface FabetCredentialSource {
  readonly id: string;
  readonly priority: number;
  readonly rootUrl: "https://fabet.com/";
}

export interface SessionRecoveryRequest {
  readonly credentialSourceId: string;
  readonly providers: readonly ("SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI")[];
  readonly signal: RecoverySignal;
}

SessionManager.reportProviderFailure(request: SessionRecoveryRequest): Promise<RedactedSessionStatus>;
```

- [ ] **Step 1: Write failing recovery tests**

Cover: simultaneous failures share exactly one authentication call; CMD requests are rejected from this workflow; empty/schema/timeout signals never login; 401/403 and login-page signals do; refresh always supplies root URL; failed providers do not invalidate successful siblings; next retry time follows the policy; restart rehydrates encrypted credentials; second credential source remains isolated and priority ordered.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/session-manager.test.ts
```

Expected: `reportProviderFailure` and credential-source isolation assertions fail.

- [ ] **Step 3: Implement source-level single-flight and atomic child replacement**

Replace the hard-coded `#fabetRehydration` with a map keyed by credential source. Keep successful old child sessions active until replacement validation succeeds. On failure, set only the source/provider concerned to stale/action-required and persist `nextRetryAtMs`; never delete the last verified launch preemptively.

- [ ] **Step 4: Run focused tests and API typecheck**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/session-manager.test.ts src/session-maintenance.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
```

Expected: all pass.

- [ ] **Step 5: Commit Task 4 hunks**

```powershell
git add -p apps/api/src/sessions/types.ts apps/api/src/sessions/session-manager.ts apps/api/src/sessions/session-manager.test.ts
git commit -m "feat: recover Fabet sessions transactionally"
```

---

### Task 5: Service Wiring, Provider Validation, and Automatic Triggers

**Files:**
- Modify: `apps/api/src/sessions/session-services.ts`
- Modify: `apps/api/src/sessions/session-services.test.ts`
- Modify: `apps/api/src/providers/multi-provider-catalog.ts`
- Modify: `apps/api/src/providers/multi-provider-catalog.test.ts`
- Modify: `apps/api/src/catalog/catalog-source-registry.ts`
- Modify: `apps/api/src/catalog/catalog-source-registry.test.ts`

**Interfaces:**
- Consumes: `AuthEgress[]` and `SessionManager.reportProviderFailure`.
- Produces: automatic auth-specific failure reports from provider reads and a validated provider replacement transaction.

- [ ] **Step 1: Write failing integration-style unit tests**

Assert egress ordering: direct, configured proxy when present, local WARP only when executable exists. Simulate provider results for 401, expired launch, empty catalog, schema error, and timeout. Prove only auth-specific failures call recovery. Prove validation requires a fresh successful catalog with matching provider/category and non-expired observation time. Prove one provider's recovery does not cancel CMD or healthy siblings.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/session-services.test.ts src/providers/multi-provider-catalog.test.ts src/catalog/catalog-source-registry.test.ts
```

Expected: no automatic recovery report and no portable egress selection.

- [ ] **Step 3: Wire egress selection and failure reporting**

Add optional configuration:

```ts
interface CreateSessionServicesOptions {
  readonly authProxyUrl?: string;
  readonly warpCliPath?: string;
  readonly enableLocalWarpAuth?: boolean;
}
```

Default to direct-only when WARP is absent. On the development machine, enable WARP adapter only after executable discovery; never fail API startup because it is missing. Provider readers report normalized auth signals but retain existing stale-snapshot behavior for non-auth failures.

- [ ] **Step 4: Run focused provider tests and typecheck**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/session-services.test.ts src/providers/multi-provider-catalog.test.ts src/catalog/catalog-source-registry.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
```

Expected: all pass.

- [ ] **Step 5: Commit Task 5 hunks**

```powershell
git add -p apps/api/src/sessions/session-services.ts apps/api/src/sessions/session-services.test.ts apps/api/src/providers/multi-provider-catalog.ts apps/api/src/providers/multi-provider-catalog.test.ts apps/api/src/catalog/catalog-source-registry.ts apps/api/src/catalog/catalog-source-registry.test.ts
git commit -m "feat: trigger provider session recovery"
```

---

### Task 6: Root-Only Configuration and Actionable Status UI

**Files:**
- Modify: `apps/api/src/routes/sessions.ts`
- Modify: `apps/api/src/routes/sessions.test.ts`
- Modify: `apps/web/src/api/sessions.ts`
- Modify: `apps/web/src/pages/sessions-page.tsx`
- Modify: `apps/web/src/pages/sessions-page.test.tsx`

**Interfaces:**
- Consumes: extended `RedactedSessionStatus`.
- Produces: Fabet configuration that accepts credentials only; root URL is server-owned and status includes reason/next retry without secrets.

- [ ] **Step 1: Write failing API/UI tests**

Assert the API ignores/rejects a client-supplied mirror and always configures `https://fabet.com/`. Assert status JSON contains no credential, cookie, token, launch URL, or browser state. Assert UI renders Vietnamese labels for refreshing, egress unavailable, CAPTCHA/OTP, provider validation failure, and next retry. Keep Reset with confirmation.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/routes/sessions.test.ts
npm.cmd test --workspace @tool-chenh/web -- --run src/pages/sessions-page.test.tsx
```

Expected: route still accepts entry URL/trusted hostname and UI lacks new statuses.

- [ ] **Step 3: Implement root-owned configuration and compact status copy**

Remove mirror/domain inputs from the request and UI. The server supplies `entryUrl: "https://fabet.com/"`; discovered hostname remains redacted status metadata only. Do not expose WARP controls to the operator.

- [ ] **Step 4: Run focused tests and typechecks**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/routes/sessions.test.ts
npm.cmd test --workspace @tool-chenh/web -- --run src/pages/sessions-page.test.tsx
npm.cmd run typecheck --workspace @tool-chenh/api
npm.cmd run typecheck --workspace @tool-chenh/web
```

Expected: pass.

- [ ] **Step 5: Commit Task 6 hunks**

```powershell
git add -p apps/api/src/routes/sessions.ts apps/api/src/routes/sessions.test.ts apps/web/src/api/sessions.ts apps/web/src/pages/sessions-page.tsx apps/web/src/pages/sessions-page.test.tsx
git commit -m "feat: expose automatic session recovery status"
```

---

### Task 7: Resource, Security, Restart, and Live Read-Only Verification

**Files:**
- Create: `tests/integration/automatic-session-recovery.test.ts`
- Modify: `apps/api/src/process-shutdown.test.ts`
- Modify: `scripts/automation-browser-cleanup.test.mjs`
- Modify: `.env.example`
- Modify: `proccess.md`

**Interfaces:**
- Consumes: complete automatic recovery stack.
- Produces: acceptance evidence and operator configuration documentation.

- [ ] **Step 1: Add failing cross-layer regressions**

Use fake browser/egress/provider implementations to verify one login for five simultaneous expiries, direct provider routing, encrypted restart recovery, bounded retries, abort/shutdown cleanup, and absence of secrets in logs/status. Add cleanup assertions that all owned PIDs/contexts close while unrelated user Chrome remains untouched.

- [ ] **Step 2: Run RED and close any uncovered gaps**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/process-shutdown.test.ts
npm.cmd run test:managed-stack
npm.cmd run test:integration -- --run tests/integration/automatic-session-recovery.test.ts
```

Expected: failures identify any missing shutdown/restart wiring; implement only the minimal missing wiring in the owning module and rerun until green.

- [ ] **Step 3: Document deployment knobs without secrets**

Add these optional settings to `.env.example` and `proccess.md`:

```dotenv
TOOL_CHENH_AUTH_PROXY_URL=
TOOL_CHENH_ENABLE_LOCAL_WARP_AUTH=false
TOOL_CHENH_WARP_CLI_PATH=
```

Document that server deployments normally use direct egress, local Windows development may enable WARP SOCKS, and no provider traffic uses auth egress.

- [ ] **Step 4: Run complete verification**

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration
npm.cmd run test:managed-stack
npm.cmd run build
git diff --check
```

Expected: all commands pass; no new unbounded browser/log artifact exists.

- [ ] **Step 5: Perform authorized read-only live acceptance**

With the development credential already encrypted in the vault, reset only the Fabet session, start the local stack, and record:

- navigation begins at `fabet.com`;
- direct failure falls through to local auth egress;
- current mirror is discovered and attested;
- login succeeds without exposing credentials;
- authentication browser closes;
- direct provider pages refresh;
- SABA, IM, SBOBET, APSPORT, and BTI each report either a fresh validated catalog or an exact provider-specific failure;
- CMD remains fresh throughout;
- process/browser counts return to the configured steady-state ceiling.

Do not click or submit any betting control.

- [ ] **Step 6: Commit final verification/docs hunks**

```powershell
git add tests/integration/automatic-session-recovery.test.ts .env.example proccess.md
git add -p apps/api/src/process-shutdown.test.ts scripts/automation-browser-cleanup.test.mjs
git commit -m "test: verify automatic session recovery"
```

---

## Inline execution record — 17/08/2026

- [x] Tasks 1–6 implemented and covered by focused contract/API/web tests.
- [x] Automatic maintenance is enabled by default; `SESSION_MAINTENANCE_ENABLED=0` is the explicit opt-out.
- [x] WARP `WarpProxy` status/port readiness and restoration are verified against the real Windows client.
- [x] In-flight renewal versus credential replacement race is covered; the newer encrypted credential always wins.
- [x] Authorized read-only live acceptance succeeded from canonical `fabet.com`: Fabet became `ACTIVE`, all six Football catalog sources registered `ACTIVE`, WARP returned to `Disconnected`, and no lease remained.
- [x] Full workspace typecheck, tests, integration tests, production build, managed-stack tests, and diff check passed.
- [x] Live recovery observed BTI expire and automatically restored all 6/6 Football sources; duplicate responsive lobby cards are now clicked once per provider and no longer logged individually.
- [ ] A second credential source remains intentionally pending until the operator supplies that account; the recovery model is already keyed by `credentialSourceId`.
