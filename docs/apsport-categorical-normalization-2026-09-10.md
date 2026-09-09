# AP normalization and exact opposing pairs — 10 September 2026

AP's adapter previously recognized binary and result/double-chance groups, but left score, range, combined-result and refund markets in native inventory. This change decodes each group using AP's own outcome table and retains real canonical markets and quotes. It does not create nonexistent opposite selections.

## Same-input measurement

Input: 653 AP events, 62,161 native observations, held snapshot observed at 2026-09-10 00:26:29 +07:00. Capture: 01:13:43. AP was STALE. Other books are the saved SABA/SBOBET/CMD/BTI captures from the preceding audit. IM was unavailable and is not counted.

| Metric | Before | After | Change |
|---|---:|---:|---:|
| AP canonical native markets | 18,802 | 60,953 | +42,151 |
| AP unmapped native markets | 43,359 | 1,208 | −42,151 |
| AP native markets with an opposing book | 17,220 | 21,457 | +4,237 |
| Distinct AP native events with an opposing market | 539 | 542 | +3 |
| Distinct AP cross-book native market pairs | 30,864 | 35,729 | +4,865 |
| All five-book native market pairs | 52,653 | 57,518 | +4,865 |

AP pairs by partner: SBOBET 16,435 → 16,966; BTI 10,134 → 14,426; SABA 307 → 338; CMD 3,988 → 3,999. Every previously admitted pair remains present.

Of 42,151 added native markets, 5,793 have an exact binary representation; 36,358 are categorical contracts. A correct score such as 2–1 is now structured and retained, but it cannot be opposed by an unrelated total or a different exact score. Canonical coverage is not a count of arbitrage opportunities.

No live profit claim follows from this replay: AP was STALE. Reconstructed additions have receipt clock and sequence zero because native inventory does not contain those fields. Existing canonical markets, quotes, clocks, status, IDs and provider events are retained unchanged. No catalog is made fresh, no fixture is invented and no provider connection is altered by the replay.

## Canonical contracts and exact equivalences

- Correct scores: period-specific `SCORE_home_away` selections; 0–0 has the same win/loss partition as under 0.5.
- Goal/team-goal/corner ranges: statistic, subject and period remain separate. A range starting at zero equals under upper-bound + 0.5; a tail N+ equals over N − 0.5. Interior ranges remain `RANGE_lower_upper` categorical selections.
- Half/full result: AP uses 1 = home, 2 = away, 3 = draw. Thus 13 means home/draw, not home/away.
- Result + BTTS: AP uses 1 = home, 2 = draw, 3 = away and 4 = yes, 5 = no.
- Double chance + BTTS: prefixes 1/2/3 mean home-draw/home-away/draw-away.
- Result + total: codes 1–6 mean home-over/home-under/draw-over/draw-under/away-over/away-under, with the total carried separately.
- Highest-scoring-half slots 0/2/3 mean first half/second half/equal, never home/away/draw.
- Corner/card/yellow-card result markets have distinct statistic contracts.
- Prematch DNB with native line zero maps to handicap zero. Live DNB remains separate because an in-play Asian handicap may use remaining goals. Home-no-bet and away-no-bet are not DNB.

Every conversion preserves native `tsport:group:offer` and selection IDs, source odds format/price and suspension state. The UI's existing opposite-leg matcher can therefore use boundary ranges and prematch DNB directly, including swapped home/away orientation. No native selection is counted twice as a new source market.

## Primary evidence and remaining inventory

Evidence is AP's saved public JavaScript renderer `.run/double-chance-normalization-2026-09-09/four-provider/ap-public-0.js`. Key offsets: 97,583 (group enum); 129,586 (half/full table); 130,017 (score sentinel/range enums); 132,323 (BTTS and combined-result tables); 432,919 (highest-half slot names); 479,680 (9:9 rendered as AOS).

The remaining 1,208 observations are still retained in native inventory:

- 1,054 AOS offers, encoded 9:9. Their excluded score domain must be established; this is not literal 9–9 and cannot be mapped across books without that domain.
- 69 next-player-goalscorer offers without proven player identity in the retained inventory.
- 27 European next-goal, 12 corner over/exact/under, 10 rest-of-match winner and 18 home/away-no-bet offers requiring their own indexed/context/refund contracts.
- 18 fast-window/extra/unknown offers requiring verified window or native-type semantics.

The implementation does not discard these offers or rename their disposition to improve coverage.

## Reproduction and validation

Local evidence directory: `.run/ap-normalization-2026-09-10/`. `before-engine.mjs` froze the old adapter/normalizer/matcher before edits. `replay.mjs before` and `replay.mjs after` decode the same unmapped inventory, append only new native identities to the original catalog and run the actual production matcher. Both JSON reports record the same AP and peer input hashes; the replay asserts no lost pair and checks new market/quote schemas.

AP input SHA-256: `454a30280d770e491dc31026e24f174645886cf5a4c940598a9427b4137895e5`.

Measured comparison runtime: 2.82 → 3.72 seconds, process RSS 537 → 575 MiB in the sequential standalone audit. These are single-run measurements, not browser or feed-stability guarantees.

Validation: 400 tests passed across nine relevant suites, including AP native shapes, malformed and suspended selections, source identity, swapped participants, actual opposing routes and an exhaustive integer-total check for boundary-range payoff equivalence. Contracts/adapters/API builds and web typecheck/build passed. New behavior tests failed before implementation. Older assertions about now-supported groups were updated while retaining invalid-input refusal checks.

Deployed at 01:36:01 +07:00. API build `sha256:91175b12a02f0716e00749ca41dac37beb0d3bc3c55f16febc92348fde8bb23b`; local and public `/football-live` both returned HTTP 200 with `index-BRllPTcL.js`. The subsequent AP catalog read returned HTTP 503 `CATALOG_TIMEOUT`. Therefore the table above remains a replay result; fresh runtime AP coverage and recovery are not claimed. No repeated provider reload was performed.
