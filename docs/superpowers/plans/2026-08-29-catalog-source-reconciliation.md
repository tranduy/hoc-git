# Catalog Source Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile removed markets, changed lines, and changed odds into the authoritative live catalog and republish the feed automatically.

**Architecture:** Provider adapters mark only proven removal deltas, the coverage guard admits those removals, and SABA's DOM overlay replaces visible market families instead of retaining obsolete lines. Automatic direct-selection observations update or tombstone the exact catalog identity with compare-and-swap, then request a provider baseline so replacement lines enter from source truth.

**Tech Stack:** TypeScript, Vitest, Fastify, React catalog revision stream

**Spec:** `docs/superpowers/specs/2026-08-29-catalog-source-reconciliation.md`

## Global Constraints

- Complete baselines replace old data; partial evidence cannot delete unseen identities.
- Never guess a replacement line or provider identity.
- Every material catalog change must publish a new revision and rerun comparison.
- Preserve unrelated dirty worktree changes.

---

### Task 1: Admit proven source removals

**Files:**
- Modify: `apps/api/src/catalog/catalog-coverage-guard.ts`
- Test: `apps/api/src/catalog/catalog-coverage-guard.test.ts`
- Modify: `apps/api/src/chrome-bridge/adapter.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- Modify: `apps/api/src/chrome-bridge/im-http-adapter.ts`
- Test: `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- Test: `apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts`

**Interfaces:**
- Consumes: adapter-maintained complete catalogs and explicit provider delete/event-change messages.
- Produces: `authoritativeRemovalEvidence: true` on a `DecodedCatalogUpdate` and `allowsRemoval: true` on its coverage candidate.

- [ ] **Step 1: Write failing coverage and adapter tests**

Assert that an ordinary shrinking delta is rejected, but the same delta with `allowsRemoval: true` is accepted. Assert IM close deltas and APSPORT exact event-change deltas carry `authoritativeRemovalEvidence: true`.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test --workspace @tool-chenh/api -- --run apps/api/src/catalog/catalog-coverage-guard.test.ts apps/api/src/chrome-bridge/im-http-adapter.test.ts apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts`

Expected: FAIL because the new evidence fields and deletion admission do not exist.

- [ ] **Step 3: Implement minimal evidence plumbing**

Add the optional evidence field to decoded updates, propagate it into the coverage candidate, and let only an explicitly proven delta replace accepted event coverage. Mark IM only when `mergeImFootballDelta` deletes an event; mark APSPORT only for exact `EVENT_CHANGE` detail reconciliation.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run the command from Step 2 and expect PASS.

### Task 2: Replace obsolete SABA lines

**Files:**
- Create: `apps/api/src/chrome-bridge/catalog-source-reconciliation.ts`
- Create: `apps/api/src/chrome-bridge/catalog-source-reconciliation.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`

**Interfaces:**
- Consumes: retained SABA catalog and a current visible DOM catalog.
- Produces: `reconcileSabaDomDelta(retained, current): ObservedProviderCatalog`.

- [ ] **Step 1: Write failing SABA reconciliation tests**

Cover price replacement on the same selection, removal of the old `FT_AH` line when a new line is visible, preservation of unrelated market families, and preservation of events outside the viewport.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test --workspace @tool-chenh/api -- --run apps/api/src/chrome-bridge/catalog-source-reconciliation.test.ts`

Expected: FAIL because the reconciliation module does not exist.

- [ ] **Step 3: Implement market-family replacement**

For each visible event and each `(marketType, scope)` family present in the current DOM catalog, discard retained markets and quotes in that family before adding current identities. Do not overlay a complete SABA DOM baseline; let it replace the old catalog.

- [ ] **Step 4: Run focused test to verify GREEN**

Run the command from Step 2 and expect PASS.

### Task 3: Feed direct observations back into catalog authority

**Files:**
- Modify: `apps/api/src/chrome-bridge/catalog-source-reconciliation.ts`
- Test: `apps/api/src/chrome-bridge/catalog-source-reconciliation.test.ts`
- Modify: `apps/api/src/chrome-bridge/provider-feed-controller.ts`
- Test: `apps/api/src/chrome-bridge/provider-feed-controller.test.ts`
- Modify: `apps/api/src/chrome-bridge/provider-feed-registry.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- Test: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`

**Interfaces:**
- Produces: `SelectionCatalogObservation`, `reconcileSelectionObservation(catalog, observation)`, and `ChromeCatalogDataPlane.reconcileSelectionObservation(observation): boolean`.
- Consumes: exact displayed catalog timestamp, provider IDs, expected raw odds, direct observed odds, and observation time.

- [ ] **Step 1: Write failing correction tests**

Assert changed odds replace the exact quote and timestamp; an exact miss removes the whole old market and orphaned event; unchanged prices do not republish; and an old observation cannot mutate a newer catalog.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test --workspace @tool-chenh/api -- --run apps/api/src/chrome-bridge/catalog-source-reconciliation.test.ts apps/api/src/chrome-bridge/provider-feed-controller.test.ts apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`

Expected: FAIL because correction APIs do not exist.

- [ ] **Step 3: Implement compare-and-swap catalog replacement**

Add a feed-controller replacement method that requires the exact current catalog object. Build corrected immutable catalogs in the reconciliation module, apply them through the registry, and publish them through the data plane's existing publication callback.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run the command from Step 2 and expect PASS.

### Task 4: Wire realtime checks to reconciliation and refresh

**Files:**
- Modify: `apps/api/src/routes/provider-preflight.ts`
- Test: `apps/api/src/routes/provider-preflight.test.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: completed `TicketRealtimeCheckLegResult` values.
- Produces: `onSelectionObservation(observation)` route callback; the server applies it to the data plane and starts `refreshProvider(provider)` after a material correction.

- [ ] **Step 1: Write failing route tests**

Assert `ODDS_CHANGED` emits an update observation; NOT_FOUND, ambiguity, market closure, and timeout emit remove observations; MATCH and SOURCE_UNAVAILABLE emit nothing.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test --workspace @tool-chenh/api -- --run apps/api/src/routes/provider-preflight.test.ts`

Expected: FAIL because the observation callback is absent.

- [ ] **Step 3: Implement route and server wiring**

Emit observations after both checks finish. In `startServer`, apply each observation to `ChromeCatalogDataPlane`; when applied, launch the targeted provider refresh without delaying the HTTP response and log refresh failure without restoring stale data.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run the command from Step 2 and expect PASS.

### Task 5: Regression verification

**Files:**
- Verify only; do not modify unrelated failures.

- [ ] **Step 1: Run API typecheck and focused suites**

Run: `npm run typecheck --workspace @tool-chenh/api`

Run: `npm test --workspace @tool-chenh/api -- --run apps/api/src/catalog/catalog-coverage-guard.test.ts apps/api/src/chrome-bridge/catalog-source-reconciliation.test.ts apps/api/src/chrome-bridge/im-http-adapter.test.ts apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts apps/api/src/chrome-bridge/provider-feed-controller.test.ts apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts apps/api/src/routes/provider-preflight.test.ts`

- [ ] **Step 2: Run web regression for revision-driven ranking**

Run: `npm test --workspace @tool-chenh/web -- --run apps/web/src/catalog/catalog-revision-coordinator.test.ts apps/web/src/pages/live-catalog-page.test.tsx apps/web/src/watch/ranked-tickets.test.ts`

Expected: catalog revision polling and ranking continue to pass with corrected catalogs.
