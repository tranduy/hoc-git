# BTI Realtime Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish atomic current BTI football snapshots and verify exact current bookmaker prices without reloading or navigating the authenticated provider tab.

**Architecture:** The extension performs one bounded same-origin no-store event-list refresh and returns all successful response bodies with one generation. `NetworkObserver` forwards those bodies with the generation; `BtiHttpCatalogAdapter` waits for the complete generation, rejects older generations, and publishes atomically while retaining the last good catalog on incomplete/invalid refreshes. Exact-price checks use a fresh event-detail request and validate the full ticket identity before returning a value.

**Tech Stack:** TypeScript, Chrome DevTools Protocol Runtime/Network, Vitest, Playwright.

**Spec:** User request dated 2026-08-21 in this session.

## Global Constraints

- Change only BTI and shared code strictly required by BTI.
- Never reset, reload, close, or change the URL of a provider tab.
- Never use event-list/catalog odds as the direct bookmaker price.
- Use TDD and commit only BTI files/hunks.

---

### Task 1: Atomic event-list generations

**Files:**
- Modify: `apps/api/src/chrome-bridge/bti-http-adapter.ts`
- Test: `apps/api/src/chrome-bridge/bti-http-adapter.test.ts`

**Interfaces:**
- Consumes: `ChromeBridgeEnvelope.request.streamId` as the refresh generation.
- Produces: one `DecodedCatalogUpdate` only after live, live/initial, prematch, and prematch/initial of the same generation are valid.

- [ ] Add failing tests for incomplete generation, old generation after new, stale response, and failed/empty partial refresh preserving the last catalog.
- [ ] Run `vitest` for `bti-http-adapter.test.ts` and confirm failures are caused by current per-response publication.
- [ ] Implement generation ordering and atomic replacement; keep detail overlays bounded and never let an incomplete generation publish zero.
- [ ] Re-run focused tests until green.

### Task 2: Generation-aware lightweight refresh

**Files:**
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Test: `apps/chrome-extension/src/network-observer.test.ts`

**Interfaces:**
- Consumes: `BTI_CATALOG_REFRESH_EXPRESSION` result `{ generation, responses }`.
- Produces: four ordered `ingestHttpResponse` calls carrying the same `streamId` generation.

- [ ] Add failing tests for response bodies sharing one generation and refresh timeout returning no catalog envelopes.
- [ ] Run the observer tests and confirm current expression only causes uncorrelated CDP traffic.
- [ ] Return bounded JSON bodies from the current tab and forward them with one generation; keep timeout local and perform no navigation.
- [ ] Re-run observer tests until green.

### Task 3: Exact fresh BTI detail price

**Files:**
- Modify: `apps/chrome-extension/src/selection-price.ts`
- Test: `apps/chrome-extension/src/selection-price.test.ts`

**Interfaces:**
- Consumes: full `SelectionPriceProbeIdentity`.
- Produces: `FOUND` only for one event, one market, and one selection matching ordered participants, type, scope, canonical line, outcome, and provider IDs.

- [ ] Add failing literal-fixture tests for same-line markets, not-found/ambiguous event-market-selection, and HOME/AWAY/OVER/UNDER.
- [ ] Confirm failures against the existing ID-only resolver.
- [ ] Implement fail-closed identity validation over a fresh no-store detail response.
- [ ] Re-run price and bridge probe tests until green.

### Task 4: Verification and runtime evidence

**Files:**
- Create: `scripts/verify-bti-runtime.mjs`
- Create: `scripts/verify-bti-ui-runtime.mjs`
- Create: `scripts/verify-bti-direct-price.mjs`
- Modify: `docs/realtime-6-books-handoff.md`

- [ ] Run all focused BTI tests, API/extension typecheck, builds, and `git diff --check`.
- [ ] Request independent code review and fix every Critical/Important finding.
- [ ] Without touching provider tabs, prove fresh event-list/detail traffic, sequence/revision progression, one real quote change, UI change without F5, exact AH/TOTAL direct checks, and a 15-minute soak.
- [ ] Record honest PASS/blocker evidence in the handoff, stage only BTI files/hunks, and commit separately.
