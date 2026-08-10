# Watch Arbitrage Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculate a fail-closed discrete stake plan for a watched cross-book market and show a deduplicated ten-second `READY TO PREFLIGHT` toast.

**Architecture:** Add a pure web planning adapter that translates verified comparison rows into the existing core optimizer input, leaving display lifecycle to a focused React toast component. `MatchWatchDetail` derives the best eligible candidate from selected providers and watcher freshness, and never places a wager.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, `@tool-chenh/core` exact-decimal optimizer.

## Global Constraints

- Observe-only: no provider write, bet placement, or mutation endpoint.
- Alert only for exact cross-provider rows with complete open outcomes and a positive rounded plan.
- Toast lifetime is exactly 10,000 milliseconds.
- Default development policy is VND 100,000 bankroll, VND 30,000 minimum per leg, VND 100,000 maximum/balance per leg, and VND 1,000 stake step.
- Copy must say `READY TO PREFLIGHT`; it must not claim guaranteed placement or profit.

---

### Task 1: Pure watched-market stake planner

**Files:**
- Create: `apps/web/src/watch/arbitrage-alert.ts`
- Create: `apps/web/src/watch/arbitrage-alert.test.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `ComparisonRow`, selected provider IDs, and `optimizeStakes` from `@tool-chenh/core`.
- Produces: `buildArbitrageAlert(row, selectedProviders, policy): WatchArbitrageAlert | null` and `DEFAULT_WATCH_STAKE_POLICY`.

- [ ] **Step 1: Write failing planner tests**

Cover a profitable `FT_TOTAL` row, a three-way `FT_1X2` row, and rejection of incomplete, suspended, single-provider, filtered-provider, invalid-price, and rounded-unprofitable inputs. Assert exact provider/selection/odds/stake legs and exact worst-case profit/ROI strings.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/arbitrage-alert.test.ts`

Expected: FAIL because `arbitrage-alert.ts` and `buildArbitrageAlert` do not exist.

- [ ] **Step 3: Implement the minimal planner**

Select the best valid open quote for each expected outcome, require at least two providers, call `optimizeStakes` with the exact policy constraints, reject null/non-positive plans, and return a stable fingerprint containing market identity, providers, odds, and stakes.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/arbitrage-alert.test.ts`

Expected: all planner cases PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: calculate watched arbitrage plans`

### Task 2: Ten-second alert toast

**Files:**
- Create: `apps/web/src/components/arbitrage-alert-toast.tsx`
- Create: `apps/web/src/components/arbitrage-alert-toast.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `WatchArbitrageAlert | null`.
- Produces: `ArbitrageAlertToast({ alert, durationMs?: 10000 })` with `role="alert"`.

- [ ] **Step 1: Write failing toast lifecycle tests**

Assert the rendered plan fields, exact ten-second removal, no timer restart for the same fingerprint, restart for a changed fingerprint, and immediate removal when `alert` becomes null.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/components/arbitrage-alert-toast.test.tsx`

Expected: FAIL because the toast component does not exist.

- [ ] **Step 3: Implement the minimal toast and styling**

Use one effect keyed by the alert fingerprint, clear its timeout on change/unmount, render all legs and financial results, and include `Provider preflight is required before placement.`

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/components/arbitrage-alert-toast.test.tsx`

Expected: all lifecycle cases PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: show watched arbitrage toast`

### Task 3: Watch-detail integration and fail-closed lifecycle

**Files:**
- Modify: `apps/web/src/components/match-watch-detail.tsx`
- Modify: `apps/web/src/components/match-watch-detail.test.tsx`

**Interfaces:**
- Consumes: current comparison rows, selected providers, `watcherState`, and the pure planner.
- Produces: one highest-ROI visible alert and no alert outside fresh `WATCHING` state.

- [ ] **Step 1: Write failing integration tests**

Create two-provider catalogs with a profitable exact row. Assert one toast appears, contains both providers and calculated stakes, expires after 10 seconds, does not repeat while unchanged, reappears after an odds change, and is removed when one leg suspends or the watcher becomes stale/stopped.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/components/match-watch-detail.test.tsx`

Expected: FAIL because watch detail does not derive or render alerts.

- [ ] **Step 3: Implement minimal integration**

Filter each row to selected providers, derive eligible alerts only while `WATCHING`, sort by realized ROI then profit, and render only the best alert above current markets.

- [ ] **Step 4: Run focused and full web verification**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run
npm.cmd run typecheck --workspace @tool-chenh/web
npm.cmd run build --workspace @tool-chenh/web
```

Expected: all commands exit 0.

- [ ] **Step 5: Run workspace verification and commit**

Run: `npm.cmd run verify`

Expected: all workspace packages and integration tests PASS.

Commit message: `feat: alert profitable watched markets`
