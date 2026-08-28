# APSPORT Realtime Hidden Markets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a bounded APSPORT football catalog containing every live event and every prematch event starting in the next 24 hours, enrich it with hidden event-detail markets, and keep it current from all eligible APSPORT WebSocket streams.

**Architecture:** The extension retains one credential-bearing APSPORT request template only in memory, uses it in the request-owning page context to fetch bounded roster and event-detail data, and forwards only redacted catalog payloads. The API adapter replaces DOM completeness with an API generation, merges detail and multi-socket event replacements by stable provider identity, applies the same time/market cutoff, and suppresses semantic duplicates.

**Tech Stack:** TypeScript, Chrome DevTools Protocol, Manifest V3 extension, Zod, Vitest, existing Chrome bridge authority/data-plane.

**Spec:** `docs/superpowers/specs/2026-08-28-apsport-realtime-top50-design.md`

## Global Constraints

- APSPORT account is `catalog-source:APSPORT:FOOTBALL`; Chrome lobby is `TSPORT`.
- Include every active live football event and prematch kickoff in `[now, now + APSPORT_PREMATCH_WINDOW_HOURS]`.
- `APSPORT_PREMATCH_WINDOW_HOURS` defaults to `24` and accepts only integer values `1..48`; invalid values fail server startup.
- Keep only supported two-outcome main, first-half, second-half, corner and card AH/TOTAL products.
- Provider event, market and selection IDs remain unchanged; main/corner/card identities remain separate.
- Collection and preflight are read-only; no odds click, bet-slip interaction, wager or credential persistence.
- Do not change comparison, match pairing, ticket identity, detail/preflight, or the already implemented global Top-50 rendering behavior.

---

### Task 1: APSPORT Window Configuration and Snapshot Control

**Files:**
- Modify: `packages/contracts/src/chrome-bridge.ts`
- Modify: `packages/contracts/src/chrome-bridge.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-control-plane.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-control-plane.test.ts`
- Modify: `apps/chrome-extension/src/local-bridge.ts`
- Modify: `apps/chrome-extension/src/local-bridge.test.ts`
- Modify: `apps/chrome-extension/src/background.ts`

**Interfaces:**
- Produces: `REQUEST_SNAPSHOT.prematchWindowHours?: number` with an integer `1..48`.
- Produces: `resolveApsportPrematchWindowHours(env): number` and `ServerConfig.apsportPrematchWindowHours`.
- Consumes: Local bridge passes the complete snapshot request to the background recovery callback.

- [ ] **Step 1: Write failing contract/config/control tests**

  Add literal assertions that a value of `24` is accepted, `0`, `49`, fractional and unknown fields are rejected; unset environment resolves to `24`; invalid environment throws; and only TSPORT snapshot controls include the resolved value.

- [ ] **Step 2: Run the targeted tests and verify RED**

  Run: `npm.cmd test --workspace @tool-chenh/contracts -- --run src/chrome-bridge.test.ts && npm.cmd test --workspace @tool-chenh/api -- --run src/server.test.ts src/chrome-bridge/chrome-bridge-control-plane.test.ts && npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/local-bridge.test.ts`

  Expected: FAIL because the schema, resolver and callback payload do not yet exist.

- [ ] **Step 3: Implement the minimal control/config path**

  Extend the strict request schema with the optional bounded integer, resolve the environment once at server startup, inject it into `ChromeBridgeControlPlane`, add it only when the attached lobby is `TSPORT`, and pass the parsed request to `recoverSourceSnapshot` without changing other lobby messages.

- [ ] **Step 4: Run the targeted tests and verify GREEN**

  Run the Step 2 command and require zero failures.

### Task 2: Bounded APSPORT API Collector

**Files:**
- Create: `apps/chrome-extension/src/apsport-catalog-refresh.ts`
- Create: `apps/chrome-extension/src/apsport-catalog-refresh.test.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/chrome-extension/src/network-observer.test.ts`
- Modify: `apps/chrome-extension/src/background.ts`

**Interfaces:**
- Produces: `ApsportRequestTemplate` retained only in memory and bound to source epoch, frame, loader and main-world context.
- Produces: `collectApsportCatalog(options)` callbacks for roster completion and detail batches.
- Produces: synthetic same-origin `HTTP_RESPONSE` payload at `/__fieldline_apsport_catalog_refresh__` with `{ schemaVersion: 1, generation, phase, complete, records }`.
- Consumes: `prematchWindowHours`, `nowMs`, native `/be-ui/pac/api/v3/events` POST template, and provider fields `2`, `6`, `11`, `15`, `17`, `50`, `53`.

- [ ] **Step 1: Write failing pure collector tests**

  Cover: all live events survive regardless of kickoff; prematch exactly at 24 hours survives; a value one millisecond beyond is rejected; invalid/missing kickoff is rejected for prematch; virtual/non-football identities are rejected; only eligible IDs reach the detail callback; `/other-leagues` cursor uses field `17`; HTTP 429 honors bounded retry; a superseding generation stops the old detail queue.

- [ ] **Step 2: Run the collector test and verify RED**

  Run: `npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/apsport-catalog-refresh.test.ts`

  Expected: FAIL because the collector module does not exist.

- [ ] **Step 3: Implement roster parsing and single-flight detail collection**

  Implement live/today/soon roster requests, lazy league expansion, pre-detail cutoff, one-at-a-time `/events/{eventId}` detail requests, bounded 429 backoff, and cancellation by source generation. Return compact raw provider records only; never return headers, query values, tokens or request bodies.

- [ ] **Step 4: Write and run failing observer integration tests**

  Prove one observed native request creates an in-memory template, explicit TSPORT refresh emits roster then detail payloads, payloads are chunked below bridge limits, a document/epoch change cancels emission, and no DOM click/discovery expression runs for APSPORT collection.

- [ ] **Step 5: Wire the collector into `NetworkObserver` and verify GREEN**

  Replace the TSPORT DOM sweep recovery branch with the API collector while leaving SABA/CMD/IM/SBOBET/BTI branches byte-for-byte behaviorally unchanged. Emit detail enrichment no more often than once per five seconds or at generation completion.

- [ ] **Step 6: Run extension tests**

  Run: `npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/apsport-catalog-refresh.test.ts src/network-observer.test.ts src/local-bridge.test.ts`

  Expected: PASS.

### Task 3: API Baseline, Hidden Markets and Multi-Socket Realtime Merge

**Files:**
- Modify: `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/replay-harness.test.ts`

**Interfaces:**
- Consumes: APSPORT catalog refresh payloads from Task 2 and provider `eu` WebSocket frames.
- Produces: one source state keyed by `eventId -> providerMarketId -> providerSelectionId` plus active stream IDs.
- Produces: authoritative `BASELINE` from a complete API generation and `DELTA` for semantic WebSocket/detail changes.

- [ ] **Step 1: Write failing adapter tests for API authority and hidden markets**

  Prove a complete roster becomes authority without DOM expected IDs; detail replaces the same event and adds hidden supported markets; partial detail never deletes prior verified records; group `12` hidden status remains publishable while provider suspension locks the selections; main/corner/card IDs remain distinct; prematch quote `isLive` equals its event.

- [ ] **Step 2: Run adapter tests and verify RED**

  Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/tsport-ws-adapter.test.ts`

  Expected: FAIL because the adapter fingerprints only DOM/WS and requires DOM expected IDs.

- [ ] **Step 3: Implement API generation state and exact normalization**

  Assemble chunked HTTP bodies with the existing `NetworkBodyAssembler`, validate the compact refresh payload with Zod, apply the 24-hour cutoff again, replace roster state atomically on complete generations, replace one event on detail, normalize status and market families, and emit no authoritative empty result from partial or malformed data.

- [ ] **Step 4: Write failing multi-socket and semantic dedupe tests**

  Open `mg/0`, `mg/1` and `/e/{eventId}` streams simultaneously; update from each; close one and retain authority; close the final stream while API authority is fresh and retain authority; repeat an identical `eu` frame and assert no revision; change one price and assert one delta; assert unrelated events remain present.

- [ ] **Step 5: Implement multi-socket merge and verify GREEN**

  Track streams independently by source epoch and stream ID, accept general and detail football paths on provider hosts, replace only the incoming event, keep higher bridge sequence for the same identity, and invalidate only when no eligible stream remains and API authority is stale.

- [ ] **Step 6: Run API adapter/replay tests**

  Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/tsport-ws-adapter.test.ts src/chrome-bridge/replay-harness.test.ts`

  Expected: PASS.

### Task 4: Real APSPORT Acceptance and Regression Verification

**Files:**
- Modify only if evidence exposes a tested defect in Task 2 or Task 3.
- Runtime evidence remains under ignored `.run/`; do not commit provider payloads or credentials.

**Interfaces:**
- Consumes: current authenticated TSPORT tab, local API bridge, `scripts/verify-apsport-runtime.mjs`, pipeline diagnostics and `/api/catalog/accounts/catalog-source:APSPORT:FOOTBALL`.
- Produces: redacted counts for eligible events, supported markets, selections, semantic revisions and cross-book comparison rows.

- [ ] **Step 1: Build contracts, extension, API and web**

  Run: `npm.cmd run build --workspace @tool-chenh/contracts && npm.cmd run build --workspace @tool-chenh/chrome-extension && npm.cmd run build --workspace @tool-chenh/api && npm.cmd run build --workspace @tool-chenh/web`

- [ ] **Step 2: Reload only the extension worker and request an APSPORT snapshot**

  Do not navigate or reload the provider tab. Wait for the complete API generation, then measure the catalog after the post-restart settling window.

- [ ] **Step 3: Verify live data and hidden-market enrichment**

  Require nonzero eligible events, markets and quotes; detail-enriched markets exceed the roster-only count for at least one event; no published prematch event is beyond the configured window; live flags match between events and quotes; and at least one quote revision changes without a page reload during the runtime sample.

- [ ] **Step 4: Run full automated verification**

  Run: `npm.cmd run typecheck && npm.cmd test --workspaces --if-present && npm.cmd run build`

  Expected: zero test, typecheck or build failures.

- [ ] **Step 5: Inspect the final diff**

  Run: `git diff --check` and `git status --short`.

  Confirm only APSPORT/config/control files, the already approved Top-50 files, the corrected spec and this plan are changed; preserve `apps/web/src/catalog/comparison.test.ts` as the user's pre-existing work.
