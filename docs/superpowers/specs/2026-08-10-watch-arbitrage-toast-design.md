# Watch Arbitrage Toast Design

## Goal

While a user watches one verified cross-provider event, calculate an executable-shaped stake plan and display a ten-second alert when the currently observed prices form a profitable cross-book candidate.

This remains observe-only. The alert says `READY TO PREFLIGHT`, not that a bet is guaranteed or placed. A later execution adapter can consume the same plan after provider-side preflight succeeds for every leg.

## Eligibility

An alert candidate is rejected unless all of these are true:

- the event comparison already contains at least two verified providers;
- the row represents one exact market identity: type, scope, line, and settlement profile;
- the selected provider filters still include every provider used by the plan;
- the complete outcome domain is present: three outcomes for `FT_1X2`, two for `FT_TOTAL`;
- every chosen market and quote is `OPEN`;
- the best outcomes come from at least two providers;
- every selected raw price converts to valid decimal odds greater than one;
- the observation is fresh and the watcher is in `WATCHING` state;
- discrete stakes satisfy the configured minimum, maximum, balance, step, and total-bankroll constraints;
- the rounded plan has positive worst-case profit and positive realized ROI.

Missing provider preflight, account balance, provider limits, or placement capability prevents the UI from calling this a guaranteed bet. Those checks are an explicit future boundary.

## Calculation

The read-only watch UI uses a temporary development policy until live account constraints are available:

- base currency: `VND`;
- total bankroll: `100000`;
- minimum stake per leg: `30000`;
- maximum stake per leg and balance per leg: `100000`;
- stake step: `1000`;
- fees and FX adjustments: none in this provisional watch calculation.

The planner uses exact decimal arithmetic through the existing core stake optimizer. It chooses one best open quote per outcome, applies discrete stake constraints, and exposes total stake, worst-case payout, worst-case profit, and realized ROI. If no profitable discrete plan exists, it returns no candidate.

## UI Behavior

The detail screen shows a fixed toast area above the comparison table. A new candidate displays:

- `READY TO PREFLIGHT`;
- match, market, scope, and line;
- provider, selection, decimal odds, and planned VND stake for each leg;
- total stake, worst-case profit, and ROI;
- a warning that provider preflight is still required before placement.

The toast automatically disappears after exactly ten seconds. The same opportunity fingerprint is not shown repeatedly; it may alert again only when its providers, prices, or calculated stakes change. If the candidate becomes ineligible, stale, suspended, or unprofitable, the toast disappears immediately.

The toast has no placement button and performs no external mutation.

## Boundaries and Future Execution

The pure planner output is deliberately shaped as a future execution request. Real placement must add a server-side two-leg preflight checking current odds, market status, limits, balance, token/session health, and quote age immediately before any leg is submitted. Both preflights must pass; partial-leg recovery and explicit user confirmation remain mandatory before enabling real betting.

## Test Strategy

- Unit-test planning for profitable two-outcome and three-outcome rows.
- Reject single-provider, incomplete, suspended, filtered-out, invalid-price, and rounded-unprofitable rows.
- Component-test toast contents, ten-second expiry, deduplication, refresh on changed odds, and immediate removal on ineligibility.
- Run the full web suite, web typecheck/build, then the workspace verification suite.
