# Final Realtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make football ticket pairing fail closed on exact event/market/opposition/freshness identity and produce an evidence-backed six-book runtime acceptance table.

**Architecture:** Keep provider collectors unchanged. Enforce canonical pairing at the shared comparison boundary, keep socket epochs coherent in the revision coordinator/App feed, and verify the already-running stack passively through API, WebSocket, UI, and existing direct-price probes.

**Tech Stack:** TypeScript, React, Web Worker, Vitest, Playwright runtime verifiers, local Fastify/WebSocket APIs.

**Spec:** `docs/realtime-6-books-handoff.md` plus the final-integration requirements in the user request dated 2026-08-21.

## Global Constraints

- Do not place bets.
- Do not reset, reload, close, or change the URL of any bookmaker tab.
- Do not rewrite provider collectors already completed by provider-specific sessions.
- Preserve and do not stage unrelated dirty worktree changes.
- Use TDD and do not claim six-of-six without runtime evidence for every row.

---

### Task 1: Exact comparison identity and opposition

**Files:**
- Modify: `apps/web/src/catalog/comparison.ts`
- Test: `apps/web/src/catalog/comparison.test.ts`
- Test: `apps/web/src/catalog/comparison-worker-engine.test.ts`
- Test: `apps/web/src/components/ranked-ticket-table.test.tsx`

**Interfaces:**
- Consumes: `LiveCatalogResponse`, `ProviderEvent`, `ProviderMarket`, and `ProviderQuote`.
- Produces: `buildComparisonEvents(catalogs)` with only exact, fresh, opposing two-way rows and `selectionHandicapLine()` with one canonical sign conversion.

- [ ] Add failing literal-fixture regressions for Coquimbo Unido vs CA Platense, reversed participant order, different competition/kickoff identity, FT/FH isolation, non-opposing outcomes, mismatched quote sequences, stale quote clocks, and HOME `-0.25` versus AWAY `+0.25` rendering.
- [ ] Run the focused comparison tests and confirm each new test fails for the intended missing gate.
- [ ] Add the minimum event, generation, opposition, and freshness checks at the shared comparison boundary; do not alter a provider collector.
- [ ] Re-run comparison/worker/table tests and confirm they pass.

### Task 2: Reconnect and worker epoch coherence

**Files:**
- Modify if a failing regression proves it necessary: `apps/web/src/catalog/catalog-revision-coordinator.ts`
- Modify if necessary: `apps/web/src/catalog/comparison-worker-client.ts`
- Modify if necessary: `apps/web/src/app.tsx`
- Test: `apps/web/src/catalog/catalog-revision-coordinator.test.ts`
- Test: `apps/web/src/catalog/comparison-worker-client.test.ts`
- Test: `apps/web/src/app-realtime.test.tsx`
- Test: `apps/web/src/pages/live-catalog-page.test.tsx`

**Interfaces:**
- Consumes: epoch baseline and per-account `CATALOG_REVISION` events.
- Produces: lower sequence acceptance after a new baseline, selected-account-only fetches, and latest-worker-generation-only rendering.

- [ ] Add failing regressions for retained high sequence followed by lower restart baseline, StrictMode effect replay, one-account revision upsert, and superseded worker output.
- [ ] Run the focused tests and distinguish already-covered behavior from actual failures.
- [ ] Apply only the minimum fix proven by a red regression.
- [ ] Re-run the focused revision/page tests.

### Task 3: Passive six-book runtime acceptance

**Files:**
- Create: `scripts/verify-six-book-runtime.mjs`
- Create: `scripts/verify-six-book-ui-runtime.mjs`
- Evidence only, untracked: `six-book-runtime-evidence.json`, `six-book-ui-runtime-evidence.json`, `six-book-direct-price-evidence.json`.

**Interfaces:**
- Consumes: `/api/chrome-bridge/sources`, `/api/catalog/sources`, `/api/catalog/accounts/:id`, `/api/realtime`, and existing `/api/provider-preflight/realtime-check` UI/API flow.
- Produces: per-provider source sequence/revision/quote/UI movement, disconnect/gap/false-zero/freeze/blink metrics, latency, and AH/TOTAL direct-check evidence.

- [ ] Implement a verifier that records all six providers independently and never invokes maintenance/provider control endpoints.
- [ ] Run `node --check` and a short smoke against the live API.
- [ ] Run the API/WebSocket and UI verifier concurrently for at least 20 minutes with exactly one tool-page document navigation.
- [ ] Invoke existing direct-price checks for an AH and TOTAL candidate per available provider; preserve NOT_FOUND/AMBIGUOUS/SOURCE_UNAVAILABLE as failures.
- [ ] Build the PASS/FAIL table from evidence only.

### Task 4: Verification, review, commit, and handoff

**Files:**
- Modify: `docs/realtime-6-books-handoff.md`

**Interfaces:**
- Consumes: Task 1-3 commits and evidence.
- Produces: isolated integration commit and final handoff commit.

- [ ] Run all comparison/revision/UI focused tests and full workspace typecheck.
- [ ] Run `git diff --check`, inspect staged file names, and commit only integration files.
- [ ] Request independent code review over the integration commit and resolve every Critical/Important finding with TDD.
- [ ] Append the final six-book matrix, exact commands, evidence, blockers, and commit hashes to the handoff.
- [ ] Commit the handoff separately and report only providers with complete evidence as PASS.
