# CMD remaining normalization, 2026-09-10

Frozen structural replays, not a live quote or positive-ROI claim:

| Capture | Before markets / quotes | After markets / quotes | Added |
| --- | ---: | ---: | ---: |
| Current 02:40 UTC, 44 events | 394 / 857 | 459 / 1,040 | 65 / 183 |
| Historical wide, 786 events | 4,136 / 8,272 | 5,005 / 11,700 | 869 / 3,428 |

Current additions: 35 full-time Double Chance, 18 corner/booking FT/FH 1X2, and 12 booking FT/FH odd/even markets. The 18 stat results include 6 corner and 12 booking markets. Of the 183 new quotes, 54 retain captured OPEN evidence; 129 without captured permission are SUSPENDED. New quote monotonic clocks and sequences are zero. Existing events, canonical markets, quotes, raw observation labels, native selection IDs/prices/formats/statuses and observation counts remain unchanged. Historical additions contain 1,436 OPEN and 1,992 SUSPENDED quotes.

The immutable current More group belongs to an event absent from the comparable event catalog; it adds no current More quotes. The historical replay proves More mappings independently. It retains original native event IDs from providerMarketId even where the catalog canonicalized providerEventId to an alias.

## Provider evidence

Primary saved CMD source: `.run/parallel-hidden-markets-2026-09-08/cmd/public-assets-1788862672001.json`, `assets[0].body`; extracted renderer: `.run/six-provider-normalization-audit-2026-09-09/unmapped-followup/cmd-public-more-handler.js`. The named DataFormat fields, BETTYPE enum, GetExtraParams and onExtraBetTableLoaded prove native identities and period arguments.

- Main slots 84/85/86 are DC1X/DC12/DCX2. In the own-provider archive, 594 of 597 positive same-event tuples equal More FT[2] exactly. The other three differ by small price updates. More FT[2] calls GetX12OddsFormat and OneX/OneTwo/XTwo native selections. Only HTTP inputs acquire DECIMAL; unknown-format DOM groups remain rejected. Native result visibility must explicitly allow the market; native closure removes quotes.
- Native FT/FH result slots preserve HOME/DRAW/AWAY for independently named corner/booking fixtures. Stat result mapping requires explicit DECIMAL and rejects duplicate native selection IDs. It does not infer a format from positive prices.
- Main odd/even slots 48/49 and 65/66 use the provider's Malay conversion. IsOeInetHide at slot54 now withdraws hidden parity markets, including after later price deltas.
- More FT[4] has 25 exact score coordinates; FH[2] has 16. The next slot is AOS; the final score-mask integer is metadata, never odds. Open AOS remains explicitly unresolved in the original observation.
- FT[5]/FH[3] provide first/last/no-goal; FT[6] provides HH/HD/HA/DH/DD/DA/AH/AD/AA; FT[7]/FH[4] provide integer European handicap with the native favorite flag. No-goal is one native identity reused by the two distinct first/last market predicates.
- FT[8.0]/FH[5.0] provide total-goal ranges; FT[8.1]/FH[5.1] exact-goal bins; FT[8.2]/[8.3] home/away exact-goal bins. Terminal bins and native selector parameters are preserved.
- FH result and odd/even use CreateFHId(Bo); FH score, FG/LG/NG, HP3, TG and ETG explicitly pass original Bo plus period1. These different IDs are tested separately.

## Retained limitations

CNS exposes HY/HN/AY/AN and decimal prices, but saved evidence lacks the expanded own-provider heading/rules proving clean-sheet settlement. It stays native pending that evidence. AOS score-set membership is not guessed.

ForMMR is not ordinary Asian handicap with an unusual display: native GetSingle/DoubleHdpBallContent and GetSingleOUBallContent truncate the displayed line to an integer and append GetMrPercent from the separate percentage fields. MR stays excluded from ordinary AH/total comparisons.

The current 12 residual UNMAPPED rows are closed native Double Chance rows from stat fixtures. The remaining 58 old NATIVE_ODDS_FORMAT_UNPROVEN observations also contain no positive open DC price. They are retained as captured, rather than relabeled to inflate a normalization count. Other exclusions include absent/unsupported event identity, closed or malformed two-way rows, native visibility, and the 66 MR observations.

Artifacts: `.run/three-remaining-2026-09-10/replay-cmd-more.mjs`, `CMD-after.json`, `CMD-wide-after.json`, `CMD-current-report.json`, `CMD-wide-report.json`, and `CMD-main-DC-proof.json`. Verification: 89 adapter tests including SABA helper; 70 CMD HTTP/More tests; adapters build and API typecheck passed. Tests reproduce the prior missing mappings and hidden-market retention before the fixes.
