# Two-way Fixed-base Stake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only verified two-outcome football markets and calculate an equal-payout cross-book plan with a global `100000 VND` stake fixed on the lower-odds leg.

**Architecture:** A pure `fixed-base-stake` module owns exact odds conversion, best-leg selection, hedge rounding, and profitability checks. Catalog comparison owns only exact event/market grouping and filters out non-two-way rows. The Live Catalog owns a persisted global base-stake setting and passes it to the list table and watched-match detail, both of which consume the same pure plan so displayed numbers and the ten-second toast cannot diverge.

**Tech Stack:** TypeScript, React, Decimal.js through `@tool-chenh/core`, Vitest, Testing Library, Vite, browser `localStorage`.

## Global Constraints

- This is observe/preflight-only; no bet placement control or API call is added.
- `FT_1X2` and all rows without exactly two distinct canonical outcomes are excluded.
- The lower decimal-odds leg receives the configured base stake; the higher-odds leg is rounded to the nearest valid `1000 VND` step that maximizes worst-case profit.
- A plan is publishable only when the best legs are from different selected providers, both market/quotes are `OPEN`, and both rounded outcome profits are strictly positive.
- Default base stake is `100000 VND`; persisted storage must contain no credentials or provider tokens.
- UI copy calls the calculation `Gross preflight`, because bookmaker fees and placement limits are not yet verified in this catalog path.

---

### Task 1: Exact fixed-base stake calculator

**Files:**
- Create: `apps/web/src/watch/fixed-base-stake.ts`
- Create: `apps/web/src/watch/fixed-base-stake.test.ts`
- Modify: `apps/web/src/watch/arbitrage-alert.ts`
- Modify: `apps/web/src/watch/arbitrage-alert.test.ts`

**Interfaces:**
- Consumes: `ComparisonRow`, selected `ProviderId` set, raw `ProviderQuote` values, and `FixedBaseStakePolicy`.
- Produces: `buildFixedBaseStakePlan(row, selectedProviders, policy): FixedBaseStakePlan | null` and `buildArbitrageAlert(...)` backed by that exact plan.

- [ ] **Step 1: Write failing calculator tests**

Add real-row tests that require the following result and rejection behavior:

```ts
expect(buildFixedBaseStakePlan(twoWayRow("1.8", "2.5"), selected, {
  currency: "VND", baseStake: "100000", minStake: "30000",
  maxStake: "100000", stakeStep: "1000", balance: "100000"
})).toMatchObject({
  legs: [
    { decimalOdds: "1.8", stake: "100000", role: "BASE" },
    { decimalOdds: "2.5", stake: "72000", role: "HEDGE" }
  ],
  totalStake: "172000",
  profitsBySelection: { OVER: "8000", UNDER: "8000" },
  worstCaseProfit: "8000"
});
expect(buildFixedBaseStakePlan(threeWayRow(), selected, policy)).toBeNull();
expect(buildFixedBaseStakePlan(nonArbitrageRow(), selected, policy)).toBeNull();
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/fixed-base-stake.test.ts`

Expected: FAIL because `fixed-base-stake.js` and `buildFixedBaseStakePlan` do not exist.

- [ ] **Step 3: Implement exact calculation**

Create these exported shapes:

```ts
export interface FixedBaseStakePolicy {
  readonly currency: string;
  readonly baseStake: string;
  readonly minStake: string;
  readonly maxStake: string;
  readonly stakeStep: string;
  readonly balance: string;
}

export interface FixedBaseStakeLeg {
  readonly provider: ProviderId;
  readonly selection: string;
  readonly decimalOdds: string;
  readonly stake: string;
  readonly payout: string;
  readonly profit: string;
  readonly role: "BASE" | "HEDGE";
}

export interface FixedBaseStakePlan {
  readonly fingerprint: string;
  readonly currency: string;
  readonly legs: readonly FixedBaseStakeLeg[];
  readonly totalStake: string;
  readonly profitsBySelection: Readonly<Record<string, string>>;
  readonly worstCaseProfit: string;
  readonly roi: string;
}
```

Use `Decimal` for every operation. Select the best open quote per outcome; reject outcome counts other than two and same-provider legs. Sort the two selected legs by decimal odds ascending with selection/provider tie-breaks. Fix `policy.baseStake` on the first leg, derive `continuousHedge = baseStake × lowOdds ÷ highOdds`, test `floor` and `ceil` step candidates, enforce constraints, and select greatest worst-case profit then lower total stake. Return `null` unless both outcome profits are positive.

- [ ] **Step 4: Run calculator tests and confirm GREEN**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/fixed-base-stake.test.ts`

Expected: all calculator tests PASS.

- [ ] **Step 5: Replace alert bankroll optimization with the fixed-base plan**

Change `WatchStakePolicy` to alias/extend `FixedBaseStakePolicy`, set `DEFAULT_WATCH_STAKE_POLICY.baseStake = "100000"`, and map the calculator result into the existing `WatchArbitrageAlert`. Remove the three-outcome success test and replace it with explicit `FT_1X2` rejection. Preserve the alert fingerprint, line/scope evidence, and ten-second toast contract.

- [ ] **Step 6: Verify alert tests and commit**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/fixed-base-stake.test.ts src/watch/arbitrage-alert.test.ts src/components/arbitrage-alert-toast.test.tsx`

Expected: PASS.

Commit:

```powershell
git add apps/web/src/watch/fixed-base-stake.ts apps/web/src/watch/fixed-base-stake.test.ts apps/web/src/watch/arbitrage-alert.ts apps/web/src/watch/arbitrage-alert.test.ts
git commit -m "feat: calculate fixed-base two-way stakes"
```

### Task 2: Exclude three-way football markets

**Files:**
- Modify: `apps/web/src/catalog/comparison.ts`
- Modify: `apps/web/src/catalog/comparison.test.ts`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/components/match-watch-detail.test.tsx`

**Interfaces:**
- Consumes: grouped `ComparisonCell[]` per exact market identity.
- Produces: `ComparisonEvent.rows` containing only rows whose complete canonical selection set has exactly two outcomes and whose `marketType !== "FT_1X2"`.

- [ ] **Step 1: Write failing filtering tests**

Create catalogs containing both `FT_1X2 HOME/DRAW/AWAY` and `FT_TOTAL OVER/UNDER`. Assert that the result contains only `FT_TOTAL`, while a malformed `FT_1X2` containing two quotes is still excluded:

```ts
expect(result[0]?.rows.map((row) => row.marketType)).toEqual(["FT_TOTAL"]);
expect(screen.queryByText("FT_1X2")).toBeNull();
expect(screen.getByText("FT_TOTAL")).toBeTruthy();
```

- [ ] **Step 2: Run comparison/page/detail tests and confirm RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/catalog/comparison.test.ts src/pages/live-catalog-page.test.tsx src/components/match-watch-detail.test.tsx`

Expected: FAIL because 1X2 is still returned/rendered.

- [ ] **Step 3: Add an explicit two-way row gate**

Add `isSupportedTwoWayRow(cells)` that rejects `FT_1X2`, requires exactly two distinct selections across the accepted market identity, and requires at least one complete two-selection cell. Filter row groups through it before margin calculation. Keep incomplete/open-state evidence inside an admitted row so downstream planning can fail closed without hiding provider gaps.

- [ ] **Step 4: Run tests and commit**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/catalog/comparison.test.ts src/pages/live-catalog-page.test.tsx src/components/match-watch-detail.test.tsx`

Expected: PASS.

Commit:

```powershell
git add apps/web/src/catalog/comparison.ts apps/web/src/catalog/comparison.test.ts apps/web/src/pages/live-catalog-page.test.tsx apps/web/src/components/match-watch-detail.test.tsx
git commit -m "fix: compare only two-way football markets"
```

### Task 3: Persist global base stake and show row plans

**Files:**
- Create: `apps/web/src/watch/stake-settings.ts`
- Create: `apps/web/src/watch/stake-settings.test.ts`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: `WATCH_BASE_STAKE_STORAGE_KEY`, `loadBaseStake(storage): string`, and `saveBaseStake(storage, value): boolean`.
- Consumes: `buildFixedBaseStakePlan` from Task 1 and filtered rows from Task 2.

- [ ] **Step 1: Write failing persistence and page tests**

Assert default `100000`, valid reload persistence, invalid/under-minimum input rejection, and visible exact plans:

```ts
expect(screen.getByLabelText("Base stake for every match (VND)")).toHaveValue(100000);
fireEvent.change(input, { target: { value: "150000" } });
expect(storage.getItem(WATCH_BASE_STAKE_STORAGE_KEY)).toBe("150000");
expect(screen.getByText("100,000 VND base")).toBeTruthy();
expect(screen.getByText("72,000 VND hedge")).toBeTruthy();
expect(screen.getAllByText("Profit 8,000 VND")).toHaveLength(2);
expect(screen.queryByText("FT_1X2")).toBeNull();
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/stake-settings.test.ts src/pages/live-catalog-page.test.tsx`

Expected: FAIL because the storage helpers, input, and balanced-plan column do not exist.

- [ ] **Step 3: Implement storage validation**

Use storage key `tool-chenh:watch-base-stake-v1`. Accept decimal text only when it is a whole VND amount, at least `30000`, and divisible by `1000`; otherwise return `false` and retain the last valid value. Never serialize account/provider data.

- [ ] **Step 4: Add the global input and balanced-plan column**

Initialize page state from `loadBaseStake(window.localStorage)`. Render a labeled numeric input in `.catalog-toolbar`, persist valid changes, and show inline validation for invalid values. Pass a policy derived from the last valid stake into `ComparisonTable`. Add a `Gross preflight` column that renders both legs, total, both outcome profits, worst-case profit, and ROI from `buildFixedBaseStakePlan`; otherwise render `No profitable two-book balance`.

- [ ] **Step 5: Run page tests and browser-check the list**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/stake-settings.test.ts src/pages/live-catalog-page.test.tsx`

Expected: PASS.

Open `http://127.0.0.1:4311/live-catalog`, reload once, set `100000`, and verify an admitted two-way row retains the input and shows no 1X2 row. Do not enter credentials or place a bet.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/watch/stake-settings.ts apps/web/src/watch/stake-settings.test.ts apps/web/src/pages/live-catalog-page.tsx apps/web/src/pages/live-catalog-page.test.tsx apps/web/src/styles.css
git commit -m "feat: configure global base stake"
```

### Task 4: Propagate stake configuration into match detail and toast

**Files:**
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/components/match-watch-detail.tsx`
- Modify: `apps/web/src/components/match-watch-detail.test.tsx`
- Modify: `apps/web/src/components/arbitrage-alert-toast.tsx`
- Modify: `apps/web/src/components/arbitrage-alert-toast.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `MatchWatchDetail` consumes `baseStake: string`.
- Detail row and `buildArbitrageAlert` consume the same `FixedBaseStakePolicy` constructed from that value.

- [ ] **Step 1: Write failing detail/toast tests**

Render detail with `baseStake="100000"` and a `1.8 / 2.5` cross-book row. Assert the detail table shows base `100000`, hedge `72000`, both `8000` profits, and the toast contains the same two stakes. Change provider selection or suspend one quote and assert both plan and toast disappear.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/components/match-watch-detail.test.tsx src/components/arbitrage-alert-toast.test.tsx`

Expected: FAIL because detail does not accept the global stake and does not render the row plan.

- [ ] **Step 3: Wire the shared plan into detail**

Pass `baseStake` from `LiveCatalogPage` to `MatchWatchDetail`. Construct one fixed-base policy per render. Use it for each detail row and for `buildArbitrageAlert`. Add the same `Gross preflight` presentation used by the list. Keep the existing watcher freshness gate, provider selection gate, and ten-second toast lifecycle.

- [ ] **Step 4: Make toast language exact**

Render `GROSS TWO-WAY PREFLIGHT`, mark the lower-odds leg as `BASE` and higher-odds leg as `HEDGE`, and show each outcome profit. Retain `Provider preflight is required before placement.` and do not add placement controls.

- [ ] **Step 5: Run focused tests and browser-check detail/toast**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/components/match-watch-detail.test.tsx src/components/arbitrage-alert-toast.test.tsx src/watch/arbitrage-alert.test.ts`

Expected: PASS.

Open one exact two-provider detail. Verify provider checkboxes control the calculation, the same stakes appear in the row and toast, and the toast disappears after ten seconds. Do not place a bet.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/pages/live-catalog-page.tsx apps/web/src/components/match-watch-detail.tsx apps/web/src/components/match-watch-detail.test.tsx apps/web/src/components/arbitrage-alert-toast.tsx apps/web/src/components/arbitrage-alert-toast.test.tsx apps/web/src/styles.css
git commit -m "feat: show fixed-base plans in match watch"
```

### Task 5: Full verification and operator documentation

**Files:**
- Modify: `docs/operator-guide.md`

**Interfaces:**
- Documents the exact scope and limitations of the completed feature.

- [ ] **Step 1: Update operator guidance**

Document the global stake field, lower-odds base rule, hedge formula, two-way-only filter, persisted local setting, `Gross preflight` meaning, and every fail-closed condition. Include the `1.8 / 2.5 / 100000` example and state that no bet is placed.

- [ ] **Step 2: Run fresh complete verification**

Run:

```powershell
npm.cmd run verify
npm.cmd run build
git diff --check
```

Expected: all typechecks, unit tests, integration tests, fixture readiness, watch smoke, and production builds pass; diff check exits zero.

- [ ] **Step 3: Review requirement coverage**

Confirm from rendered output and tests: only two-way rows, fixed lower-odds base stake, rounded hedge, two explicit profits, positive-only alert, persistence across reload, provider/open/freshness gating, and no placement control.

- [ ] **Step 4: Commit**

```powershell
git add docs/operator-guide.md docs/superpowers/plans/2026-08-10-two-way-fixed-stake.md
git commit -m "docs: explain two-way stake preflight"
```
