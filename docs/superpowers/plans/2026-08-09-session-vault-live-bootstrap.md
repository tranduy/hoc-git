# Session Vault and Live Provider Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure Windows-local session vault, Fabet/manual-token configuration, 24-hour renewal, trusted-domain handling, redacted session health, and a read-only provider-launch bootstrap UI.

**Architecture:** Keep secrets entirely inside the loopback API. A DPAPI-backed vault persists encrypted records, a session manager owns lifecycle and renewal, and an isolated Playwright profile performs Fabet login and provider launch discovery. The React client submits secrets once and receives only strict redacted status contracts.

**Tech Stack:** TypeScript 5.9, Node.js, Windows DPAPI through a constant PowerShell helper fed over stdin, Fastify 5, Zod, Playwright, React 19, Vitest, Testing Library.

## Global Constraints

- Never place credentials, cookies, tokens, authorization headers, or complete launch URLs in source, fixtures, logs, API responses, test snapshots, or command arguments.
- `fabet.com` is only a discovery hint; Fabet login must also accept a directly entered reachable HTTPS URL.
- A redirect hostname must receive exact one-time trust approval before credentials are transmitted; no wildcard trust and no HTTP downgrade.
- Manual provider tokens, cookie bundles, and launch URLs work without Fabet and remain usable when Fabet is unreachable.
- Force renewal at `acquiredAt + 86_400_000` milliseconds and immediately after authenticated rejection.
- During validation or renewal, the corresponding provider adapter and its quotes are ineligible.
- Reset requires a visible confirmation and removes Fabet secrets, trusted Fabet hosts, in-memory handles, and the Fabet browser profile.
- This plan is read-only. It must not click a final bet button, call a wager endpoint, or spend the development account balance.
- Any future wager requires a new operator confirmation immediately before every external submission, including each hedge leg.

---

## File structure

```text
packages/contracts/src/
  domain.ts                         redacted public session types
  schemas.ts                        strict public session schemas
apps/api/src/sessions/
  types.ts                          secret-side interfaces and error codes
  dpapi-protector.ts                Windows DPAPI process adapter
  secret-vault.ts                   atomic encrypted persistence
  trusted-domain-store.ts           exact hostname approvals
  domain-discovery.ts               credential-free redirect discovery
  validators.ts                     provider validator registry
  session-manager.ts                lifecycle, validation, renewal, reset
  fabet-browser.ts                  isolated Playwright login/launch capture
apps/api/src/routes/
  sessions.ts                       loopback session endpoints
apps/web/src/api/
  sessions.ts                       secret write commands and status reads
apps/web/src/pages/
  sessions-page.tsx                 login/manual-token/status/reset UI
docs/operator/
  live-session-setup.md             VPN, direct-token, reset, and safety guide
```

### Task 1: Redacted session contracts

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/schemas.test.ts`

**Interfaces:**
- Consumes: existing Zod and strict-object conventions.
- Produces: `SessionSource`, `SessionState`, `SessionHealthReason`, `RedactedSessionStatus`, `SessionStatusList`, `RedactedSessionStatusSchema`, and `SessionStatusListSchema`.

- [ ] **Step 1: Write failing schema tests**

```ts
it("accepts redacted session status without a secret", () => {
  expect(RedactedSessionStatusSchema.parse({
    id: "session-1",
    provider: "SABA",
    source: "MANUAL_PROVIDER_SESSION",
    state: "ACTIVE",
    trustedHostname: "example.test",
    acquiredAtMs: 1_000,
    lastValidatedAtMs: 2_000,
    renewAfterMs: 86_401_000,
    secretConfigured: true,
    reason: null
  })).toBeDefined();
});

it.each(["token", "cookie", "authorization", "launchUrl", "password"])(
  "rejects secret-shaped field %s",
  (key) => expect(RedactedSessionStatusSchema.safeParse({
    id: "session-1", provider: "SABA", source: "MANUAL_PROVIDER_SESSION",
    state: "ACTIVE", trustedHostname: null, acquiredAtMs: 1,
    lastValidatedAtMs: 1, renewAfterMs: 86_400_001,
    secretConfigured: true, reason: null, [key]: "canary-secret"
  }).success).toBe(false)
);
```

- [ ] **Step 2: Run the contract test and record the missing-export failure**

Run: `npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts`

Expected: FAIL because `RedactedSessionStatusSchema` is not exported.

- [ ] **Step 3: Add the exact public types and strict schemas**

```ts
export type SessionSource = "FABET_LOGIN" | "MANUAL_PROVIDER_SESSION";
export type SessionState = "UNCONFIGURED" | "VALIDATING" | "ACTIVE" | "RENEWING" | "ACTION_REQUIRED" | "INVALID";
export type SessionHealthReason =
  | "UNREACHABLE" | "DOMAIN_APPROVAL_REQUIRED" | "UNAUTHORIZED"
  | "EXPIRED" | "SCHEMA_CHANGED" | "VAULT_UNAVAILABLE" | "RESET_FAILED";

export interface RedactedSessionStatus {
  readonly id: string;
  readonly provider: string;
  readonly source: SessionSource;
  readonly state: SessionState;
  readonly trustedHostname: string | null;
  readonly acquiredAtMs: number | null;
  readonly lastValidatedAtMs: number | null;
  readonly renewAfterMs: number | null;
  readonly secretConfigured: boolean;
  readonly reason: SessionHealthReason | null;
}

export interface SessionStatusList {
  readonly sessions: readonly RedactedSessionStatus[];
}
```

Use `z.strictObject`, nonempty IDs/providers, finite nonnegative timestamps, and a refinement requiring `renewAfterMs >= acquiredAtMs` when both exist.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts`

Run: `npm.cmd run typecheck --workspace @tool-chenh/contracts`

Expected: both PASS.

- [ ] **Step 5: Commit the contract**

```powershell
git add packages/contracts/src/domain.ts packages/contracts/src/schemas.ts packages/contracts/src/index.ts packages/contracts/src/schemas.test.ts
git commit -m "feat: define redacted session contracts"
```

### Task 2: DPAPI protector and atomic secret vault

**Files:**
- Create: `apps/api/src/sessions/types.ts`
- Create: `apps/api/src/sessions/dpapi-protector.ts`
- Create: `apps/api/src/sessions/secret-vault.ts`
- Test: `apps/api/src/sessions/secret-vault.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `SecretProtector { protect(clear): Promise<Uint8Array>; unprotect(cipher): Promise<Uint8Array> }`.
- Produces: `SecretVault.save(id, secret)`, `SecretVault.load(id)`, `SecretVault.delete(id)`, `SecretVault.has(id)`, and `SecretVault.listIds()`.

- [ ] **Step 1: Write vault tests with an injected reversible test protector**

```ts
const protector: SecretProtector = {
  protect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x5a),
  unprotect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x5a)
};

it("persists only ciphertext and survives reconstruction", async () => {
  const first = new SecretVault({ directory, protector });
  await first.save("fabet", { username: "secret-user", password: "secret-pass" });
  expect(await readFile(join(directory, "vault.v1.json"), "utf8")).not.toContain("secret-");
  const second = new SecretVault({ directory, protector });
  expect(await second.load("fabet")).toEqual({ username: "secret-user", password: "secret-pass" });
});
```

Add cases for atomic replacement, unknown ID, corrupt ciphertext returning `VAULT_UNAVAILABLE`, delete, and redacted error messages.

- [ ] **Step 2: Run the focused test and record failure**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/secret-vault.test.ts`

Expected: FAIL because the vault files do not exist.

- [ ] **Step 3: Implement the vault and Windows protector**

Use the versioned disk envelope:

```ts
interface VaultFileV1 {
  readonly version: 1;
  readonly records: Readonly<Record<string, { readonly ciphertextBase64: string }>>;
}
```

`DpapiProtector` must spawn `powershell.exe -NoProfile -NonInteractive -Command <constant script>`, write base64 input through stdin, and return base64 output. The constant script calls `[Security.Cryptography.ProtectedData]::Protect` or `Unprotect` with `CurrentUser`. No secret may appear in process arguments or errors. Write `vault.v1.json.tmp`, flush/close it, and rename it to `vault.v1.json`.

Add `.auth/`, `browser-profiles/`, `*.vault.json`, and `vault.v1.json*` to `.gitignore` if absent.

- [ ] **Step 4: Run focused tests, API typecheck, and canary scan**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/secret-vault.test.ts`

Run: `npm.cmd run typecheck --workspace @tool-chenh/api`

Run: `rg -n "secret-user|secret-pass" apps packages fixtures docs -g "!*.test.ts"`

Expected: tests/typecheck PASS and canary scan has no output.

- [ ] **Step 5: Commit the vault**

```powershell
git add .gitignore apps/api/src/sessions/types.ts apps/api/src/sessions/dpapi-protector.ts apps/api/src/sessions/secret-vault.ts apps/api/src/sessions/secret-vault.test.ts
git commit -m "feat: add Windows encrypted session vault"
```

### Task 3: Credential-free domain discovery and exact trust

**Files:**
- Create: `apps/api/src/sessions/trusted-domain-store.ts`
- Create: `apps/api/src/sessions/domain-discovery.ts`
- Test: `apps/api/src/sessions/domain-discovery.test.ts`

**Interfaces:**
- Consumes: `SecretVault`, injected `fetch`, and an injected clock.
- Produces: `DomainDiscovery.discover(entryUrl)`, `TrustedDomainStore.approve(hostname)`, `isTrusted(hostname)`, and `resetFabetHosts()`.

- [ ] **Step 1: Write failing trust and redirect tests**

```ts
it("discovers redirects without forwarding credentials", async () => {
  const seen: RequestInit[] = [];
  const discovery = new DomainDiscovery({
    fetch: async (_url, init) => {
      seen.push(init ?? {});
      return Response.redirect("https://fabet.party/", 302);
    }
  });
  const result = await discovery.discover("https://fabet.com/");
  expect(result.finalHostname).toBe("fabet.party");
  expect(result.trusted).toBe(false);
  expect(JSON.stringify(seen)).not.toMatch(/authorization|cookie|password/i);
});
```

Add exact-host approval, sibling-host rejection, URL userinfo rejection, non-HTTPS rejection, redirect loop/cap, TLS/fetch failure classification, and encrypted persistence tests.

- [ ] **Step 2: Run the focused test and record failure**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/domain-discovery.test.ts`

Expected: FAIL because discovery and trust stores do not exist.

- [ ] **Step 3: Implement strict discovery and trust**

`discover` accepts only an HTTPS URL without username/password, follows at most five redirects manually, sends no custom headers/body, and returns:

```ts
interface DomainDiscoveryResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly finalHostname: string;
  readonly trusted: boolean;
}
```

Store approved hostnames as a DPAPI-protected record named `trusted-fabet-hosts`; compare normalized ASCII hostnames exactly.

- [ ] **Step 4: Run focused tests and API typecheck**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/domain-discovery.test.ts`

Run: `npm.cmd run typecheck --workspace @tool-chenh/api`

Expected: PASS.

- [ ] **Step 5: Commit domain safety**

```powershell
git add apps/api/src/sessions/trusted-domain-store.ts apps/api/src/sessions/domain-discovery.ts apps/api/src/sessions/domain-discovery.test.ts
git commit -m "feat: require trust for redirected login domains"
```

### Task 4: Session lifecycle, direct tokens, and 24-hour renewal

**Files:**
- Create: `apps/api/src/sessions/validators.ts`
- Create: `apps/api/src/sessions/session-manager.ts`
- Test: `apps/api/src/sessions/session-manager.test.ts`

**Interfaces:**
- Consumes: vault, domain store, `SessionValidator`, `FabetSessionDriver`, injected wall clock, and `setTimeout` scheduler.
- Produces: `configureFabet`, `configureManual`, `validate`, `renew`, `listStatuses`, `resetFabet`, and `getActiveSecretHandle`.

- [ ] **Step 1: Write lifecycle tests with unchanged fake time**

```ts
it("forces one renewal at the 24-hour boundary", async () => {
  await manager.configureManual({ provider: "SABA", kind: "TOKEN", secret: "canary" });
  clock.wallClockNowMs = 86_400_000;
  await Promise.all([manager.tick(), manager.tick(), manager.tick()]);
  expect(validator.renewCalls).toBe(1);
  expect(manager.listStatuses().sessions[0]?.state).toBe("ACTIVE");
});
```

Add tests for Fabet unreachability not affecting a direct SABA session, unauthorized forcing renewal, non-refreshable manual material becoming `ACTION_REQUIRED`, validation/renewal hiding the active handle, secret never appearing in status/errors, and reset clearing only Fabet-owned sessions.

- [ ] **Step 2: Run the focused test and record failure**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/session-manager.test.ts`

Expected: FAIL because the manager is missing.

- [ ] **Step 3: Implement validator registry and serialized lifecycle**

```ts
export interface SessionValidator {
  readonly provider: string;
  validate(secret: ProviderSecret): Promise<{ ok: true } | { ok: false; reason: SessionHealthReason }>;
  renew?(secret: ProviderSecret): Promise<ProviderSecret>;
}

export interface ActiveSecretHandle {
  readonly sessionId: string;
  readonly provider: string;
  withSecret<T>(consume: (secret: ProviderSecret) => Promise<T>): Promise<T>;
}
```

Maintain one in-flight promise per session ID. Never serialize `ProviderSecret` into status. Set `renewAfterMs` from acquisition time, not the last health check. A rejected validation immediately withdraws the active handle before renewal begins.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/session-manager.test.ts`

Run: `npm.cmd run typecheck --workspace @tool-chenh/api`

Expected: PASS.

- [ ] **Step 5: Commit lifecycle management**

```powershell
git add apps/api/src/sessions/validators.ts apps/api/src/sessions/session-manager.ts apps/api/src/sessions/session-manager.test.ts
git commit -m "feat: manage direct and renewable provider sessions"
```

### Task 5: Isolated Fabet browser login and launch capture

**Files:**
- Create: `apps/api/src/sessions/fabet-browser.ts`
- Test: `apps/api/src/sessions/fabet-browser.test.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: a trusted final URL, credentials via `withSecret`, isolated profile path, and injected Playwright browser factory.
- Produces: `FabetBrowserDriver.login`, `captureLobbyLaunches`, `validateAuthenticatedSession`, and `resetProfile`.

- [ ] **Step 1: Write a fake-site browser test**

Create an in-test local site exposing a login form and both lobby routes. The fake launcher opens a second origin with a canary query token. Assert:

```ts
const launches = await driver.captureLobbyLaunches();
expect(launches.map((item) => item.category)).toEqual(["FOOTBALL", "LOL"]);
expect(JSON.stringify(driver.redactedDiagnostics())).not.toContain("launch-canary");
expect(await vault.load(launches[0]!.vaultRecordId)).toMatchObject({ kind: "LAUNCH_URL" });
```

Also assert the driver does not click any element whose accessible name matches `/bet|đặt cược|xác nhận cược/i`.

- [ ] **Step 2: Run the focused test and record failure**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/fabet-browser.test.ts`

Expected: FAIL because the browser driver is missing.

- [ ] **Step 3: Add Playwright and implement the browser driver**

Run: `npm.cmd install playwright --workspace @tool-chenh/api`

Launch a persistent context under `.auth/browser-profiles/fabet`, block downloads, and use the trusted final origin. Fill username/password only after `TrustedDomainStore.isTrusted(page.url().hostname)` succeeds. Visit both exact lobby paths after authentication. Treat cross-origin popup/frame navigations and authenticated launch responses as secret candidates; store raw material immediately in the vault and retain only provider hint, category, host, capture time, and vault ID in memory.

Do not infer CMD/SABA/SBOBET/APSPORT/BTI/IM from artwork alone. Unknown candidates remain `ACTION_REQUIRED` until a validator proves provider identity and read-only event access.

- [ ] **Step 4: Run browser test, API tests, and typecheck**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/fabet-browser.test.ts`

Run: `npm.cmd run typecheck --workspace @tool-chenh/api`

Expected: PASS without network access to production Fabet.

- [ ] **Step 5: Commit browser bootstrap**

```powershell
git add apps/api/package.json package-lock.json apps/api/src/sessions/fabet-browser.ts apps/api/src/sessions/fabet-browser.test.ts
git commit -m "feat: capture Fabet provider launch sessions"
```

### Task 6: Loopback session API and runtime wiring

**Files:**
- Create: `apps/api/src/routes/sessions.ts`
- Test: `apps/api/src/routes/sessions.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `SessionManager` and strict private request schemas.
- Produces: `GET /api/sessions`, Fabet discovery/trust/configure, manual configure, validate, renew, and confirmed reset endpoints.

- [ ] **Step 1: Write route security tests**

Cover exact origin, `Cache-Control: no-store`, body-size cap, no GET/query secret input, strict unknown-field rejection, redacted responses, and reset confirmation:

```ts
const cancelled = await app.inject({
  method: "POST", url: "/api/sessions/fabet/reset",
  headers: { origin: "http://127.0.0.1:4311" },
  payload: { confirmation: "NO" }
});
expect(cancelled.statusCode).toBe(400);
expect(manager.resetCalls).toBe(0);
```

- [ ] **Step 2: Run route tests and record failure**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/routes/sessions.test.ts`

Expected: FAIL because routes are not registered.

- [ ] **Step 3: Implement strict local endpoints**

Register:

```text
GET  /api/sessions
POST /api/sessions/fabet/discover
POST /api/sessions/fabet/trust
POST /api/sessions/fabet/configure
POST /api/sessions/manual
POST /api/sessions/:id/validate
POST /api/sessions/:id/renew
POST /api/sessions/fabet/reset   body confirmation must equal RESET_FABET
```

Expand CORS methods to `GET, POST`, retain exact local origin, set a 32 KiB body limit, and add per-route throttling through an injected limiter. Construct production vault paths from `LOCALAPPDATA`, fail startup with a redacted message when unavailable, and keep fixture mode session-free.

- [ ] **Step 4: Run API suite, typecheck, and serializer canary test**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run`

Run: `npm.cmd run typecheck --workspace @tool-chenh/api`

Expected: PASS; test output and response payloads contain no secret canary.

- [ ] **Step 5: Commit the API**

```powershell
git add apps/api/src/routes/sessions.ts apps/api/src/routes/sessions.test.ts apps/api/src/app.ts apps/api/src/server.ts
git commit -m "feat: expose secure local session management API"
```

### Task 7: Sessions UI with manual token and confirmed reset

**Files:**
- Create: `apps/web/src/api/sessions.ts`
- Create: `apps/web/src/pages/sessions-page.tsx`
- Test: `apps/web/src/pages/sessions-page.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: session API and redacted session contracts.
- Produces: `/sessions` navigation, Fabet/manual forms, health table, validate/renew actions, domain approval, and reset dialog.

- [ ] **Step 1: Write user-flow tests**

```tsx
it("clears secret inputs and requires exact reset confirmation", async () => {
  render(<SessionsPage api={api} />);
  await user.type(screen.getByLabelText("Provider token or launch URL"), "ui-canary");
  await user.click(screen.getByRole("button", { name: "Save and validate" }));
  expect(screen.getByLabelText("Provider token or launch URL")).toHaveValue("");
  expect(screen.queryByText("ui-canary")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reset Fabet session" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("credential, token, trusted domains, and browser session");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api.resetFabet).not.toHaveBeenCalled();
});
```

Add tests for domain approval showing the exact hostname, Fabet unreachable while manual entry remains enabled, token-only `ACTION_REQUIRED`, 24-hour renewal display, keyboard focus trapping, and error messages without secret values.

- [ ] **Step 2: Run the focused web test and record failure**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/pages/sessions-page.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement the page and API client**

Add a `Sessions` route. Use password inputs for password/token, `autocomplete="off"` for token/launch material, and never initialize fields from server data. Render provider, source, state, trusted host, last validation, next renewal, and a plain-language reason. The reset dialog has `Cancel` and destructive `Reset everything` buttons; confirmation calls the API only from `Reset everything`.

- [ ] **Step 4: Run web tests, typecheck, and production build**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run`

Run: `npm.cmd run typecheck --workspace @tool-chenh/web`

Run: `npm.cmd run build --workspace @tool-chenh/web`

Expected: PASS.

- [ ] **Step 5: Commit the UI**

```powershell
git add apps/web/src/api/sessions.ts apps/web/src/pages/sessions-page.tsx apps/web/src/pages/sessions-page.test.tsx apps/web/src/app.tsx apps/web/src/styles.css
git commit -m "feat: add persistent provider session controls"
```

### Task 8: End-to-end safety, operator guide, and read-only live gate

**Files:**
- Create: `tests/integration/session-bootstrap.test.ts`
- Create: `docs/operator/live-session-setup.md`
- Modify: `.env.example`
- Modify: `docs/superpowers/plans/2026-08-09-session-vault-live-bootstrap.md`

**Interfaces:**
- Consumes: completed local API/UI/session subsystem.
- Produces: restart persistence proof, Fabet-outage/direct-token proof, secret scan, reset proof, and a live-read-only checklist.

- [ ] **Step 1: Write the cross-process integration test**

Start the fake HTTPS redirect/login/launcher services and local API with a temporary `LOCALAPPDATA`. Configure Fabet, approve the redirected hostname, login, capture launches, stop/restart the API, and assert the session reconnects without re-entry. Then stop the fake Fabet service, configure a direct provider token, and assert that provider validation remains independent.

- [ ] **Step 2: Run the integration test and record failure before final wiring**

Run: `npm.cmd run test:integration -- --run tests/integration/session-bootstrap.test.ts`

Expected: FAIL until all production constructors and cleanup hooks are connected.

- [ ] **Step 3: Complete cleanup wiring and write operator documentation**

Document:

- starting the local API/web stack;
- using a reachable redirected Fabet URL when VPN/WARP is active;
- entering a manual provider token when Fabet is unreachable;
- approving only the exact hostname visible in the browser;
- interpreting `ACTIVE`, `RENEWING`, `ACTION_REQUIRED`, and `INVALID`;
- the 24-hour forced-renewal rule;
- reset scope and confirmation;
- the fact that login/launch capture does not yet prove real odds ingestion for CMD, SABA, SBOBET, APSPORT, BTI, or IM;
- prohibition on betting during this milestone.

Add only non-secret path/config examples to `.env.example`.

- [ ] **Step 4: Run complete verification and secret scans**

Run: `npm.cmd run verify`

Run: `npm.cmd run build`

Run: `npm.cmd run test:e2e`

Run: `git grep -n -E "ui-canary|launch-canary|secret-user|secret-pass" -- ':!**/*.test.ts' ':!docs/superpowers/plans/**'`

Run: `git diff --check`

Expected: all verification commands PASS; production secret scan has no output; diff check passes.

- [ ] **Step 5: Perform the operator-controlled live read-only gate**

With the operator's VPN/WARP state and development credential entered through the new UI, verify login, final trusted hostname, both lobby visits, at least one captured launch candidate, session age/renewal display, application restart persistence, and confirmed reset. Do not click a bet control or call a wager endpoint. If a CAPTCHA appears, stop for the operator.

- [ ] **Step 6: Commit the verified feature**

```powershell
git add tests/integration/session-bootstrap.test.ts docs/operator/live-session-setup.md .env.example docs/superpowers/plans/2026-08-09-session-vault-live-bootstrap.md
git commit -m "test: verify secure live session bootstrap"
```
