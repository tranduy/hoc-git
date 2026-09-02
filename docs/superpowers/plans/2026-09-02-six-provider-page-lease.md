# Six-provider Page Lease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renew the six bookmaker source pages in place so expired page/session state cannot leave a stale catalog attached indefinitely.

**Architecture:** Keep CMD's existing exact-tab keepalive and add one persisted, serialized coordinator for the other five lobbies. Provider URL policies generate tokenless renewal URLs, while the existing feed registry remains responsible for proving recovery with a fresh complete baseline.

**Tech Stack:** TypeScript, Chrome Extension MV3 APIs, Vitest, esbuild.

**Spec:** `docs/superpowers/specs/2026-09-02-six-provider-page-lease-design.md`

## Global Constraints

- Never open, remove, replace, or focus a provider tab during periodic renewal.
- Preserve the exact attached tab ID and fail closed if its provider identity changes.
- Do not accept page load, HTTP 200, heartbeat, or navigation completion as proof of realtime catalog recovery.
- Use a 20-minute lease, 30-second loading deferral, and five-minute hard failure cooldown.
- Start a new source epoch before navigation so the old document cannot continue publishing.
- Do not persist provider tokens, cookies, headers, or SABA cookieless session identifiers in the lease schedule.

---

### Task 1: Provider renewal URL policies

**Files:**
- Create: `apps/chrome-extension/src/provider-page-lease.ts`
- Test: `apps/chrome-extension/src/provider-page-lease.test.ts`

**Interfaces:**
- Produces: `RenewableLobby`, `providerRenewalUrl(lobby, currentUrl, nowMs)`, `renewExactProviderTab(source, options)`.

- [ ] Write failing table tests for BTI, IM, TSPORT, KSPORT, and SABA URL transformations, including token removal, monotonic `t`, preserved Pacific period parameters, and removal of SABA `S(...)` and event-detail parameters.
- [ ] Run `npm test --workspace @tool-chenh/chrome-extension -- provider-page-lease.test.ts` and verify the missing module/API failure.
- [ ] Implement strict trusted-host URL policies and exact-tab pre/post-attachment identity checks.
- [ ] Run the focused test and verify it passes.

### Task 2: Persisted serialized lease coordinator

**Files:**
- Modify: `apps/chrome-extension/src/provider-page-lease.ts`
- Modify: `apps/chrome-extension/src/provider-page-lease.test.ts`

**Interfaces:**
- Produces: `ProviderPageLeaseState`, `parseProviderPageLeaseState(value)`, `ProviderPageLeaseCoordinator.tick()`, and `ProviderPageLeaseCoordinator.renewNow(source)`.

- [ ] Write failing tests for strict state parsing, staggered initial schedules, only one renewal per tick, loading deferral, five-minute failure cooldown, manual/scheduled coalescing, and stable tab IDs.
- [ ] Run the focused test and verify the behavioral failures.
- [ ] Implement one persisted state per lobby and one global in-flight operation using the required timing constants.
- [ ] Run the focused test and verify it passes.

### Task 3: Remove obsolete KSPORT token prerequisite

**Files:**
- Modify: `apps/chrome-extension/src/source-tab-recovery.ts`
- Modify: `apps/chrome-extension/src/source-tab-recovery.test.ts`

**Interfaces:**
- Consumes: tokenless `https://zenandfe.com/?agentId=4&sportId=1&lng=vi&t=<now>` launch URLs.
- Produces: direct exact-tab KSPORT recovery that still requires structural sportsbook readiness and a complete Live + Today baseline.

- [ ] Add a failing regression proving `SourceTabRecovery.ensure("KSPORT", tokenlessUrl)` reuses the exact tab and does not create a replacement.
- [ ] Run the focused source recovery test and verify `FABET_KSPORT_TOKEN_UNAVAILABLE` is reproduced.
- [ ] Remove only the URL-token prerequisite; retain trusted-host validation, football URL normalization, and complete-baseline validation.
- [ ] Run the focused test and verify it passes.

### Task 4: Wire periodic and hard recovery through the coordinator

**Files:**
- Modify: `apps/chrome-extension/src/background.ts`
- Modify: `apps/chrome-extension/src/background-source-launch-memory.test.ts`
- Modify: `apps/chrome-extension/src/apsport-page-recovery.test.ts`

**Interfaces:**
- Consumes: registry attachments, `attachRecoveredTabAsExpected`, `observer.beginSourceEpoch`, and Chrome local storage.
- Produces: one provider lease tick from the existing worker heartbeat; APSPORT watchdog and bridge hard reload route to `renewNow` rather than generic `chrome.tabs.reload`.

- [ ] Add wiring regressions that assert periodic/hard renewal attaches before navigation, begins a source epoch, updates the exact tab URL, and never creates a tab.
- [ ] Run focused background/APSPORT tests and verify the old generic reload path fails expectations.
- [ ] Instantiate the coordinator, persist `providerPageLeaseV1`, serialize its tick with CMD, and route non-CMD `onSourceReload` plus APSPORT page recovery through it.
- [ ] Run the focused tests and verify they pass.

### Task 5: Verification and runtime observation

**Files:**
- Modify only if verification exposes a regression in the files above.

**Interfaces:**
- Validates the spec's complete behavior.

- [ ] Run extension focused tests for provider lease, source recovery, APSPORT recovery, background wiring, and CMD keepalive.
- [ ] Run `npm run typecheck --workspace @tool-chenh/chrome-extension`.
- [ ] Run `npm run build --workspace @tool-chenh/chrome-extension`.
- [ ] Run the full extension suite with bounded workers.
- [ ] Run `git diff --check` and inspect the exact diff for unrelated edits.
- [ ] Query local catalog/bridge status without mutating tabs and report which sources are runtime-proven versus awaiting extension deployment/renewal.
