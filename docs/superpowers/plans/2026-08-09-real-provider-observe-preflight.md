# Real Provider Observe and Two-Leg Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed live CMD vertical slice with redacted account balances, upcoming Football/LoL market monitoring, and expiring two-account preflight tickets that cannot submit wagers.

**Architecture:** Extend the encrypted session layer with verified account metadata and provider capabilities, then feed a real provider adapter into the existing normalized Runtime/QuoteBook pipeline. A separate preflight service refreshes both accounts and both quotes concurrently and signs a short-lived proposal; no execution route exists.

**Tech Stack:** TypeScript, Zod, Fastify, React, Playwright, Vitest, decimal.js, Windows DPAPI.

## Global Constraints

- Never return or log raw tokens, cookies, launch URLs, passwords, or authorization headers.
- Unknown provider identity is always `ACTION_REQUIRED`.
- Production defaults to `LIVE`; fixtures require `FIXTURE_MODE=1`; modes cannot mix.
- Balance/profile freshness is 30 seconds; preflight ticket TTL is 3 seconds.
- No wager-submission API, UI control, provider method, or test exists in this milestone.
- Every provider failure and every incomplete preflight fails closed.

---

### Task 1: Account, profile, live-mode, movement, and preflight contracts

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Modify: `packages/contracts/src/schemas.test.ts`

**Interfaces:**
- Produces: `AccountProfile`, `AccountStatus`, `DataMode`, `QuoteMovement`, `PreflightRequest`, `PreflightLeg`, `PreflightTicket`, and strict Zod schemas.

- [ ] **Step 1: Write failing schema tests** proving strict rejection of token-like fields, exponent decimals, unknown providers, equal account IDs, missing balance timestamps, fixture/live ambiguity, and tickets above 3,000 ms.
- [ ] **Step 2: Run RED** with `npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts` and confirm missing exports/schema failures.
- [ ] **Step 3: Implement minimal strict types and schemas**. Public account shape must be:

```ts
interface AccountStatus {
  id: string; alias: string; provider: string;
  sessionState: SessionState; profileState: "FRESH"|"STALE"|"UNAVAILABLE";
  redactedLabel: string|null; currency: string|null; balance: string|null;
  balanceAsOfMs: number|null; capabilities: readonly ProviderCapability[];
  reason: SessionHealthReason|null;
}
```

`PreflightTicket` contains only canonical IDs, account IDs, odds/stakes/payouts, assumptions, issued/expiry times, nonce, and signature.
- [ ] **Step 4: Run GREEN**, contracts typecheck, and secret-name grep.
- [ ] **Step 5: Commit** with `feat: define live account and preflight contracts`.

### Task 2: Provider capability boundary and encrypted account registry

**Files:**
- Create: `apps/api/src/providers/provider-capabilities.ts`
- Create: `apps/api/src/accounts/account-registry.ts`
- Create: `apps/api/src/accounts/account-registry.test.ts`
- Modify: `apps/api/src/sessions/session-manager.ts`
- Modify: `apps/api/src/routes/sessions.ts`

**Interfaces:**
- Consumes: `AccountStatus` and existing `ActiveSecretHandle`.
- Produces: `ProviderProfileReader.readProfile(handle): Promise<ProviderProfile>` and `AccountRegistry.listStatuses()`.

- [ ] **Step 1: Write failing tests** for two accounts on one provider, alias persistence, provider-required direct tokens, redacted public output, 30-second profile expiry, restart recovery, and account-scoped reset.
- [ ] **Step 2: Run RED** and confirm the registry/reader interfaces do not exist.
- [ ] **Step 3: Implement encrypted account records** referencing session IDs without duplicating secrets. Registering a direct session requires `provider` and `alias`; captured launch sessions require a successful provider validator before account activation.
- [ ] **Step 4: Implement profile refresh** through `ActiveSecretHandle.withSecret`; normalize balance with `Decimal` and never retain response headers/bodies.
- [ ] **Step 5: Run GREEN**, API typecheck, vault round-trip and redaction tests.
- [ ] **Step 6: Commit** with `feat: add redacted provider account registry`.

### Task 3: Safe live protocol inspector and CMD identity proof

**Files:**
- Create: `apps/api/src/providers/protocol-inspector.ts`
- Create: `apps/api/src/providers/protocol-inspector.test.ts`
- Create: `apps/api/src/providers/cmd/cmd-identity.ts`
- Create: `apps/api/src/providers/cmd/cmd-identity.test.ts`
- Modify: `apps/api/src/sessions/fabet-browser.ts`

**Interfaces:**
- Produces: `ProtocolObservation { hostname, transport, method, pathTemplate, status, contentType, bodyShapeHash, observedAtMs }` and `CmdIdentityResult`.

- [ ] **Step 1: Write failing tests** that bind popup labels at click time, ignore iframe/analytics/live-chat navigation, collapse redirects, redact query/fragment/header/body values, and reject CMD identity based only on hostname.
- [ ] **Step 2: Run RED** and record the false-CMD/live-chat regression.
- [ ] **Step 3: Implement browser observation** for top-level provider pages and their fetch/XHR/WebSocket metadata. Store only method, host, path template, transport, status/content type, and structural hashes; never values.
- [ ] **Step 4: Implement CMD identity proof** requiring compatible launch provenance plus protocol fingerprints from at least two independent signals.
- [ ] **Step 5: Add a local read-only smoke command** that consumes an encrypted launch handle and prints only `ProtocolObservation` records. It must contain no navigation click beyond the already allowlisted launcher and no wager selector.
- [ ] **Step 6: Run GREEN**, inspect output for secret leakage, and commit `feat: inspect and identify CMD protocol safely`.

### Task 4: CMD profile and catalog adapter

**Files:**
- Create: `packages/adapters/src/cmd/cmd-client.ts`
- Create: `packages/adapters/src/cmd/cmd-normalizer.ts`
- Create: `packages/adapters/src/cmd/cmd-adapter.ts`
- Create: `packages/adapters/src/cmd/cmd-adapter.test.ts`
- Modify: `packages/adapters/src/index.ts`

**Interfaces:**
- Consumes: verified CMD session material and protocol fixture envelopes captured by Task 3.
- Produces: `ProviderProfileReader` plus existing `ProviderAdapter` events/markets/quote updates for Football and LoL.

- [ ] **Step 1: Create sanitized protocol fixtures** with canary tokens and write failing tests for profile/balance, pagination, prematch/live events, market suspension/deletion, quote sequences, reconnect, and schema drift.
- [ ] **Step 2: Run RED** and confirm no CMD adapter exists.
- [ ] **Step 3: Implement CMD client** with explicit base-host allowlist, request timeout, abort signal, no redirects to unapproved hosts, and redacted typed errors.
- [ ] **Step 4: Implement normalization** into existing `ProviderEvent`, `ProviderMarket`, and `ProviderQuoteUpdate`; unsupported sports/markets are ignored with diagnostics.
- [ ] **Step 5: Implement profile reader** returning redacted label, currency, exact balance, and provider timestamp.
- [ ] **Step 6: Run GREEN**, adapters typecheck, redaction scan, and commit `feat: add read-only CMD profile and catalog adapter`.

### Task 5: Strict live runtime composition

**Files:**
- Create: `apps/api/src/live-runtime.ts`
- Create: `apps/api/src/live-runtime.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: active account registry and CMD adapter factory.
- Produces: a Runtime whose snapshot has one immutable `dataMode`.

- [ ] **Step 1: Write failing tests** proving default mode is `LIVE`, live startup with no active adapters returns empty data, `FIXTURE_MODE=1` is required for fixtures, and no live/fixture adapter combination is accepted.
- [ ] **Step 2: Run RED** and capture the current unconditional `createFixtureRuntime` behavior.
- [ ] **Step 3: Implement configuration** so `startServer` creates either `createLiveRuntime` or `createFixtureRuntime`, never both. Account/session state changes start or stop account-scoped provider adapters.
- [ ] **Step 4: Ensure restart fail-closed**: no opportunity until fresh profile, full catalog snapshot, mappings, and quotes arrive.
- [ ] **Step 5: Run GREEN**, full API/integration tests, and commit `feat: compose strict live provider runtime`.

### Task 6: Upcoming sorting and bounded quote movement

**Files:**
- Create: `packages/core/src/quotes/quote-history.ts`
- Create: `packages/core/src/quotes/quote-history.test.ts`
- Modify: `apps/api/src/runtime.ts`
- Modify: `apps/web/src/pages/opportunities-page.tsx`
- Modify: `apps/web/src/pages/opportunities-page.test.tsx`

**Interfaces:**
- Produces: movement samples capped at 120 points/market and server-computed event priority keys.

- [ ] **Step 1: Write failing tests** for live-first, nearest-upcoming, margin, freshness ordering; reject already-finished events; bound history; and calculate last-change/direction/5-minute range only from accepted quotes.
- [ ] **Step 2: Run RED**.
- [ ] **Step 3: Implement quote history** keyed by category/canonical market/provider/selection and prune by count and age.
- [ ] **Step 4: Add server fields and UI columns** for start time, quote age, last movement, direction, and volatility. Never label movement as prediction.
- [ ] **Step 5: Run GREEN**, core/web typechecks, and commit `feat: prioritize upcoming markets and show movement`.

### Task 7: Concurrent two-account preflight tickets

**Files:**
- Create: `apps/api/src/preflight/preflight-service.ts`
- Create: `apps/api/src/preflight/preflight-service.test.ts`
- Create: `apps/api/src/preflight/ticket-signer.ts`
- Create: `apps/api/src/preflight/ticket-signer.test.ts`
- Create: `apps/api/src/routes/preflight.ts`
- Create: `apps/api/src/routes/preflight.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: two account IDs, one current opportunity ID, profile readers, provider quote refreshers, and existing stake optimizer.
- Produces: `POST /api/preflight` returning `PreflightTicket | PreflightRejection`; no execution route.

- [ ] **Step 1: Write failing tests** for distinct accounts, concurrent refresh, session/profile/balance/quote freshness, identical semantics, odds tolerance, stake limits, exact base-currency profit, missing capability, partial timeout, 3-second expiry, tamper rejection, and single-use nonce reservation.
- [ ] **Step 2: Run RED**.
- [ ] **Step 3: Implement HMAC ticket signer** using a DPAPI-protected local random key. Sign canonical JSON and compare signatures in constant time.
- [ ] **Step 4: Implement preflight service** with `Promise.allSettled` and a shared deadline. Any rejection returns reasons for both legs and issues no nonce/ticket.
- [ ] **Step 5: Register no-store, same-origin, rate-limited route**. Confirm by route enumeration that no `/bet`, `/wager`, `/execute`, or `/submit` route exists.
- [ ] **Step 6: Run GREEN**, API/integration tests, and commit `feat: prepare expiring two-account preflight tickets`.

### Task 8: Accounts, live-data, and two-leg preflight UI

**Files:**
- Modify: `apps/web/src/pages/sessions-page.tsx`
- Modify: `apps/web/src/pages/sessions-page.test.tsx`
- Create: `apps/web/src/components/account-card.tsx`
- Create: `apps/web/src/components/preflight-dialog.tsx`
- Create: `apps/web/src/components/preflight-dialog.test.tsx`
- Modify: `apps/web/src/api/sessions.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: account/status, live snapshot, movement, and preflight endpoints.
- Produces: profile/balance display and prepare-only operator workflow.

- [ ] **Step 1: Write failing UI/E2E tests** for hidden token values, two same-provider accounts, stale balance, live/fixture badge, upcoming ordering, movement display, account A/B uniqueness, complete ticket details, expiry, failure reasons, non-atomic warning, and absence of wager submission controls.
- [ ] **Step 2: Run RED**.
- [ ] **Step 3: Implement account cards and write-only token forms**. Balance includes currency and provider timestamp; unknown token source remains action-required.
- [ ] **Step 4: Implement live/upcoming tables and preflight dialog** with server-derived values only.
- [ ] **Step 5: Run GREEN** for web and five-plus E2E scenarios.
- [ ] **Step 6: Update `docs/operator/live-session-setup.md`** with live mode, two accounts, balance freshness, provider capability state, and explicit no-wager limitation.
- [ ] **Step 7: Run full verification**: `npm.cmd run verify`, `npm.cmd run build`, `npm.cmd run test:e2e`, `npm.cmd audit --audit-level=high`, `git diff --check`, and credential/token canary scans.
- [ ] **Step 8: Commit** with `feat: add live account and two-leg preflight workflow`.
