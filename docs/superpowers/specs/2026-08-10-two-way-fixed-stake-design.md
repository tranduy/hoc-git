# Two-way football comparison and fixed-base stake design

## Goal

The live football comparison must focus only on an exactly mapped two-outcome market. A user enters one global base stake (default `100000` VND). For each profitable cross-provider row, the lower decimal-odds leg receives that base stake and the higher decimal-odds leg is sized to equalize payout. The UI must show both outcome profits and alert only when both remain positive after valid stake-step rounding.

This remains observe/preflight-only. It prepares exact stake instructions but does not place a bet.

## Supported rows

- Exclude `FT_1X2` and every other three-or-more-outcome market from football comparison, ranking, detail, and alerts.
- A supported row must have exactly two canonical, distinct outcomes and an exact shared market identity: market type, scope, line, and settlement profile.
- The best open quote for each outcome must come from two different selected providers.
- Both provider markets and both quotes must be `OPEN` and current in the accepted catalog.
- Today the live adapters expose `FT_TOTAL` as the verified two-way football market. The rule is outcome-count based so later verified two-way handicap markets can use the same calculation without admitting 1X2.

## Global stake configuration

- Add a `Base stake for every match` VND input to the Live Catalog controls.
- Default: `100000`.
- Accept finite positive whole VND values and normalize to the configured `1000` VND step.
- Persist the value in browser `localStorage`, so reload and navigation to match detail retain it.
- Invalid input must not create a plan or alert and must show a clear inline validation message.
- The selected value is passed into every list-row calculation and the watched-match alert calculation.

## Exact calculation

Let `L` be the lower decimal odds, `H` the higher decimal odds, and `B` the configured base stake.

- Lower-odds stake: `B`.
- Continuous higher-odds stake: `B × L ÷ H`.
- Evaluate the valid stake-step candidates immediately below and above the continuous value.
- For each candidate:
  - `total = B + hedge`
  - `profit if low wins = B × L - total`
  - `profit if high wins = hedge × H - total`
- Choose the valid candidate with the greatest minimum of the two profits; deterministic ties prefer the smaller total stake.
- Publish a plan only when both profits are strictly greater than zero after rounding.
- Use exact decimal arithmetic. Never use binary floating point for stake or profit decisions.
- Raw provider odds are converted to decimal odds using the existing exact conversion rules before calculation.

Example: `B=100000`, `L=1.8`, `H=2.5`, step `1000` gives hedge `72000`, total `172000`, and `8000` profit for either outcome.

## UI

Each supported comparison row shows:

- market and exact line;
- the two outcomes side by side;
- selected provider and decimal odds for each outcome;
- `100000 VND base` on the lower-odds leg;
- calculated hedge stake on the higher-odds leg;
- total stake;
- profit if outcome A wins;
- profit if outcome B wins;
- worst-case profit and ROI.

Profitable plans receive a positive visual treatment and participate in event `Best edge` sorting. Rows without an executable two-provider plan show the precise reason and never show a positive edge.

The watched-match toast reuses the same plan and the global stake value. It lasts ten seconds and appears only for a new profitable fingerprint.

## Safety and failure handling

No plan or toast is allowed when any of these is true:

- fewer or more than two canonical outcomes;
- both best legs are from the same provider;
- event or market mapping is not exact;
- market or quote is suspended/closed;
- odds cannot be converted to valid decimal odds greater than one;
- the base or rounded hedge stake violates the configured minimum, maximum, step, or balance;
- either rounded outcome profit is zero or negative;
- accepted catalog polling is stale or fails.

The live catalog currently lacks bookmaker fee and account-specific placement-limit evidence. Therefore this screen labels its result `Gross preflight` and must not claim a guaranteed net profit or placement readiness until those inputs are verified.

## Tests

- Unit tests cover the `1.8 / 2.5 / 100000` example, unequal rounding, equal odds, non-arbitrage, invalid input, same-provider legs, closed quotes, and all three-outcome rejection paths.
- Catalog tests verify 1X2 is absent while exact two-way rows remain.
- Page tests verify persistence across remount/reload, row amounts/profits, validation, and detail propagation.
- Watch tests verify the toast uses the configured base stake and remains suppressed when either outcome is not profitable or executable.
- Full typecheck, workspace tests, integration/smoke tests, and production build remain required before completion.
