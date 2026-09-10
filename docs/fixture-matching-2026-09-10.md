# Six-provider fixture matching, 2026-09-10

## Result

The frozen API capture at 12:04:52-12:04:58 local contains **371,062 canonical markets / 746,114 quotes**. IM, SBOBET and CMD are marked STALE; this is a structural comparison, not a fresh-price or positive-ROI claim.

Exact observed team spelling/abbreviation aliases and 17 competition label aliases recover **256 cross-provider fixture pairs** and **3,343 opposing native-market pairs**. No previous fixture pair or native-market pair is lost in the affected-fixture comparison.

| Metric | Before | After |
| --- | ---: | ---: |
| Cross-provider fixture pairs | 5,256 | 5,512 |
| Opposing native-market pairs | 78,673 | 82,016 |
| Source markets in those pairs | 66,928 | 68,763 |

These are different units: one event held by six books permits at most 15 unordered book pairs, and only corresponding opposing contracts contribute market pairs. Multiplying every market by every other market would count unrelated contracts.

| Provider | Events with markets | Matched events after | Unmatched events | Unmatched events with a review candidate |
| --- | ---: | ---: | ---: | ---: |
| SABA | 40 | 14 | 26 | 25 |
| IM | 791 | 755 | 36 | 20 |
| SBOBET | 550 | 546 | 4 | 0 |
| CMD | 765 | 736 | 29 | 13 |
| APSPORT | 535 | 534 | 1 | 1 |
| BTI | 1,754 | 744 | 1,010 | 31 |

Roster-only entries without markets are excluded from that denominator (AP has 593 roster entries, CMD 771). A matched event means it has at least one admitted cross-provider fixture relation; it does not mean all its markets have opposing offers.

## Why market coverage is much larger than paired coverage

BTI alone has **124,499 player markets**, while each of the other five captured catalogs has **zero player markets**. This accounts for a substantial population with no cross-provider counterpart in the captured data, even after successful normalization. BTI has 265,496 markets overall.

AP's 53,383 markets include 12,072 full-time correct-score records, 7,042 first-half correct-score records and 3,726 half/full result records. Normalizing a categorical outcome does not by itself provide the complementary outcome set in another book. Exact opposing partition and settlement checks remain necessary.

After the change BTI's unmatched events account for 60,048 markets. The remaining 205,448 BTI markets belong to fixtures having a peer, but many lack an opposing market there. Improving fixture names alone cannot turn all of these into pairs.

## Remaining evidence and limits

The broad name-candidate audit still flags **136 team-name candidate pairs**, **23 competition candidate pairs**, and **140 pairs outside the kickoff tolerance**. Candidates are review leads, not confirmed missed fixtures. These counts are unordered source-event pairs; market families are deduplicated. A fixture can already match one provider while still lack a relation to another.

Examples deliberately unresolved include generic Athletic Club/United FC names, underspecified Australian NPL labels that cover different states, and a BTI competition explicitly labelled handball against Iceland football cup. The implementation does not delete qualifiers or waive kickoff, competition, product, gender/age, score/period, source identity or ambiguity checks.

Of 1,010 remaining BTI events, this candidate search finds a review peer for 31; **979 have no candidate found by this search**. That is not proof that all 979 occur exclusively at BTI: unrelated spellings, absent source coverage or different time windows require additional evidence. No claim of 100% fixture coverage is made.

## Verification and memory

The user warned about RAM during the initial full-catalog audit. That process finished, and subsequent fixture work used a 1.9 MB event inventory. The bounded audit streams raw JSON, retains one market representative per event/family for the unchanged grouping context, then loads full markets/quotes only for the 302 events in the transitive old/new affected groups. It uses the real matcher and all original six-book rosters. Process RSS at completion was about **206 MiB**, with a 512 MiB V8 ceiling.

The initial full output has 5,256 fixture pairs. The diagnostic grouping stage has 5,259 before market-row filtering: three supplemental relations initially have no displayed opposing row. The final bounded replay measures 256 actual additions (253 grouping-stage additions plus those three admitted by changed grouping), with zero removals. Native pair deltas are computed from provider/event/market ID sets, not displayed row totals. Unaffected sources remain represented in fixture grouping and competition learning.

**523 catalog tests passed** across 22 files, including 41 new observed-fixture regression cases. Tests first reproduced 16 missing-name cases and 10 missing-league cases; fixed-data replay also caught four prior fixture relations lost through prefixed/year-suffixed names, which were corrected and retested. A Queen's Park/Queens Park Rangers negative case prevents an alias from widening containment incorrectly. Web typecheck passed.

Evidence and reproducible local runners: `.run/fixture-matching-2026-09-10/{capture.json,baseline.json,bounded-result.json,inventory.json,remaining.json,audit.mjs,bounded-audit.mjs}`. Freshness, prices and normalization adapters are unchanged. Claude's IM/extension files are not modified or staged.

Web-only publication at **12:18:45 local** passed the production build and local HTTP asset check: `index-BKunHfhK.js`, worker `comparison.worker-BgmYt4a-.js`. API instance `862475c7-a851-4992-ad26-bc83eee8ddc8` and recorded PID 14228 were unchanged across publication. No provider or API restart was performed. A second full browser was not launched because the user reported memory pressure.
