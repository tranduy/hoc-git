# Exact two-way ticket comparison

## Goal

The catalog and watched-match screens must first show real, recognizable two-way bet tickets from every selected provider. A ticket remains visible even when there is no profitable gap. Opportunity highlighting remains strict and separate from ordinary price observation.

The concrete Football priority is full-time Asian handicap on a half-goal line such as `0.5`. That line has only two settlement outcomes: the selected side wins or loses. Quarter lines such as `0.25`, `0.5/1`, and `0.75`, and integer lines that can push, are excluded because they introduce half-win, half-loss, or refund outcomes. LoL match winner is allowed only when it has exactly two teams and no draw outcome.

## Market rows

- Build an observational ticket for every accepted supported market with exactly two terminal settlement outcomes on at least one selected provider.
- Football initially supports full-time Asian handicap only on half-goal lines (`n + 0.5`). LoL initially supports exact two-team match winner. Totals, 1X2, draw, quarter-handicap, integer-handicap, and other settlement shapes stay out of this focused view.
- Align cells only when the canonical event, market type, full-time scope, normalized handicap, settlement profile, and complete two-selection outcome domain are identical.
- Normalize team orientation before comparing. For example, home `-0.5` is the same market definition as away `+0.5`; raw provider display order or sign must not create a false match.
- Keep a selected provider column visible when it has no exact event or no matching market. Display `No exact event match` or `Market unavailable`; never copy or estimate a price.
- Show the provider name, team/selection, normalized line, current odds, and `OPEN`/`SUSPENDED` evidence in every populated ticket.
- Show live matches and scheduled matches starting within the next two hours by default. Exact cross-book matches come first, then nearest start time. The two-hour horizon is a UI configuration rather than mapping evidence.

## Comparison and profitability

- When at least two distinct providers expose the same complete ticket, show both prices side by side and the current cross-book margin whether positive, zero, or negative.
- A neutral row is still visible and says that no profitable two-book balance exists.
- Use a `100000 VND` base stake on the lower-odds chosen leg and calculate the opposing hedge on the other provider using the configured stake step and limits.
- Apply a green profitable frame only when the strict stake plan exists, every chosen market and quote is `OPEN`, and the rounded worst-case profit is at least `20000 VND`. Both outcome profits, both stakes, total stake, worst-case profit, and ROI remain visible inside the frame.
- A green frame means a provider price changed while an opposing selected provider still exposes a sufficiently profitable price on the exact same ticket. It does not place a wager.
- Missing events, missing markets, incomplete outcome domains, invalid odds, suspended selections, same-provider legs, stale observations, or rounded worst-case profit below `20000 VND` must never receive the green treatment or alert.

## Live updates

- Poll selected provider catalogs sequentially at the existing one-second cadence.
- Refresh observational tickets after every accepted snapshot, even if prices did not change.
- Record which provider and selection moved, its previous and current odds, and the age of both chosen quotes.
- Continue emitting the ten-second alert only when a new changed-price fingerprint reaches the `20000 VND` worst-case-profit threshold. Ordinary neutral price refreshes do not alert.

## UI hierarchy

1. Match identity, live clock/countdown, provider selector, and connection evidence.
2. Always-visible ticket table with one provider per column and the same canonical bet on each row.
3. Neutral or green gross-preflight cell on each row.
4. Change log.

The table is for comparison. Green framing is for a currently profitable two-book candidate. Automated betting remains out of scope.

## Verification

- A single-provider exact event renders its supported ticket and odds while the missing provider cell remains explicit.
- Two providers with the same canonical full-time half-goal handicap render side by side when margin is negative, zero, or positive.
- Provider order and opposite handicap signs normalize to the same home/away ticket without swapping the teams incorrectly.
- `0.5` is accepted; `0.5/1`, `0.25`, `0.75`, and integer push lines are absent from this focused view.
- A `100000 VND` base plan with `19999 VND` worst-case profit stays neutral; `20000 VND` or more becomes green only when both chosen legs are open and fresh.
- Three-way, incomplete, mismatched-event, mismatched-market, mismatched-line, mismatched-settlement, suspended, and stale cases remain non-green and fail closed.
