# BTI normalization and actual opposing pairs — 10 September 2026

BTI previously retained many named outcomes in native inventory without decoding their terms. This change uses BTI's own market codes, selection ID suffixes, outcome names, participant roster and source odds to normalize score, goal-range, period, team and corner markets. It also fixes removal of derived markets when their native family closes or replaces its selections.

## Controlled before/after result

The BTI capture at 02:27:47 +07:00 contains 1,632 events, 51,895 canonical markets, 111,046 quotes and 115,578 native observations. Native dispositions before the change are 51,895 NORMALIZED, 25,262 EXCLUDED and 38,421 UNMAPPED. These counters have different units once a native container splits into multiple canonical contracts; they must not be added to infer distinct source market IDs.

| Measurement on identical input | Before | After | Change |
|---|---:|---:|---:|
| BTI canonical contracts | 51,895 | 99,385 | +47,490 |
| Original UNMAPPED observations still unresolved | 38,421 | 17,901 | −20,520 |
| Distinct opposing native market pairs involving BTI, AP latest normalization held fixed | 30,844 | 33,358 | +2,514 |
| All five-book opposing native market pairs, same variant | 57,050 | 59,564 | +2,514 |

An additional 2,433 previously EXCLUDED observations yield real supported contracts. The 47,490 additions comprise 27,072 binary and 20,418 categorical contracts. Source containers can split by team, line and contract type, so 47,490 added canonical contracts does not mean 47,490 newly resolved source containers. Old canonical markets and all 111,046 old quotes are unchanged; no previous admitted pair is lost. Of the additions, 1,283 canonical source markets find an opposing book in this fixed peer inventory. The other 46,207 are not new opposing pairs.

BTI pairs by peer with AP normalization held fixed:

| Peer | Before | After | Added |
|---|---:|---:|---:|
| APSPORT | 14,280 | 15,495 | 1,215 |
| SBOBET | 10,399 | 11,627 | 1,228 |
| CMD | 5,814 | 5,868 | 54 |
| SABA | 351 | 368 | 17 |

The primary replay using the original older AP canonical catalog independently measures 26,590 → 29,104 BTI pairs, also +2,514 with zero loss. IM was unavailable and is absent from both variants. Peer snapshots are older controlled inputs; AP is STALE. These results demonstrate structural matching, not current eligible prices or positive profit. Newly reconstructed quotes have receipt clock and sequence zero; they cannot manufacture freshness.

## Proven meanings and lifecycle

- Correct score preserves period, statistic and literal score. BTI 9:9 is a literal score, unlike AP's AOS sentinel. Only 0:0 converts to the same-period/statistic under 0.5.
- Exact goals and ranges retain their subject and period. Zero-based ranges convert to the corresponding under boundary; N+ converts to over N−0.5. Interior ranges remain categorical.
- Half/full outcomes follow BTI's native suffix table, corroborated with both named results. Participant names containing `/` must be treated as whole names, not split at every slash.
- First-half result plus both-teams-to-score stays first-half. A scoreless first-half draw is under 0.5; a scoring draw stays DRAW_YES.
- Home and away positive win-to-nil/win-both-halves offers create separate YES contracts. They are not opposite outcomes and no NO quote is invented.
- Named-team second-half scoring and clean-sheet offers become the correct team/opponent second-half total at 0.5. Team-specific suffixes and YES/NO versus ODD/EVEN vocabularies must agree.
- Multi-score offers preserve the exact finite score set, with numeric ordering and duplicate rejection. Winning margins preserve exact 1/2/3 versus 4-or-more, team and period.
- ML159/160 retain first/second-half draw-no-bet settlement. HC157 remains unresolved because the retained evidence does not prove the regulation/in-play reference needed for equivalence to handicap zero.
- Derived identities remain owned by their exact native family. Closing, removing, emptying or replacing that family removes its derived numeric and categorical offers, including reused selection IDs with changed terms.

The new categorical score/set/margin/combined-result contracts are stored with real native selections but are not yet general two-book opposing rows. The matcher rejects false pairings between unrelated categorical outcomes. Future categorical pairing must implement payoff complements and swapped-participant orientation before enabling these contracts. Proven binary equivalents and existing team YES/NO contracts account for the measured pair gains.

## Still unresolved

All 17,901 remaining original UNMAPPED observations contain at least one OPEN, valid-priced selection. They are not merely empty or zero-priced placeholders. They remain available in native inventory.

Large remaining groups include named-team first-scoring-half (QA4450, 926), first-ten-minute totals (OU4620, 591), comeback win (QA701, 562), races to 2/3/4 goals (QA4460/61/62, 561 each), races to 5/6 goals (QA4463/64, 465 each), first goal time and first-scoring-half (QA65/QA4448, 465 each), player two/three-plus goals (QA4879/4880, 391 each), player goalscorer (QA1337, 390), and corner races (QA1473–76, 287 each). They need explicit time, race, player or settlement contracts; total market count is not evidence that two quotes are opposite.

## Evidence and validation

Evidence directory: `.run/bti-normalization-2026-09-10/`. The original BTI capture SHA-256 is `606e1011a6989b2b0b0a654d153a378479a8bf3b8cae85b75fbf05754ac855d9`. Immutable before/after bundles run the production decoder, shared normalizer and matcher on identical inputs. The AP latest variant normalizes the same fixed AP source for both sides of the comparison.

Native input is reconstructed from retained IDs, labels, sides, lines, prices and statuses; the capture does not retain original network tuples. All 822,763 candidate native selection entries are conserved, including rejected/closed cells, with zero missing, changed or invented entries. All 22,953 handled source observations map every available selection, including all nine half/full outcomes for Bodo/Glimt. Schema checks and original quote/market checksums pass. This replay cannot establish live receipt times or betting eligibility. Final artifacts are `after-r3-result.json`, `after-r3-ap-latest-result.json` and `final-evidence-summary.json`; final engine hash is recorded in `after-r3-source.json`.

Regression coverage includes malformed and contradictory outcome identity, actual retained native fixtures, suspended/closed offers, source evidence conservation, family closure/removal/replacement, swapped binary subjects and refusal of false categorical opposites. Final validation: 351 API/contracts tests and 352 web comparison tests passed; contracts/API builds and web typecheck/build passed. Web tests use the web workspace's jsdom configuration; a root invocation initially lacked ErrorEvent and was rerun under the correct environment.

Final deployment at 02:50:01 +07:00: instance `6a8f62bf-e7fc-4dfe-8be7-51e72ea81a4e`, API `sha256:50cf4743eac50c88f04c97410c759264aae529f8f66d3174ceaf66f8dc4a1b41`, web `index-a25HopCZ.js`, worker `comparison.worker-YlhPqpj8.js`. Local and public pages returned HTTP 200 with the new asset. Two coordinated handoffs occurred: the final one includes the late slash-name regression fix. Neither issued a provider reload.

First deployment runtime check returned BTI FRESH with 79,277 canonical markets/12,550 unmapped. Immediately after the final handoff, the restored BTI catalog returned STALE with 97,661 canonical/17,318 unmapped. The follow-up at 02:52:08 returned FRESH with 1,596 events, 96,659 canonical markets, 316,891 quotes and 17,095 unmapped. These are different live snapshots, not the controlled before/after denominator. Local/public HTTP 200 and API build identity were reconfirmed in `deployment-verification-settled.json`; no long-term feed-stability claim follows from these samples.
