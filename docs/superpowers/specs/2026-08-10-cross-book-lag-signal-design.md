# Cross-book Lag Signal Design

## Goal

Detect the short interval where one provider has repriced a two-outcome market and another provider still exposes a favorable opposing price. Recompute immediately on every accepted quote update; never wait for a time window before publishing a signal.

## Exact eligibility

A comparison row is eligible only when all of these conditions hold:

- The event identity is an exact verified match across at least two selected providers.
- Market type, scope, line, settlement profile, and live/pre-match state are identical.
- The canonical outcome domain contains exactly two mutually exclusive outcomes.
- Every price used by the signal is `OPEN`, fresh, parseable, and belongs to a selected provider.
- The two chosen outcomes come from different providers.
- Discrete native stake constraints produce positive profit for both outcomes after rounding.

Three-way markets, incomplete markets, mismatched lines, inferred selections, suspended prices, stale prices, and single-provider rows are excluded.

## Trigger and ranking

Each accepted provider quote update immediately rebuilds the affected exact comparison row. For each of its two outcomes, the system selects the best currently executable price. A signal exists only if the resulting two-book stake plan has positive worst-case profit.

Signals are ranked by realized ROI after stake rounding, then by worst-case profit, then by newest triggering update. Quote movement is displayed as evidence (`previous -> current`, provider, outcome, and update age) but historical movement size is not a prerequisite and no five-minute delay or window participates in the decision.

## Interface

The catalog shows only a small priority set: the five best currently executable two-book signals. A prominent first card shows the best signal with match, market and line, both providers, both outcomes, odds, stakes, profit for either result, worst-case profit, ROI, quote ages, and current `OPEN` status.

Rows that are exactly mapped across two providers but are not currently profitable are not shown in the priority signal list. They remain available in match detail as diagnostic evidence. The detail view uses the same eligibility and ranking logic as the list.

## Safety and execution boundary

This phase remains read-only. A future execution adapter may consume the prepared two-leg plan, but it must synchronously preflight both legs immediately before placement. If either price changes beyond tolerance, becomes stale, suspends, closes, loses its mapping, or fails its account constraint, the whole plan is rejected. The UI must never claim that both bets were placed.

## Testing

Tests must prove the flip scenario (`2.20/1.70` versus `1.70/2.20`) selects the two opposing `2.20` prices from different providers without delay; three-way, mismatched, stale, suspended, incomplete, single-provider, and non-profitable rows fail closed; and the UI displays at most five signals with the highest realized ROI first.
