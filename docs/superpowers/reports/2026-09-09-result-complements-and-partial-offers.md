# Result complements, partial offers and six-provider normalization

This report separates native inventory, canonical markets, actual opposing routes and live eligibility. It does not use the number of positive prices as proof that matching is correct or incorrect. Production changes and frozen replays are verified; runtime deployment acceptance is recorded separately below.

## Frozen input

Captured from the six atomic durable catalog files at 15:30 local time, without new provider requests. Hashes and exact observed times are in `.run/double-chance-normalization-2026-09-09/catalogs/manifest.json`.

| Provider | Native observations | Canonical markets before | Quotes before |
| --- | ---: | ---: | ---: |
| BTI | 119,624 | 46,750 | 96,733 |
| CMD | 32,350 | 4,907 | 9,814 |
| APSPORT | 60,575 | 16,993 | 35,096 |
| SBOBET | 39,930 | 12,996 | 27,138 |
| SABA | 2,231 | 731 | 1,462 |
| IM | 46,365 | 12,483 | 26,277 |
| Total | 301,075 | 94,860 | 196,520 |

These native observations are not all distinct canonical betting contracts. Repeated observations, alternative offers, unsupported semantics, suspended selections and different sporting products are retained with their original disposition/reason. A normalization disposition can refer to an older or superseded native identity; it is not automatically a currently selected canonical market.

The pipeline at this capture marked only APSPORT fresh; the other five snapshots were stale. Thus this input supports a structural before/after comparison, not a live arbitrage claim. BTI's old native inventory also omitted native suspension flags, so new semantics reconstructed from those records alone cannot be promoted to OPEN. Optional original market/selection statuses are being preserved for future reproducible audits.

## Confirmed gaps

- Result and double-chance markets were not available as opposing partitions: HOME versus DRAW_AWAY, DRAW versus HOME_AWAY, AWAY versus HOME_DRAW, separately in FT/FH/SH.
- A valid singleton offer could be lost because its own provider did not supply both binary outcomes, although a different provider supplied the complement.
- Exact native competition translations were missing. Of 162 exact-participant/kickoff candidate pairs not grouped, 97 had different competition identities, 47 had a side with no canonical markets and 18 passed pairwise identity but remained ungrouped because of group/duplicate constraints. These are candidates, not 162 proven fixture merges.
- Unknown semantic equivalence was sometimes labeled EXCLUDED, understating the mapping backlog.
- CMD main and More result prices use a proven decimal formatter independent of the account's binary odds mode. Treating `ForMMR` as suspension both hid valid offers and assigned an unproven format to others. Native command 118 visibility updates also had to survive later price updates and buffered baseline admission.
- IM compact transport discarded the native market lock flag `il`. The corrected transport preserves true/false; missing or malformed lock evidence remains suspended.
- A SABA replacement socket baseline could bypass fresh catalog coverage protection after the current source changed from collector to socket provenance. The replacement guard must protect the retained catalog regardless of that provenance.

## What the counts mean

A native observation, a canonical market, a matched source-market pair and an opposing selection route are different units. For one fully compatible contract, if provider `p` supplies `n[p]` distinct eligible offers, the upper bound on cross-provider offer pairs is `sum(p < q, n[p] * n[q])`. With one offer from each of six providers, that is 15 pairs. Each pair must still have actual complementary OPEN selections, matching event identity, period, line and settlement rules. A partial offer can therefore form fewer routes than a complete offer.

Pair counts grow quadratically with overlapping offers in the same contract; they do not grow exponentially with the total inventory of unrelated markets. The implementation enumerates and deduplicates actual native pair/selection IDs. It does not divide a pair count by the total raw observation count and present that as normalization coverage. Three 1X2/DC complement partitions can reuse the same two native markets, so their three selection routes count as one source-market pair.

## Isolated competition-name result

The canonical input was unchanged. Twenty explicitly observed translation groups were tested alongside negative cases for promotion/winner products, gender, youth, divisions, playoffs and regions. No general identity threshold was relaxed.

`replay/aliases-check-comparison.json`: 52,157 → 52,652 distinct native cross-provider market pairs (+495, 0 removed); 104,314 → 105,304 opposing selection routes (+990, 0 removed). The same source market pair can support multiple selection routes, so these quantities are counted separately.

## Validation and deployment

Frozen replay with additional provider normalization, original canonical records retained and all newly reconstructed unknown statuses suspended: 94,860 → 120,890 canonical market records; 196,520 → 260,441 quotes. This is semantic reconstruction coverage, not a count of newly OPEN offers. Existing recorded canonical statuses are preserved; lost historical IM suspension flags cannot be retroactively verified.

`replay/final-all-proven-results-comparison.json`: 52,157 → 57,782 distinct native market pairs (+5,625, zero removed); 104,314 → 116,958 opposing selection routes (+12,644, zero removed). There are 1,596 result-partition rows. Four historical mathematically positive rows remain four; the five stale catalogs prevent treating this as a live opportunity count. An earlier replay joined two alternate BTI odds-format quote sets to existing canonical market IDs; the replay merge was corrected to preserve existing whole native offers, and the resulting two lost pairs returned.

Exact archived raw parser replays are separate evidence: BTI 43,879 → 49,978 native market records (+6,099, zero removed), with all 1,110,875 native selection instances retained. CMD's identical main roster and 897 More responses produce 4,582 → 7,447 canonical records and 9,164 → 17,847 quotes; all 29,895 native observations remain. CMD adds 3,007 native market IDs and removes 142 unproven MR-format IDs from canonical output while keeping those raw observations; another 313 existing IDs change canonical event ownership. Distinct CMD contracts increase 3,810 → 5,571. The final More result addition contributes 1,179 native offers but only one extra distinct contract beyond the main+DC correction. These archives have different observation times and are never added together as one live six-book snapshot.

Independent review found IM market `il` lost during compact transport and CMD's `ForMMR` mistaken for suspension. Both are corrected using saved primary renderer code. IM raw archive contains explicit `il` on all 39,864 GetSE and 66,318 GetEBI markets; 84 detail markets are locked. Missing legacy metadata remains unknown. Extension 0.2.113 preserves the flag. CMD command 118 now closes hidden results through subsequent price updates and reopens them only on an explicit native visibility update. More FT/FH 1X2 and FT Double Chance are both implemented with their exact native click identities.

The exact 22,740-row capacity probe exposed cache thrashing at the old 20,000-entry bound: warm ranking took 16.2 seconds, with zero cache hits. The bounded 30,000-entry cache gives 22,740 hits and zero misses, reducing warm ranking to 0.97–1.07 seconds. Retained heap rises by approximately 12 MiB. Cold ranking remains approximately 15 seconds. Capacity inputs deliberately enable historical statuses only to measure computation; they are not price or profit evidence.

Final integrated API validation: 623 tests in 20 files pass, including BTI, IM, AP, SBO, SABA, CMD, durable catalog and route tests. The broader check found stale partial-offer assertions and a real SABA replacement coverage gap; both were corrected, with exact retained event/quote assertions and complete replacement coverage tested. Contracts (141 tests), extension lock/transport tests (46), broad web matching tests (398), and the subsequent cache-focused tests (85) pass; counts overlap and are not added together as a unique test total. Contracts, adapters, extension, web and API build/typechecks pass. Independent native-status/More review found no remaining important blocker in its scope. Managed deployment and runtime acceptance follow.

## Deployed runtime

Managed instance `2cec1795-afca-4fd2-8b80-e1f4e2f6fb90`, API PID 9784, web PID 32440. Startup and current build identity agree: `sha256:36d84bf509a8c3c255d4c03d4869a697cbea8ca3b2f89779e70ba18cb0d903d1`. Public `https://live.babiesbo.uk/football-live` serves the exact built `index-DLsV8k-u.js`; web and public health return HTTP 200, WebSocket returns SNAPSHOT. The legacy health state remains OBSERVE/degraded with executionReady false; this is not a trade execution deployment.

Extension disk version is 0.2.113, build `sha256:3e8f5fecd6dea67aad04f944096f870a3c94fc2d6ac0f516dad18c0065998b83`. API telemetry confirms the new active worker epoch `845e6681-43cd-437d-bdac-784aaea29122`; it does not expose an independent runtime manifest version. The user's exact selected localhost dashboard was reloaded through its existing guarded UI action.

Initial public observation, 09:29:45Z–09:31:56Z: five samples, no page crash, no page errors, no visible metadata errors, 57 successful catalog transfers. Dedicated browser peak private memory 1.33 GiB; page peak JS heap 458.5 MiB, post-GC 243.1 MiB. At the final sample, the page reported 18,231 source-market pairs and two positive estimated cards (Hungary/Ukraine totals 2.5 at 0.58%, and 2.25 at 0.38%). These are unverified price observations, not confirmed executable profits.

This initial observation occurred during source hydration, with varying available providers; it is not a complete-six-book capacity acceptance. IM and SBO subsequently recovered by their existing native paths without manual source changes or decoder schema failures, but later freshness gaps also occurred.

The longer public observation, 09:37:31Z–09:40:32Z, completed seven samples with no crash, page error or visible metadata error and 55 successful catalog transfers. Peak dedicated-browser private memory was 1.42 GiB; peak page heap 563.2 MiB, post-GC 269.4 MiB. API PID 9784 stayed unchanged, with sampled heap below its 2 GiB limit. Visible source-market pairs ranged with source availability and ended at 7,873; the last sample had zero positive cards. This finite observation does not prove long-duration memory stability or complete six-provider coverage.

BTI rose to 47,014 canonical markets at 09:35:28Z, then changed source epoch `:6` to `:7` and rebuilt its catalog. At 09:39:11Z its page cache still contained 1,667 events, 192,776,615 reported bytes and zero evictions. This establishes a source-generation rebuild, not its trigger. CMD remained on an old 122-event/1,374-market baseline. One exact-source, no-navigation request-snapshot at 09:37:05Z returned BASELINE_TIMEOUT after 90 seconds; no repeated manual refresh was issued. The final runtime check at 09:41:57Z still showed CMD and SBO stale, with BTI, IM, AP and SABA fresh. These unresolved feed conditions limit current usable pairs independently of semantic normalization.

## Final frozen deployed catalogs and matching

Capture 09:41:04.967Z–09:41:08.292Z uses sequential atomic durable-file copies with hashes in `catalogs-deployed/manifest.json`. Total native observations: **204,255**; canonical market records: **79,540**; canonical quotes: **172,198**. The exact 79,540 canonical records are exported to `deployed-matcher-audit/common-markets.ndjson`, including native event/market/selection IDs, quote clocks, original prices/statuses and settlement rules. The streaming gzip export `common-markets.ndjson.gz` is 6,115,266 bytes; `common-form-sample.json` contains 22 representative source/type records for convenient inspection. Line count was independently checked during streaming export.

| Provider | Native observations | Canonical markets | Capture freshness |
| --- | ---: | ---: | --- |
| BTI | 75,756 | 36,100 | FRESH |
| CMD | 7,937 | 1,374 | STALE |
| APSPORT | 59,137 | 17,841 | FRESH |
| SBOBET | 15,083 | 8,287 | STALE |
| SABA | 1,216 | 900 | FRESH |
| IM | 45,126 | 15,038 | FRESH |

The following is a **matcher-only** comparison: the frozen old and current engines receive these exact same final canonical records. It does not mix the normalizer replay delta into matcher counts.

| Scope | Old source-market pairs | Current pairs | Added / removed | Old selection routes | Current routes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Six captured catalogs, structural | 30,613 | 40,567 | +9,954 / 0 | 61,226 | 89,380 |
| Four originally FRESH catalogs | 14,685 | 20,716 | +6,031 / 0 | 29,370 | 46,496 |

Production counter functions agree with the independent enumeration. Complete pair/route identities and every addition/loss are saved as NDJSON; there are no removed pair or route identities in either scope. The two engines were evaluated sequentially; peak audit-process RSS was 842.6 MiB.

Ranking the 14,344 visible rows from the four FRESH catalogs at capture completion produces one exact positive observational plan and zero verified plans: Torino/AS Roma FT total 2.75, AP UNDER 1.77 with 100,000 VND and IM OVER 2.31 with 76,737 VND. Worst-case profit, including the quarter-line split settlement, is 262.735 VND; estimated ROI 0.1486587%. This is a timestamped observation with no preflight, fees or balance verification, not a current executable offer.

Native dispositions remain separate: 80,232 NORMALIZED observations, 73,547 UNMAPPED and 50,476 EXCLUDED observations. The 692 difference between NORMALIZED observations and current canonical records is IM inventory identity retention; these counts cannot be interchanged. UNMAPPED observations are retained with their original types/reasons, rather than presented as successfully standardized offers. Native status provenance is also retained: IM has 45,087 explicitly OPEN and 39 SUSPENDED outer observations; AP has 59,137 OPEN outer observations; SBO retains 15,083 native rows. Absence of a per-selection status field does not erase the available outer/native-row status proof.

Remaining scope includes unsupported exact-score/range/combined and time-segment contracts, unproven CMD MR/main-DC formats, wider cross-line/cross-family strategies and complete SABA native inventory. This release does not claim 100% semantic mapping, all possible arbitrages, or stable full-six-provider live coverage. Deployment lease was released after the successful public runtime/build checks; no bet or account transaction was submitted.
