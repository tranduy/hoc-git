# Immediate Cross-book Lag Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a compact priority list immediately when a price update creates a profitable two-outcome plan across two different providers.

**Architecture:** Strengthen the pure catalog comparison builder so it emits only exact, complete two-provider outcome domains. Add a stateful client-side signal tracker that compares consecutive accepted snapshots and retains only currently profitable signals triggered by a real quote change. Render the strongest signal and at most five ranked signals while polling selected provider catalogs without overlap.

**Tech Stack:** TypeScript, React, Decimal.js through `@tool-chenh/core`, Vitest, Testing Library.

## Global Constraints

- No five-minute window participates in triggering or ranking.
- Only exact two-outcome markets from at least two selected providers are eligible.
- `FT_1X2` and `FH_1X2` are always excluded.
- Both selected legs must be `OPEN`, fresh according to the accepted provider response, and from different providers.
- Ranking is realized ROI, then worst-case profit, then newest trigger.
- This phase is read-only and must not claim bet placement.

---

### Task 1: Exact two-provider market domains

**Files:**
- Modify: `apps/web/src/catalog/comparison.ts`
- Test: `apps/web/src/catalog/comparison.test.ts`

**Interfaces:**
- Consumes: `LiveCatalogResponse`, `ProviderEvent`, `ProviderMarket`, `ProviderQuote`.
- Produces: `buildComparisonEvents(catalogs)` whose rows contain at least two complete cells with one identical two-selection domain.

- [ ] **Step 1: Write the failing tests**

Add cases proving that a row is excluded when only one provider has both selections, when provider selection domains differ, when the market is `FT_1X2` or `FH_1X2`, or when competition/event scope differs; keep a matching `FT_TOTAL` row.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/catalog/comparison.test.ts`

Expected: the incomplete-provider and event-provenance assertions fail against the existing comparison builder.

- [ ] **Step 3: Implement the strict row and event keys**

Use normalized competition, participants, event scope, virtual/game variant, live state, and start evidence in the event identity. Build a sorted outcome-domain signature per cell and retain only groups with at least two cells sharing the same exact two-selection signature. Explicitly reject `FT_1X2` and `FH_1X2`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/catalog/comparison.test.ts`

Expected: all comparison tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/catalog/comparison.ts apps/web/src/catalog/comparison.test.ts
git commit -m "fix: require exact two-book outcome domains"
```

### Task 2: Immediate lag-signal tracker

**Files:**
- Create: `apps/web/src/watch/lag-signal-tracker.ts`
- Create: `apps/web/src/watch/lag-signal-tracker.test.ts`

**Interfaces:**
- Consumes: `ComparisonEvent[]`, selected providers, fixed-base stake policy, and snapshot time.
- Produces: `LagSignalTracker.update(events, providers, policy, observedAtMs): readonly LagSignal[]`.
- `LagSignal` exposes event/row identity, one or more changed quote records, the exact `FixedBaseStakePlan`, trigger time, and quote ages.

- [ ] **Step 1: Write the failing tests**

Test consecutive snapshots where SABA changes from `2.20/1.70` to `1.70/2.20` while SBOBET remains `2.20/1.70`. Assert immediate selection of SABA outcome B at `2.20` and SBOBET outcome A at `2.20`. Add fail-closed tests for initial samples, unchanged samples, non-profitable updates, suspended legs, and removal when the edge disappears. Add ranking/limit tests for realized ROI and maximum five signals.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/lag-signal-tracker.test.ts`

Expected: module import fails because the tracker does not exist.

- [ ] **Step 3: Implement the minimal tracker**

Index quotes by exact event key, market row key, provider, and selection. Compare each new accepted sample with the immediately previous sample, recompute `buildFixedBaseStakePlan` on every changed row, retain only positive two-provider plans, and sort with Decimal values rather than floating-point arithmetic.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/lag-signal-tracker.test.ts src/watch/fixed-base-stake.test.ts`

Expected: all tracker and stake tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/watch/lag-signal-tracker.ts apps/web/src/watch/lag-signal-tracker.test.ts
git commit -m "feat: detect immediate cross-book lag signals"
```

### Task 3: Compact priority interface and continuous refresh

**Files:**
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `docs/operator/live-session-setup.md`

**Interfaces:**
- Consumes: `LagSignalTracker`, selected account IDs, current catalogs, and global base stake.
- Produces: one strongest-signal card, up to five ranked signal rows, non-overlapping refresh, and a compact monitored-match list.

- [ ] **Step 1: Write the failing UI tests**

With fake timers and two provider snapshots, assert that the initial state says it is waiting for a price change; the next poll immediately renders `Best live lag signal`, both providers, old/new odds evidence, both stakes and both profits; no more than five rows render; and the full raw market table is not repeated in the catalog list.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/pages/live-catalog-page.test.tsx`

Expected: priority panel assertions fail because the current page renders static event tables.

- [ ] **Step 3: Implement polling and compact UI**

Poll selected active provider accounts every 1,000 ms with an in-flight guard. Feed each complete refresh into one tracker instance. Render only currently executable signals, strongest first, with market/line, movement evidence, two provider legs, stake, outcome profits, worst profit, ROI, quote age, and `READ-ONLY` status. Render at most ten compact monitored matches beneath it for detail navigation.

- [ ] **Step 4: Run focused and full verification**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run
npm.cmd run typecheck --workspace @tool-chenh/web
npm.cmd run verify
npm.cmd run build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Verify localhost and commit**

Reload `http://127.0.0.1:4311/live-catalog`, verify the compact hierarchy and priority signal surface, then commit:

```powershell
git add apps/web/src/pages/live-catalog-page.tsx apps/web/src/pages/live-catalog-page.test.tsx apps/web/src/styles.css docs/operator/live-session-setup.md
git commit -m "feat: prioritize live lag opportunities"
```
