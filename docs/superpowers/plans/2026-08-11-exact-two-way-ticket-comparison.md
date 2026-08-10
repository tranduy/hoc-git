# Exact Two-Way Ticket Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real full-time half-goal Asian-handicap tickets from every selected provider, compare the exact same ticket side by side at all times, and turn the row green only after a price movement creates at least `20000 VND` worst-case profit from a `100000 VND` base leg.

**Architecture:** Extend the live provider extraction and normalization boundary so `FT_AH` reaches the existing provider catalog with a canonical home-oriented handicap. Add observational ticket rows alongside the existing strict comparison rows: observational rows may contain one provider and are always displayable, while strict lag signals still require two exact providers, fresh open quotes, a real price change, and the profit threshold. Render the same observational model in the catalog and watched-match views.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Playwright DOM extraction, Decimal.js, Vite.

## Global Constraints

- Football focus: `FT_AH` at `FULL_TIME` with a half-goal line (`n + 0.5`) only.
- Exclude 1X2, totals, draw outcomes, integer handicaps, and quarter handicaps such as `0.25`, `0.5/1`, and `0.75` from this focused ticket view.
- Match only exact event identity, market type, scope, canonical home-oriented line, settlement profile, and complete `HOME|AWAY` domain.
- Base stake is `100000 VND`; a green candidate requires rounded worst-case profit `>= 20000 VND`.
- Always show neutral tickets even when there is no edge; never synthesize a missing provider price.
- Live events and events starting in the next `7200000 ms` are visible.
- Automated bet submission remains out of scope.

---

### Task 1: Extract and normalize full-time Asian handicap

**Files:**
- Modify: `apps/api/src/providers/browser-protocol-inspector.ts`
- Modify: `apps/api/src/providers/browser-protocol-inspector.test.ts`
- Modify: `apps/api/src/providers/cmd/cmd-observed-catalog.ts`
- Modify: `apps/api/src/providers/cmd/cmd-observed-catalog.test.ts`
- Modify: `apps/api/src/providers/sbobet/sbobet-browser-manager.ts`
- Create: `apps/api/src/providers/sbobet/sbobet-browser-manager.test.ts`
- Modify: `packages/adapters/src/cmd/cmd-normalizer.ts`
- Modify: `packages/adapters/src/cmd/cmd-normalizer.test.ts`
- Modify: `packages/adapters/src/sbobet/sbobet-normalizer.ts`
- Modify: `packages/adapters/src/sbobet/sbobet-normalizer.test.ts`

**Interfaces:**
- Extend `CmdCatalogOdd` with `readonly lineText?: string | null`.
- Extend `SbobetCatalogSelection` with `readonly lineText?: string | null` and allow `selection: "HOME" | "AWAY"` for `FT_AH`.
- Extend `SbobetCatalogMarket.marketType` to include `"FT_AH"`.
- Produce `ProviderMarket { marketType: "FT_AH", scope: "FULL_TIME", line: canonicalHomeLine }` and two `ProviderQuote`s with `HOME` and `AWAY`.

- [ ] **Step 1: Write failing adapter normalization tests**

Add cases proving that a home-row displayed `0.5` becomes canonical home line `-0.5`, an away-row displayed `0.5` becomes `+0.5`, and `0.5/1` is parsed as `0.75` but retained only as raw normalized provider evidence (the focused UI filters it later). Assert that malformed or contradictory per-selection lines reject the market.

```ts
expect(normalizeObservedFootballCatalog("SABA", [halfGoalRecord], options).markets[0])
  .toMatchObject({ marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5" });
expect(result.quotes.map((quote) => quote.selection)).toEqual(["HOME", "AWAY"]);
```

- [ ] **Step 2: Run adapter tests and verify RED**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/adapters -- --run src/cmd/cmd-normalizer.test.ts src/sbobet/sbobet-normalizer.test.ts
```

Expected: FAIL because bet type `1` and SBOBET handicap columns are unsupported.

- [ ] **Step 3: Capture per-selection handicap evidence**

For CMD/SABA, collect the non-price text from each `.c-odds-button` after removing `.c-odds`, and store it on the corresponding odd as `lineText`. For SBOBET, read `columns[0]` as `FT_AH`, assign odds by row to `HOME`/`AWAY`, and retain each row's line text. Do not infer a line if neither row exposes one.

- [ ] **Step 4: Normalize to a canonical home line**

Implement one bounded helper in each adapter package:

```ts
function canonicalHomeHandicap(selections: readonly { selection: "HOME" | "AWAY"; lineText?: string | null }[]): string | null
```

Parse one- or two-number display forms, preserve explicit signs, infer an unsigned displayed line as a giving handicap on the row that displays it, invert an away handicap into home orientation, and reject conflicting evidence. Emit `FT_AH`, `FULL_TIME`, `HOME|AWAY`, Malay odds, and the existing football settlement profile. Allow bet type `1` through `CmdObservedCatalogReader` instead of counting it as unsupported.

- [ ] **Step 5: Add extraction and reader regressions**

Assert that browser extraction retains which team row displayed `0.5`, that SABA reader returns the `FT_AH` market, and that SBOBET extraction reads the handicap column without changing Total/1X2 behavior.

- [ ] **Step 6: Run focused tests and typechecks**

```powershell
npm.cmd test --workspace @tool-chenh/adapters -- --run src/cmd/cmd-normalizer.test.ts src/sbobet/sbobet-normalizer.test.ts
npm.cmd test --workspace @tool-chenh/api -- --run src/providers/browser-protocol-inspector.test.ts src/providers/cmd/cmd-observed-catalog.test.ts src/providers/saba/saba-observed-catalog.test.ts src/providers/sbobet/sbobet-browser-manager.test.ts
npm.cmd run typecheck --workspace @tool-chenh/adapters
npm.cmd run typecheck --workspace @tool-chenh/api
```

- [ ] **Step 7: Commit**

```powershell
git add apps/api/src/providers packages/adapters/src
git commit -m "feat: capture exact full-time handicap tickets"
```

---

### Task 2: Build always-visible observational ticket rows

**Files:**
- Modify: `apps/web/src/catalog/comparison.ts`
- Modify: `apps/web/src/catalog/comparison.test.ts`

**Interfaces:**
- Add `ObservedTicketRow` with `key`, `marketType`, `scope`, `line`, `settlementProfile`, `outcomeDomain`, and `cells`.
- Add `readonly observedRows: readonly ObservedTicketRow[]` to `ComparisonEvent`.
- Export `isFocusedTwoWayTicket(market, quotes): boolean`.
- Export `isVisibleEvent(event, nowMs, horizonMs = 7_200_000): boolean`.
- Keep `ComparisonEvent.rows` unchanged as the strict two-provider signal input.

- [ ] **Step 1: Write failing comparison tests**

Cover these exact cases, plus a LoL `SERIES_WINNER` row with exactly two team outcomes:

```ts
expect(singleSabaEvent.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SABA"]);
expect(twoBookNoEdge.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SABA", "SBOBET"]);
expect(quarterLine.observedRows).toEqual([]);
expect(drawMarket.observedRows).toEqual([]);
expect(isVisibleEvent(liveEvent, now)).toBe(true);
expect(isVisibleEvent(startsInTwoHours, now)).toBe(true);
expect(isVisibleEvent(startsAfterTwoHours, now)).toBe(false);
```

Also assert that `HOME -0.5/AWAY +0.5` maps together across reversed provider display order, while `FT_AH -0.5` never maps to `FT_AH +0.5`.

- [ ] **Step 2: Run the comparison test and verify RED**

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/catalog/comparison.test.ts
```

Expected: FAIL because `observedRows`, focused-market filtering, and horizon filtering do not exist.

- [ ] **Step 3: Implement observational grouping**

Build `observedRows` from each matched event's accepted provider markets before the existing `eligibleTwoWayCells` filter. A focused Football row accepts one or more cells but requires each populated cell to contain exactly the complete `HOME|AWAY` domain and a half-goal canonical line. A focused LoL row requires `SERIES_WINNER`, `SERIES`, no line, and the same exact two-team outcome domain. Group only by exact semantic market key and preserve provider-specific raw odds/status in each cell.

- [ ] **Step 4: Preserve strict signal rows**

Derive existing `rows` only from observational groups containing at least two distinct providers with the same complete domain. Do not allow a one-provider observational row into `buildFixedBaseStakePlan` or `LagSignalTracker`.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/catalog/comparison.test.ts
npm.cmd run typecheck --workspace @tool-chenh/web
```

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/catalog/comparison.ts apps/web/src/catalog/comparison.test.ts
git commit -m "feat: build always-visible exact ticket rows"
```

---

### Task 3: Enforce the movement and `20000 VND` signal threshold

**Files:**
- Modify: `apps/web/src/watch/lag-signal-tracker.ts`
- Modify: `apps/web/src/watch/lag-signal-tracker.test.ts`

**Interfaces:**
- Introduce `LagSignalPolicy { maxQuoteAgeMs: number; minimumWorstCaseProfit: string }`.
- Construct with `new LagSignalTracker({ maxQuoteAgeMs: 5_000, minimumWorstCaseProfit: "20000" })`.
- Continue returning at most five `LagSignal`s ordered by realized ROI, worst-case profit, then trigger time.

- [ ] **Step 1: Write failing threshold tests**

Seed an unchanged baseline and prove it never signals. Then change one provider price and assert:

```ts
expect(signalAt19999).toEqual([]);
expect(signalAt20000[0]?.plan.worstCaseProfit).toBe("20000");
expect(signalAt20000[0]?.movements).toEqual(expect.arrayContaining([
  expect.objectContaining({ provider: "SABA", previousDecimal: "1.7", currentDecimal: "2.2" })
]));
```

Retain regressions for stale quotes, suspended legs, vanished edge, and same-provider best outcomes.

- [ ] **Step 2: Run tracker tests and verify RED**

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/watch/lag-signal-tracker.test.ts
```

Expected: FAIL because the tracker currently accepts any positive profit.

- [ ] **Step 3: Apply exact Decimal threshold comparison**

Use `new Decimal(plan.worstCaseProfit).greaterThanOrEqualTo(policy.minimumWorstCaseProfit)` after stake rounding. Reject the candidate before storing it in `#active`; do not convert financial values to JavaScript `number` for the threshold.

- [ ] **Step 4: Run tests and typecheck**

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/watch/lag-signal-tracker.test.ts src/watch/fixed-base-stake.test.ts
npm.cmd run typecheck --workspace @tool-chenh/web
```

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/watch/lag-signal-tracker.ts apps/web/src/watch/lag-signal-tracker.test.ts
git commit -m "feat: require twenty-thousand profit after movement"
```

---

### Task 4: Render tickets continuously and green only active candidates

**Files:**
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/components/match-watch-detail.tsx`
- Modify: `apps/web/src/components/match-watch-detail.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Catalog cards consume `ComparisonEvent.observedRows` and show up to three focused tickets inline.
- Match detail renders every `observedRows` entry with one selected-provider column per book.
- A row receives `ticket-row ticket-row--profitable` only when its key appears in the active `LagSignalTracker` result.

- [ ] **Step 1: Write failing UI tests**

Add DOM assertions for:

1. One SABA-only `FT_AH -0.5` ticket shows HOME/AWAY odds and `SBOBET: No exact event match`.
2. Two providers with the same ticket and no edge show both rates and `No profitable two-book balance`, with no green class and no alert.
3. After one polled provider moves and worst-case profit reaches exactly `20000 VND`, the row gains `ticket-row--profitable`, shows both stakes and both outcome profits, and raises one ten-second alert.
4. A `19999 VND`, suspended, stale, quarter-line, or mismatched-line case never turns green.
5. Live and next-two-hour event cards show tickets; later events are absent.

- [ ] **Step 2: Run UI tests and verify RED**

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/pages/live-catalog-page.test.tsx src/components/match-watch-detail.test.tsx
```

Expected: FAIL because detail currently renders only strict cross-book rows and initial profitable prices can alert without movement.

- [ ] **Step 3: Render neutral observational rows**

Replace the detail condition that selects either `currentComparison.rows` or a provider-only fallback. Always render `currentComparison.observedRows`; when the exact event is missing from other selected books, retain those columns and explicit missing-state cells. Include provider, selection, line, raw odds format, quote status, and market status.

On catalog cards, render up to three observational tickets without requiring margin or a second provider. Keep the full detail button for all remaining tickets.

- [ ] **Step 4: Integrate movement-qualified green state**

Seed a detail-local `LagSignalTracker` from the initial comparison without producing a signal. Feed it every accepted poll, update active signals, and map signal keys back to observational rows. Always show neutral prices; add the green class and full stake/profit block only for an active signal meeting the threshold. Remove green immediately on suspension, staleness, missing price, or vanished edge.

- [ ] **Step 5: Apply focused visual hierarchy**

Use a neutral dark border for ordinary tickets, amber text for missing/suspended evidence, and the existing positive green token for `ticket-row--profitable`. Put `ĐỦ ĐIỀU KIỆN · LÃI ≥ 20.000 VND` in the green frame and keep `READ-ONLY` visible. Do not use green for best price alone.

- [ ] **Step 6: Run focused and full web verification**

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/pages/live-catalog-page.test.tsx src/components/match-watch-detail.test.tsx
npm.cmd test --workspace @tool-chenh/web -- --run
npm.cmd run typecheck --workspace @tool-chenh/web
```

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/pages/live-catalog-page.tsx apps/web/src/pages/live-catalog-page.test.tsx apps/web/src/components/match-watch-detail.tsx apps/web/src/components/match-watch-detail.test.tsx apps/web/src/styles.css
git commit -m "feat: show exact tickets and highlight qualified gaps"
```

---

### Task 5: Verify the real stack and document operator evidence

**Files:**
- Modify: `docs/operator/live-session-setup.md`

**Interfaces:**
- No new runtime interface.

- [ ] **Step 1: Update operator documentation**

Document the focused `FT_AH` half-goal rule, exact cross-provider mapping evidence, two-hour event horizon, `100000 VND` base leg, `20000 VND` worst-case threshold, neutral-versus-green meaning, and read-only boundary.

- [ ] **Step 2: Run complete verification**

```powershell
npm.cmd run verify
npm.cmd run build
git diff --check
```

Expected: all workspace typechecks, unit tests, integration tests, fixture readiness tests, smoke tests, and production builds pass.

- [ ] **Step 3: Inspect real local catalogs**

Read `/api/accounts` and each selected account's `/api/catalog/accounts/:accountId`. Confirm that `FT_AH` tickets, normalized lines, quote states, provider identities, event counts, and rejected-market counts are present without printing secrets.

- [ ] **Step 4: Verify localhost UI**

Open `http://127.0.0.1:4311/live-catalog`, refresh, and confirm:

- neutral tickets appear without an edge;
- missing providers remain explicit;
- the same canonical ticket aligns across providers;
- green appears only after a qualifying movement;
- the ten-second alert disappears on time;
- no bet control exists.

- [ ] **Step 5: Commit documentation**

```powershell
git add docs/operator/live-session-setup.md
git commit -m "docs: explain exact ticket monitoring"
```
