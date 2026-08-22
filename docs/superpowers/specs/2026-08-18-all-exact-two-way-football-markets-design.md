# All Exact Two-Way Football Markets Design

## Goal

Collect and compare every evidenced Football market with exactly two mutually exhaustive outcomes across providers. Exact score, 1X2/draw markets, and any market whose settlement identity cannot be proven remain excluded.

## Safety boundary

A quote can enter comparison only when provider evidence establishes the same event, regulation segment, statistic, market family, canonical line, outcome domain, and settlement profile. A visually similar label or merely having two prices is insufficient. Unsupported, ambiguous, stale, suspended, incomplete, integer push-capable, or mismatched markets remain display-ineligible and cannot produce ROI, sound, or ranking.

## Supported expansion order

1. Existing full-time Asian handicap and total markets on quarter-unit non-integer lines.
2. First-half Asian handicap and total markets on the same supported lines.
3. Provider-detail markets whose semantics can be evidenced: corners and cards handicap/total, then other two-way markets with an explicit canonical domain.

Each statistic receives a separate market type and settlement profile. Football goals, corners, and cards must never share a canonical market key even when their period and line are identical.

## Collection architecture

Prefer authenticated provider HTTP/WebSocket detail responses already used by the open tab. The extension may navigate an exact read-only category/detail control only when no detail endpoint is available; it must never click an odds selection or submit a wager. Collection is bounded by provider-specific concurrency, refresh intervals, and retained-event limits.

## Verification

Every provider decoder needs sanitized fixtures for accepted and rejected shapes. Cross-book tests must prove exact matches and near-miss rejection for period, statistic, line, outcome orientation, and settlement. Live verification reports coverage by provider and market type; it must not claim full coverage while a selected source is stale or a detail market family is unproven.
