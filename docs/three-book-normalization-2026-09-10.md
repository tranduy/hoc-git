# SABA, IM and CMD normalization — 2026-09-10

This change decodes additional native markets and preserves the original source identities, prices, states and receipts. It also compares proven prematch equivalents: a 0–N count bucket equals Under N+0.5, an M+ bucket equals Over M−0.5, and a 0–0 score equals Under 0.5. Interior ranges are not totals, and these final-count equivalences are not applied to live remaining-count markets.

## Frozen input and accounting

The benchmark freezes all six catalogs. It holds the matcher clock at `1789008008786`, keeps the same events and peers, and identifies each pair by the two native provider/event/market IDs. Repeated projected rows do not inflate the pair count. Every preexisting market and quote is compared by deep equality; native observations and event metadata must be retained. Added replay quotes have receipt and sequence zero, with null source timestamps. These are structural counts, not fresh betting opportunities or verified positive ROI.

Artifacts are under `.run/three-remaining-2026-09-10/` (local, ignored). `before-engine.mjs` freezes the original implementation. `compare.mjs normalizers` measures new decoders with that original matcher; `compare.mjs after` additionally enables the new equivalent predicates. Each comparison asserts zero lost original pairs.

| Input | SHA-256 |
| --- | --- |
| SABA baseline | `c8a49db16e2bf63adcf97f17e767c34a63f654d8d3a4d1c2a4e4426ad430d351` |
| IM baseline | `867d5179f15297e927b510f770125f3c1fad8ac9fb599269e92353fb1aa4d084` |
| CMD baseline | `957c69e8acf2a927136348213ba4b85c23889168999f769e321d314c06f188a0` |
| SBO peer | `6d4b933dc6581fcb10fd1bcdff49932ef3ab38c3409c46b0c0727c53bf60f844` |
| AP peer | `de94cb4d1f95a5ea84a02871575304019b45abbf94399ce13ca57df74de47b15` |
| BTI peer | `7a75db7204155f17eeb53e4e19c63683e0232bf6e5c150e625d71da5d81a1cbb` |

## SABA

The public renderer proves unlabeled types 5/15 use HOME, AWAY, DRAW, and types 461/462 are home/away team totals with OVER, UNDER order. Its own format registry fixes those four types to Decimal. Exact layout checks prevent that evidence from being generalized to unrelated groups. An unavailable selection withdraws only its own price; remaining slots retain their original selection indices.

Frozen coverage: **280 → 359 markets**, **560 → 791 quotes**, all **477 native observations** retained. Gains: 40 FT 1X2, 33 FH 1X2 and six team totals. Remaining: 115 observations without a comparable event, three Next Goal observations lacking exact goal-state/ordinal identity. Full public evidence and source hashes: [SABA audit](saba-remaining-normalization-2026-09-10.md).

## IM

The saved public IM selection enum (`main-9992f20.js`, SHA-256 `663ab38cea0f8bbb09292fa97710c2fe179a42a13fe374dba490af1134c8df8a`) proves exact scores 12–36, goal buckets 39–42, half/full outcomes 46–54 and corner results 5/6/7. The decoder respects the native period and preserves unsupported H5UP/A5UP/AOS outcomes without inventing a score.

Frozen coverage: **15,957 → 21,130 markets**, **35,780 → 97,883 quotes**, all **42,806 native observations** retained. Of the 5,173 additional markets, 4,432 are categorical and **741 are zero handicaps** previously reported as normalized but omitted by the downstream signed-line guard. Zero now has an explicit signed-line representation. No normalized native row in this replay lacks a corresponding canonical market.

Remaining: **21,676 native rows** = 19,168 without a captured comparable event + 1,262 inverse-score rows without a contract + 1,246 next-goal rows whose ordinal is absent from the frozen inventory. Another 1,893 partially mapped score rows retain their unsupported tail outcomes. These partial rows are included in the mapped count; they are not wholly normalized outcome domains. Tests cover individual price withdrawal, malformed/duplicate identities and retaining valid siblings.

IM's source is **stale** (source receipt `1788964173646`), as allowed for this audit. No IM session or freshness repair is claimed.

## CMD

CMD More uses its own renderer paths, Decimal formatters and native selection tuples. Exact score grids retain their coordinates and exclude the final AOS bitmask from prices; unresolved AOS prices remain native. Half/full, first/last goal, European handicap, goal buckets and team exact-count ranges keep distinct settlement contracts. Card parity and corner results preserve their statistic and period. MR percentage handicaps/totals remain separate because ordinary Asian settlement would be incorrect.

Frozen current coverage: **394 → 459 markets**, **857 → 1,040 quotes**, all **1,828 native observations** retained. Gains are 35 Double Chance, six corner results, 12 card results and 12 card parity markets. Only 54 new quotes have captured OPEN permission; 129 remain SUSPENDED. The current More owner is absent, so More contributes no gain to this snapshot. A separate historical wide replay adds **869 markets / 3,428 quotes** (4,136 → 5,005 markets); it is not added to the current comparison totals. Remaining current 12 unmapped and 58 old format-unproven DC rows contain no positive open price. [Detailed CMD evidence and limits](cmd-remaining-normalization-2026-09-10.md).

## Actual opposing-pair results

| Unique native market pairs | Before | New normalizers only | Normalizers + equivalents |
| --- | ---: | ---: | ---: |
| All six books | 50,134 | 51,175 | **56,518** |
| Involving SABA | 200 | 229 | 230 |
| Involving IM | 19,492 | 20,511 | 23,548 |
| Involving CMD | 845 | 845 | 849 |
| Involving SBO | 16,909 | 17,163 | 19,674 |
| Involving AP | 27,486 | 27,846 | 28,171 |
| Involving BTI | 35,336 | 35,756 | 40,564 |

Total gain is **6,384 pairs**: 1,041 from the normalizers and a further 5,343 from equivalent predicates. **Zero original pairs lost** in either variant. Per-book rows overlap because each pair involves two books. They must not be summed as distinct pairs. The current CMD gain is deliberately small: newly decoded prices without captured permission cannot be counted as open opposing opportunities.

The three target catalogs gain **5,317 markets / 62,517 quotes** in this fixed population. Canonical markets, native observations, quote selections and cross-book pairs are different denominators. The native observation total stays **45,111**. Normalized market growth cannot establish positive arbitrage; these counts do not price stale or suspended offers as executable.

## Deployment and verification

Contracts, adapters, API and web builds passed. Root independently ran **823 focused tests**, covering contracts (266), adapters (60), CMD HTTP/More (36), SABA ingestion/clock/DOM (184), IM source/HTTP (110), and matching (167). An independent review found no blockers in the new equivalent predicates.

Deployed API instance `862475c7-a851-4992-ad26-bc83eee8ddc8`, build `sha256:d2eb28e17c61bd44deabe3d116ab0a88060562e3605042f2eb8107015ecd4572`, preserving the existing **4096 MiB** heap. Deployment lease released. Web asset `index-Km9esJic.js`, worker `comparison.worker-CK5UmsJE.js`.

At 10:08 local, both `http://127.0.0.1:4311/football-live` and `https://live.babiesbo.uk/football-live` returned HTTP 200 with that same asset (the public check needed IPv4 after an initial connection timeout). SABA was FRESH with 379 markets, including 42 FT and 37 FH result markets. CMD was FRESH with 5,835 markets, including 590 Double Chance, new exact scores, goal ranges, half/full, first/last goal, European handicap, corner results and card results/parity. These changing live counts are not the frozen benchmark.

**IM runtime still serves its old stale cache: 15,957 markets.** Its 21,130-market result is the offline replay, not a deployed live receipt. The new decoder will apply to subsequently accepted native IM input; no offline replay was injected as a fresh feed. Provider tabs and the external IM extension edits were not reloaded or included in this change.

A separate headless local UI check at 10:11:57 displayed **9,177 opposing source-market pairs / 17,530 source markets**, with no JavaScript errors. SABA, SBO and AP had loaded; IM was unavailable and CMD/BTI were still pending in that new browser context. This verifies that the deployed worker renders comparisons, not that every source loaded continuously. Artifacts: `ui-ready.json`, `ui-ready.png` and `runtime-1789009737036.json`. The in-app browser bootstrap failed on `sandboxPolicy`; the check used a separate read-only headless context. Earlier UI waits used a corrupted non-ASCII test regex; the final check uses Unicode escapes and passed.
