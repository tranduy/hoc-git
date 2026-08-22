# Exact Two-Way Market Expansion

## Outcome

Expand the live two-book monitor beyond full-time half-goal handicap without weakening exact identity or execution safety.

## Supported executable rows

- Football `FT_AH / FULL_TIME` with a half-goal line and exact `HOME|AWAY` outcomes.
- Football `FT_TOTAL / FULL_TIME` with a half-goal line and exact `OVER|UNDER` outcomes.
- LoL `SERIES_WINNER / SERIES` with a null line and exact `TEAM_A|TEAM_B` outcomes.

`FH_AH`, `FH_TOTAL`, and LoL `MAP_WINNER` remain display-blocked until provider decoders expose an exact scope, outcome domain, and verified common settlement profile. Three-way, quarter-line, missing-line, duplicate-provider, suspended, stale, and settlement-mismatched rows remain ineligible.

## Exact matching

A comparison row exists only when at least two selected providers contribute exactly one market for the same mapped event and the same `marketType + scope + canonical line`. An executable/ranked row additionally requires the same settlement profile and exact outcome domain. Reversed football orientation inverts handicap lines and swaps `HOME/AWAY`; totals are not inverted.

## Ranking and UI

All supported rows are shown even when not profitable. Each event shows at most five rows, ordered by verified worst-case profit first and then current observable price movement. Green state, toast, and sound remain restricted to two fresh provider preflights whose rounded net worst-case profit is at least 20,000 VND for the configured base stake.

## Failure behavior

Unknown market semantics, missing exact line, inconsistent selection domain, duplicate semantic markets, provider mismatch, stale/suspended quotes, missing financial policy, or failed preflight must fail closed. No execution route is added or enabled by this change.

## Verification

Add RED/GREEN regressions for exact full-time totals, settlement mismatch, line mismatch, three-way exclusion, LoL outcome-domain restriction, ranking, and preflight candidate generation. Run focused web tests, full web tests, typecheck, production build, and update `proccess.md` with the observed result.
