# Top Profitable Two-Book Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render at most five exact cross-book two-outcome tickets per Football/LoL event, rank them by verified guaranteed profit, and emit a five-second clickable sound alert when both legs pass provider preflight with at least 20,000 VND worst-case profit.

**Architecture:** Keep event and market identity in `buildComparisonEvents`; only its exact `ComparisonEvent.rows` may enter this feature. Split financial work into a pure pair enumerator/calculator and an asynchronous preflight coordinator. The React page consumes immutable ranked candidates, while an isolated alert tracker owns transition/deduplication state and a toast stack owns presentation/expiry/audio. No wager endpoint is called.

**Tech Stack:** TypeScript 5.9, React 19, Vitest 3, Testing Library, decimal.js through `@tool-chenh/core`, existing Fastify provider-preflight endpoint, CSS.

**Approved specification:** `docs/superpowers/specs/2026-08-12-top-profitable-two-book-tickets-design.md`

**Safety boundary:** This plan adds read-only provider preflight checks only. It must not call `/api/execution/*`, arm execution, or submit either leg.

---

## Task 1: Add a strict web client for provider ticket preflight

**Files:**
- Create: `apps/web/src/api/provider-preflight.ts`
- Create: `apps/web/src/api/provider-preflight.test.ts`

- [x] **Step 1: Write the failing parser/request tests**

Test the exact request body, `cache: "no-store"`, successful `ProviderTicketPreflightSchema` parsing, non-2xx error propagation, malformed response rejection, and verify that no execution URL is ever used.

```ts
it("posts one exact ticket leg and parses verified constraints", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const api = new ProviderPreflightApi(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(providerPreflight), { status: 200,
      headers: { "content-type": "application/json" } });
  });
  await expect(api.preflight(request)).resolves.toEqual(providerPreflight);
  expect(calls).toEqual([{ url: "/api/preflight/provider", body: request }]);
});
```

- [x] **Step 2: Run the focused test and record RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/api/provider-preflight.test.ts`

Expected: FAIL because `provider-preflight.ts` does not exist.

- [x] **Step 3: Implement the minimal strict client**

Expose only:

```ts
export interface ProviderPreflightApiLike {
  preflight(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight>;
}

export class ProviderPreflightApi implements ProviderPreflightApiLike {
  constructor(fetcher: typeof fetch = window.fetch.bind(window));
  preflight(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight>;
}
```

Validate outbound input with `ProviderTicketPreflightRequestSchema`, validate inbound JSON with `ProviderTicketPreflightSchema`, and map non-2xx JSON `{error}` to a safe `Error`. Never persist the result because its lifetime is at most three seconds.

- [x] **Step 4: Run focused tests and typecheck**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/api/provider-preflight.test.ts
npm.cmd run typecheck --workspace @tool-chenh/web
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add apps/web/src/api/provider-preflight.ts apps/web/src/api/provider-preflight.test.ts
git commit -m "feat: add strict provider preflight client"
```

## Task 2: Enumerate every opposing cross-book leg pair and calculate exact stakes

**Files:**
- Modify: `apps/web/src/watch/fixed-base-stake.ts`
- Modify: `apps/web/src/watch/fixed-base-stake.test.ts`

- [x] **Step 1: Add RED tests for provider-pair permutations**

Cover all of the following in `fixed-base-stake.test.ts`:

- three providers produce all valid `selection A provider × selection B provider` combinations except same-provider pairs;
- a worse raw quote can win when the best raw quote fails min/max/step/balance constraints;
- lower-decimal leg always receives the configured 100,000 VND base stake;
- hedge stake is rounded to the hedge provider's native step and the chosen plan maximizes `min(profitA, profitB)`;
- fees affect effective decimal odds and both outcome profits;
- stale/missing constraint, same provider, suspended quote, three-way row and `FT_1X2` return no verified plan;
- deterministic tie-break is provider, selection and provider selection ID.

Use exact decimal assertions, for example:

```ts
expect(plan?.legs.map(({ provider, selection, stake }) => ({ provider, selection, stake })))
  .toEqual([
    { provider: "SABA", selection: "HOME", stake: "100000" },
    { provider: "SBOBET", selection: "AWAY", stake: "72000" }
  ]);
expect(plan?.worstCaseProfit).toBe("20000");
```

- [x] **Step 2: Run RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/fixed-base-stake.test.ts`

Expected: at least the all-permutations/fallback test fails because the current implementation selects only one best quote per outcome before applying constraints.

- [x] **Step 3: Refactor calculation into explicit leg-pair primitives**

Add these exports without moving identity decisions into the calculator:

```ts
export interface OpposingLegPair {
  readonly first: { provider: ProviderId; quote: ProviderQuote };
  readonly second: { provider: ProviderId; quote: ProviderQuote };
}

export function enumerateOpposingLegPairs(
  row: ComparisonRow,
  selectedProviders: ReadonlySet<ProviderId>
): readonly OpposingLegPair[];

export function buildFixedBaseStakePlanForPair(
  row: ComparisonRow,
  pair: OpposingLegPair,
  policy: FixedBaseStakePolicy,
  observedAtMs?: number
): FixedBaseStakePlan | null;
```

`buildFixedBaseStakePlan` must evaluate every enumerated pair, sort by worst-case profit descending, ROI descending, then fingerprint ascending, and return the first plan. Keep all arithmetic in `Decimal`; serialize plain decimal strings only.

- [x] **Step 4: Run focused and regression tests**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/watch/fixed-base-stake.test.ts src/catalog/comparison.test.ts
npm.cmd run typecheck --workspace @tool-chenh/web
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add apps/web/src/watch/fixed-base-stake.ts apps/web/src/watch/fixed-base-stake.test.ts
git commit -m "fix: optimize every cross-book leg pair"
```

## Task 3: Verify both legs through short-lived provider preflight

**Files:**
- Create: `apps/web/src/watch/ticket-preflight-coordinator.ts`
- Create: `apps/web/src/watch/ticket-preflight-coordinator.test.ts`

- [x] **Step 1: Write coordinator RED tests**

Use a fake `ProviderPreflightApiLike` and fake clock. Test:

- only exact `event.rows`, selected providers and distinct catalog account IDs are considered;
- the first pass requests both estimated stakes, then recomputes using returned constraints;
- if recomputed stakes differ, a second pass verifies both exact final stakes;
- result is published only when both final responses are `eligible`, identity fields match request, quotes remain OPEN, odds equal the current expected decimal odds, constraints share currency and are unexpired;
- any rejection, timeout, stale constraint, odds drift, missing PREFLIGHT capability, account reuse, row removal or selected-provider removal clears verified evidence;
- concurrent refreshes for the same fingerprint coalesce; an older response cannot overwrite a newer generation;
- no URL or method related to execution is invoked.

Core test shape:

```ts
const coordinator = new TicketPreflightCoordinator(api, () => 10_000);
const result = await coordinator.refresh({ events: [event], selectedAccounts,
  selectedProviders: new Set(["SABA", "SBOBET"]), policy: observedPolicy });
expect(result.get(`${event.key}::${row.key}`)?.status).toBe("VERIFIED");
expect(api.requests.every((request) => request.requestedStake !== "0")).toBe(true);
```

- [x] **Step 2: Run RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/ticket-preflight-coordinator.test.ts`

Expected: FAIL because the coordinator does not exist.

- [x] **Step 3: Implement fail-closed two-phase verification**

Expose:

```ts
export interface VerifiedTicketEvidence {
  readonly key: string;                 // event key + row key
  readonly eventKey: string;
  readonly rowKey: string;
  readonly plan: FixedBaseStakePlan;
  readonly verifiedAtMs: number;
  readonly expiresAtMs: number;
}

export class TicketPreflightCoordinator {
  refresh(input: TicketPreflightRefreshInput): Promise<ReadonlyMap<string, VerifiedTicketEvidence>>;
  clear(): void;
}
```

Algorithm for each exact row and each opposing provider pair:

1. Build an observation plan only to obtain non-zero initial requested stakes.
2. Preflight both legs in parallel using exact account/event/market/selection IDs.
3. Build a verified plan from both returned `ProviderStakeConstraint` values.
4. If either stake changed, preflight both final legs again.
5. Revalidate every identity, odds, status, constraint timestamp and requested stake.
6. Select the verified pair with greatest worst-case profit.

Preflight every opposing pair whose optimistic no-fee/no-rounding plan can still reach the 20,000 VND threshold; this is a safe upper-bound filter because verified fees and native rounding cannot improve that optimistic profit. Do not truncate candidates before verification: the five-row limit is applied only after verified ranking. Bound request concurrency per provider, coalesce identical in-flight requests, and do not retry an errored key before its next catalog generation. The result map contains only evidence whose `expiresAtMs > nowMs`.

- [x] **Step 4: Run focused tests and typecheck**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/api/provider-preflight.test.ts src/watch/fixed-base-stake.test.ts src/watch/ticket-preflight-coordinator.test.ts
npm.cmd run typecheck --workspace @tool-chenh/web
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add apps/web/src/watch/ticket-preflight-coordinator.ts apps/web/src/watch/ticket-preflight-coordinator.test.ts
git commit -m "feat: verify exact catalog ticket pairs"
```

## Task 4: Build a pure top-five ranked ticket view model

**Files:**
- Create: `apps/web/src/watch/ranked-tickets.ts`
- Create: `apps/web/src/watch/ranked-tickets.test.ts`
- Modify: `apps/web/src/catalog/comparison.test.ts`

- [x] **Step 1: Add ranking and fail-closed RED tests**

Create fixtures with seven exact rows and mixed verified/observation evidence. Assert:

- input is `ComparisonEvent.rows`, never `observedRows`;
- different line, settlement, scope, outcome domain, ambiguous event and single-provider rows never appear;
- verified plans sort by worst-case profit descending, ROI descending, movement magnitude descending, key ascending;
- observation-only exact rows follow verified rows and are neutral;
- result is capped at five per event;
- event best-profit sort key is derived only from non-expired verified evidence.

- [x] **Step 2: Run RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/ranked-tickets.test.ts src/catalog/comparison.test.ts`

Expected: FAIL because ranked view models do not exist and current UI-oriented behavior still relies on observed rows.

- [x] **Step 3: Implement pure ranking**

```ts
export interface RankedTicket {
  readonly key: string;
  readonly eventKey: string;
  readonly row: ComparisonRow;
  readonly plan: FixedBaseStakePlan | null;
  readonly state: "VERIFIED_PROFIT" | "VERIFIED_NO_PROFIT" | "OBSERVATION";
  readonly reason: string | null;
  readonly movementMagnitude: string;
}

export function rankTicketsForEvent(input: {
  event: ComparisonEvent;
  verified: ReadonlyMap<string, VerifiedTicketEvidence>;
  movements: readonly ObservedPriceMovement[];
  selectedProviders: ReadonlySet<ProviderId>;
  observationPolicy: FixedBaseStakePolicy;
  nowMs: number;
  limit?: number;
}): readonly RankedTicket[];
```

Use `Decimal` comparisons and a default limit of five. `VERIFIED_PROFIT` means `worstCaseProfit >= 20000`; zero/negative and expired evidence cannot be green. Keep observation calculations clearly labelled and exclude them from event profit rank.

- [x] **Step 4: Run focused tests and typecheck**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/watch/ranked-tickets.test.ts src/catalog/comparison.test.ts
npm.cmd run typecheck --workspace @tool-chenh/web
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add apps/web/src/watch/ranked-tickets.ts apps/web/src/watch/ranked-tickets.test.ts apps/web/src/catalog/comparison.test.ts
git commit -m "feat: rank top verified two-book tickets"
```

## Task 5: Replace the observed-row UI with the exact horizontal top-five table

**Files:**
- Create: `apps/web/src/components/ranked-ticket-table.tsx`
- Create: `apps/web/src/components/ranked-ticket-table.test.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/styles.css`

- [x] **Step 1: Write component/page RED tests**

Assert the rendered table has:

- maximum five rows per match;
- columns for exact ticket/line, every selected provider, chosen legs, both stakes, profit for each named participant, guaranteed profit and ROI;
- real team names from `ProviderEvent`, never `TEAM_A`/`TEAM_B` as visible labels;
- raw odds, decimal equivalent and quote status for each provider;
- best quote emphasis;
- green class only for `VERIFIED_PROFIT` at or above 20,000 VND;
- neutral reason for observation, stale, non-profitable and preflight-unavailable rows;
- Football and LoL route separation remains intact;
- events sort by best verified guaranteed profit and still show exact neutral rows when no profitable signal exists.

Also add a regression that fails if `ComparisonTable` or its replacement iterates `observedRows`.

- [x] **Step 2: Run RED**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/components/ranked-ticket-table.test.tsx src/pages/live-catalog-page.test.tsx
```

Expected: FAIL because the current table renders `item.observedRows`, may show single-provider estimates, and has no five-row view model.

- [x] **Step 3: Implement the presentational table**

`RankedTicketTable` receives only `event`, `providers`, and already-ranked `tickets`; it must perform no mapping or financial calculation. Use one `<tr id={ticketDomId(eventKey, ticket.key)}>` per ticket and a horizontally scrollable wrapper. Display signed Football line and named LoL sides. Remove `ComparisonTable` and stop deriving `displayEvents`, `comparisonCount`, and `crossBookEventCount` from `observedRows`; derive them from ranked exact rows.

- [x] **Step 4: Wire the preflight coordinator into page polling**

After each accepted fresh catalog generation:

1. build exact comparison events;
2. refresh provider preflight evidence using the selected account per provider;
3. discard the result if category/selection/catalog generation changed while awaiting;
4. rank tickets and update the page atomically;
5. retain neutral exact rows when preflight is unavailable, but never retain expired green state.

The 250 ms catalog poll must not overlap provider preflight refreshes. Preflight failures update the ticket reason only; they must not blank the catalog.

- [x] **Step 5: Add compact horizontal styling**

Add `.ranked-ticket-table`, `.ranked-ticket-row--profitable`, `.ranked-ticket-row--neutral`, provider price cells, selected-leg cells and mobile overflow rules. Preserve provider and participant labels at all viewport widths.

- [x] **Step 6: Run web tests and typecheck**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/components/ranked-ticket-table.test.tsx src/pages/live-catalog-page.test.tsx src/catalog/comparison.test.ts
npm.cmd run typecheck --workspace @tool-chenh/web
```

Expected: PASS.

- [x] **Step 7: Commit**

```powershell
git add apps/web/src/components/ranked-ticket-table.tsx apps/web/src/components/ranked-ticket-table.test.tsx apps/web/src/pages/live-catalog-page.tsx apps/web/src/pages/live-catalog-page.test.tsx apps/web/src/styles.css
git commit -m "feat: show top exact tickets by guaranteed profit"
```

## Task 6: Add deduplicated five-second toast stack, sound and exact deep-link

**Files:**
- Create: `apps/web/src/watch/profit-alert-tracker.ts`
- Create: `apps/web/src/watch/profit-alert-tracker.test.ts`
- Create: `apps/web/src/watch/notification-sound.ts`
- Create: `apps/web/src/watch/notification-sound.test.ts`
- Create: `apps/web/src/components/profit-toast-stack.tsx`
- Create: `apps/web/src/components/profit-toast-stack.test.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/components/match-watch-detail.tsx`
- Modify: `apps/web/src/components/match-watch-detail.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write alert lifecycle RED tests**

For `ProfitAlertTracker`, assert:

- first transition into verified `>= 20000` emits once;
- unchanged polls do not repeat;
- profit increase below 5,000 does not repeat and increase of exactly 5,000 does;
- falling below threshold/stale/suspended/row removal arms a future re-entry alert;
- identity is `event key + ticket key + sorted provider/selection legs`;
- observation-only tickets never alert.

- [ ] **Step 2: Write toast/audio/deep-link RED tests**

With fake timers, render six alerts and assert only five remain, newest is at the bottom, each expires after exactly 5,000 ms, and clicking creates:

```text
/football-live?event=<encoded-provider-event-id>&account=<encoded-account-id>&ticket=<encoded-exact-ticket-key>
```

Assert the detail page scrolls/focuses the exact ticket row and applies a temporary highlight. Mock `AudioContext` and test no sound before pointer/keyboard unlock, one short sound per newly enqueued alert after unlock, and swallowed constructor/resume/start errors.

- [ ] **Step 3: Run RED**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/watch/profit-alert-tracker.test.ts src/watch/notification-sound.test.ts src/components/profit-toast-stack.test.tsx src/pages/live-catalog-page.test.tsx src/components/match-watch-detail.test.tsx
```

Expected: FAIL because only one ten-second non-clickable toast exists and no audio/deep-link ticket identity exists.

- [ ] **Step 4: Implement pure alert tracking**

```ts
export interface ProfitAlert {
  readonly id: string;
  readonly ticket: RankedTicket;
  readonly event: ComparisonEvent;
  readonly createdAtMs: number;
}

export class ProfitAlertTracker {
  update(events: readonly RankedEvent[], nowMs: number): readonly ProfitAlert[];
}
```

Store last alerted profit and whether each identity is currently above threshold. Return only newly emitted alerts from each update; prune identities no longer present after marking them below threshold.

- [ ] **Step 5: Implement sound and toast presentation**

Use a tiny Web Audio oscillator created only after a global `pointerdown` or `keydown`. `play()` must return without throwing. `ProfitToastStack` owns the five-second timers and maximum-five visible queue; it receives an `onOpen(alert)` callback rather than editing location itself.

- [ ] **Step 6: Wire exact navigation and detail highlight**

Extend the page's request parsing with `ticket`. On toast click, set `event`, `account`, and exact `ticket` query params, open the already-mapped event, and pass `highlightTicketKey` to `MatchWatchDetail`/the ranked table. Use `CSS.escape` or React refs, `scrollIntoView({ block: "center" })`, and focus a row with `tabIndex={-1}`. If the exact ticket expired before navigation, show an explicit message and never highlight a different ticket.

- [ ] **Step 7: Run focused tests and typecheck**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/watch/profit-alert-tracker.test.ts src/watch/notification-sound.test.ts src/components/profit-toast-stack.test.tsx src/pages/live-catalog-page.test.tsx src/components/match-watch-detail.test.tsx
npm.cmd run typecheck --workspace @tool-chenh/web
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/src/watch/profit-alert-tracker.ts apps/web/src/watch/profit-alert-tracker.test.ts apps/web/src/watch/notification-sound.ts apps/web/src/watch/notification-sound.test.ts apps/web/src/components/profit-toast-stack.tsx apps/web/src/components/profit-toast-stack.test.tsx apps/web/src/pages/live-catalog-page.tsx apps/web/src/pages/live-catalog-page.test.tsx apps/web/src/components/match-watch-detail.tsx apps/web/src/components/match-watch-detail.test.tsx apps/web/src/styles.css
git commit -m "feat: alert on verified profitable ticket transitions"
```

## Task 7: Prove read-only behavior, run the full gate and update the fixed checklist

**Files:**
- Modify: `tests/e2e/operator-dashboard.spec.ts`
- Modify: `scripts/smoke-watch-match.test.mjs`
- Modify: `proccess.md`

- [ ] **Step 1: Add an E2E RED scenario**

Extend the fixture stack with two exact provider rows and catalog generations that move from neutral to at least 20,000 VND guaranteed profit. Assert:

- Football and LoL screens remain separate;
- real participant names and no more than five exact tickets render;
- the neutral row becomes green on the profitable generation;
- both stakes, both outcome profits, guaranteed profit and ROI are visible;
- one toast appears, clicking it opens/highlights the exact ticket, and it expires after five seconds;
- intercepted requests contain catalog/profile/provider-preflight calls only and zero `/api/execution/`, arm or wager-submit requests.

- [ ] **Step 2: Run the targeted E2E test and record RED**

Run: `npm.cmd run test:e2e -- --grep "top profitable exact tickets"`

Expected: FAIL until fixture generations and page integration are complete.

- [ ] **Step 3: Complete fixture data and smoke assertions**

Keep fixture identities/provider market IDs explicit. Update `smoke-watch-match.test.mjs` to log only provider/category counts, exact row count, selected legs, odds, calculated stakes, outcome profits and toast transition. Redact tokens, cookies, credentials and launch URLs.

- [ ] **Step 4: Update the fixed project checklist**

Under the existing schedule in `proccess.md`, mark this feature as one fixed task with sub-checkboxes for exact mapping, verified preflight, top-five ranking, horizontal table, alert lifecycle, sound/deep-link and read-only verification. Do not create or renumber unrelated schedule tasks.

- [ ] **Step 5: Run fresh complete verification**

Run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration
npm.cmd run test:fixture-stack
npm.cmd run test:watch-smoke
npm.cmd run build
npm.cmd run test:e2e -- --grep "top profitable exact tickets"
git diff --check
```

Expected: every command exits 0. Review output for secrets and confirm no live wager path was invoked.

- [ ] **Step 6: Perform a browser smoke on both fixed routes**

Start the existing local fixture stack and inspect `/football-live` and `/lol-live` at desktop and narrow widths. Verify horizontal scrolling, green threshold, five-row cap, toast stacking/expiry, sound after a user gesture and exact click-to-ticket behavior. Capture only local screenshots with no credentials.

- [ ] **Step 7: Request code review and fix all Critical/Important findings**

Use `superpowers:requesting-code-review`, then repeat the relevant RED/GREEN tests and the complete verification gate for every accepted fix.

- [ ] **Step 8: Commit final verification/docs**

```powershell
git add tests/e2e/operator-dashboard.spec.ts scripts/smoke-watch-match.test.mjs proccess.md
git commit -m "test: verify profitable ticket alert workflow"
```

## Completion criteria

- [ ] Only exact mapped two-outcome rows shared by at least two selected providers are shown.
- [ ] Every valid opposing provider pair is evaluated; the best guaranteed-profit plan is selected.
- [ ] At most five rows are shown per event and events/rows rank by verified guaranteed profit descending.
- [ ] Green state and alerts require both provider legs to pass fresh identity/odds/limit/balance preflight and worst-case profit of at least 20,000 VND.
- [ ] Toasts stack on the right, last five seconds, deduplicate correctly, sound after user gesture and open the exact ticket.
- [ ] Neutral exact rows remain visible when no profitable ticket exists.
- [ ] Full test/typecheck/build/E2E gate passes and no execution/wager endpoint is called.
