# All Football Two-Way Markets

## Fixed scope

- Collect and normalize only deterministic two-outcome football markets.
- Include Asian handicap and totals for full time, first half and second half.
- Include corner and card handicap/totals for full time and first half when the provider exposes explicit market evidence.
- Accept only quarter, half and three-quarter lines (`.25/.5/.75`). Integer
  lines remain fail-closed until push/refund settlement is modeled explicitly.
- Exclude exact score, 1X2/draw, virtual football, ambiguous period/type/line, and any market whose opposing settlement cannot be proved.

## Execution checklist

- [x] Add regression tests for provider market-type/period/line extraction and strict rejection.
- [x] Expand CMD extraction/normalization to supported period groups.
- [x] Expand AP/T-Sports DOM extraction to period, corner and card labels and all supported line increments.
- [x] Preserve all already-supported SBOBET market groups and verify no filtering regression.
- [x] Add bounded structural expansion for hidden/detail market containers without clicking odds.
- [x] Run adapter, extension, API and web verification; inspect live per-provider coverage.
- [x] Update the operator process record with verified coverage and unresolved provider protocol evidence.
