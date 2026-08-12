# Multi-lounge Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all verified lounges load through isolated, exact, fast source pipelines and provide stable realtime data for the split comparison UI.

**Architecture:** Resolve every account to a redacted provider/category/session source identity, route to exactly one reader, and single-flight reads by that identity. HTTP requests have bounded deadlines while a slow underlying read remains coalesced and may populate the last-success cache.

**Tech Stack:** TypeScript, Fastify, React, Zod, Vitest, Playwright provider readers, WebSocket.

## Global Constraints

- OBSERVE/read-only by default; never submit a real bet in this plan.
- Exact mapping only; no inferred provider, market, line, outcome orientation or settlement.
- Dynamic domains and tokens are not stable identities and may not be logged.
- Persistence and telemetry failures are caught and cannot block quote ingress.
- Existing unrelated dirty files must not be staged, reverted or overwritten.

---

### Task 1: Exact source identity and provider routing

**Files:**
- Modify: `apps/api/src/accounts/account-registry.ts`
- Modify: `apps/api/src/providers/multi-provider-catalog.ts`
- Modify: `apps/api/src/sessions/session-services.ts`
- Test: `apps/api/src/accounts/account-registry.test.ts`
- Test: `apps/api/src/providers/multi-provider-catalog.test.ts`

**Interfaces:**
- Produces: `CatalogSourceIdentity { provider, category, sessionId, key }`.
- Produces: `AccountRegistry.resolveCatalogSource(accountId)`.
- Produces: explicit `ProviderCatalogReaderRegistration { provider, category, reader }` routing.

- [x] Write a failing registry test proving two accounts bound to one session resolve to the same source key without exposing the secret.
- [x] Run the focused registry test and confirm the missing method failure.
- [x] Implement the minimal redacted resolver.
- [x] Write a failing multiplexer test proving unrelated readers are never invoked.
- [x] Run it and confirm the current sequential probing failure.
- [x] Replace sequential probing with exact provider/category routing.
- [x] Run focused tests and typecheck.
- [x] Commit only Task 1 files.

### Task 2: Source-key single-flight, timeout and last-success cache

**Files:**
- Modify: `apps/api/src/routes/catalog.ts`
- Test: `apps/api/src/routes/catalog.test.ts`

**Interfaces:**
- Consumes: `CatalogReaderLike.resolveSource(accountId)` and `read(accountId)`.
- Produces: one in-flight promise per source identity and `503 { error: "CATALOG_TIMEOUT" }`.

- [x] Write a failing test where two different account ids with one source key cause one reader invocation.
- [x] Run it and confirm two reads occur.
- [x] Implement source-key coalescing and account-id rebinding.
- [x] Write a failing fake-timer test where a request times out but the shared read later fills cache exactly once.
- [x] Run it and confirm the request currently hangs.
- [x] Implement the request deadline without cancelling or deleting the active shared read.
- [x] Write a failing test proving `/api/health` and a second source respond while the first source hangs.
- [x] Implement only the isolation required by that test.
- [x] Run catalog route tests, API typecheck and API build.
- [x] Commit only Task 2 files.

### Task 3: Web stale/error preservation

**Files:**
- Modify: `apps/web/src/api/catalog.ts`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Test: `apps/web/src/api/catalog.test.ts`
- Test: `apps/web/src/pages/live-catalog-page.test.tsx`

**Interfaces:**
- Consumes: `CATALOG_TIMEOUT`, `CATALOG_UNAVAILABLE`, `CATALOG_SCHEMA_ERROR`.
- Produces: per-source refresh state while preserving the last accepted catalog.

- [x] Write a failing page test that loads a catalog, receives timeout, retains rows and shows source stale.
- [x] Run it and confirm rows disappear or status is ambiguous.
- [x] Implement typed catalog errors and last-success preservation.
- [x] Add regressions for successful empty catalog versus timeout/schema error.
- [x] Run focused web tests, web typecheck and web build.
- [x] Commit only Task 3 files.

### Task 4: Full lounge live verification

**Files:**
- Modify: `sảnh.md` in the workspace root with redacted counts/status only.
- Modify: `proccess.md` in the workspace root with the measured checkpoint.

**Interfaces:**
- Consumes: current Fabet launch collector and catalog endpoints.
- Produces: per-lounge event/market/quote counts, observed time and latency without secrets.

- [x] Renew Fabet once with web polling stopped.
- [x] Validate the current launch for each listed lounge sequentially.
- [x] Read all ACTIVE sources concurrently through the new isolated route.
- [x] Confirm health stays under one second during a deliberately hanging reader.
- [x] Record event/market/quote counts and exact source errors; never turn errors into zero-event success.
- [x] Run full API/web tests, workspace typecheck/build and `git diff --check`.
- [x] Commit only repository documentation; user explicitly requested root progress files, so they are updated outside this worktree commit.

### Task 5: Split comparison workspace

**Files:**
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/pages/live-catalog-page.test.tsx`

**Interfaces:**
- Consumes: ranked tickets, per-source states and realtime catalog deltas.
- Produces: desktop left ranked list and right selected-event detail with in-place updates.

- [x] Write a failing test for click-left/select-right without route navigation.
- [x] Implement the two-pane semantic layout and responsive single-pane fallback.
- [x] Write a failing test proving an odds delta updates the selected row without replacing selection or clearing scroll state.
- [x] Implement stable keyed row updates.
- [x] Verify exact prices remain visible without arbitrage; green/toast/sound remain preflight-gated.
- [x] Run focused tests, full web tests, typecheck and build. In-app visual browser verification is blocked by missing runtime sandbox metadata; automated DOM behavior is covered.
- [x] Commit only Task 5 files.

## Verified live-source checkpoint — 13 August 2026

- Football catalog verified: SABA, SBOBET, APSPORT and BTI.
- LoL catalog verified: SABA and IM.
- Still fail-closed: IM Football (`SCHEMA_CHANGED`), CMD (no current Fabet launch), BTI LoL (no verified catalog adapter).
- Fabet cold restart rehydrates saved credentials, and the 24-hour refresh preserves an ACTIVE lounge only when provider, category and hostname identity remain exact.
- No real-money order was submitted.
