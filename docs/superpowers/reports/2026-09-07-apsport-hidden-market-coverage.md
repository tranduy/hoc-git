# APSPORT hidden football prematch coverage — 2026-09-07

## Scope and acceptance

APSPORT only, on `feat/realtime-hardening` in the existing workspace. Existing changes for other providers are retained, not represented as work completed by this audit. No bets placed.

Completion means every current real-football prematch event discovered through the provider roster endpoints has a successful, structurally valid detail response; every returned native market row is accounted for; and normalized market identities are present in the published catalog. Explicitly excluded/non-binary markets remain observable, not forced into binary comparison. This is an observed provider-response snapshot, not a promise about markets the provider did not expose or future availability.

Final live acceptance: **passed at 15:56:28 on 2026-09-07 (UTC+7)** on extension 0.2.34. The bounded read-only audit exited successfully after 624 seconds. Earlier full-but-stale snapshots remain rejected; they are not used for the completion claim.

## Accepted live measurement

Counts-only evidence: [accepted audit JSON](2026-09-07-apsport-live-acceptance.json). No raw session credentials or provider payloads are included in that artifact.

| Measurement | Accepted result |
| --- | --- |
| Current real-football prematch roster / successful detail / captured detail | 481 / 481 / 481 |
| Events with markets / structurally valid empty events | 348 / 133 |
| Pending first success / failed detail | 0 / 0 |
| Native rows returned / accounted for | 38,678 / 38,678 across 63 native groups |
| Normalized prematch markets / quotes | 10,133 / 20,266 across 36 market families |
| Missing or extra prematch events | 0 / 0 |
| Dropped / malformed / duplicate native rows | 0 / 0 / 0 |
| Missing native identities / normalized markets / quotes | 0 / 0 / 0 |
| Receipt-aligned price matches / mismatches / older prices | 1,328 / 0 / 0 |
| Catalog state / snapshot age | FRESH / 1,726 ms |
| Source identity and epoch | Unchanged throughout the accepted sweep |

All returned native rows were accounted for: 10,133 normalized; 6,866 explicitly excluded three-way outcomes; 21,205 excluded because canonical equivalence is not proven; 474 excluded for push/refund settlement. There were no unmapped rows in this snapshot. Excluded rows are retained as native observations; they are not silently lost or advertised as usable binary comparison markets.

The 133 empty events are valid provider detail responses, not failed requests. The background cycle continues after first coverage: 458 events were queued and one was in flight for refresh despite zero events awaiting their first successful detail. The oldest successful/captured detail was about 604/605 seconds old. Therefore this result proves full observed collection and matching publication, **not simultaneous freshness of every hidden quote**. The audit separately recorded 15,329 superseded price samples and 3,610 aged samples; neither is represented as an exact-price match.

Totals above exclude six live events. The whole catalog at acceptance had 10,162 markets and 20,324 quotes. No card-market family was present in this accepted prematch snapshot; card handling is test coverage, not claimed live evidence. This audit covers the currently provider-exposed roster/detail, not inaccessible markets or guaranteed future availability.

### Observed normalized prematch families

| Family | Markets |
| --- | --- |
| `FT_TOTAL` | 886 |
| `FH_TOTAL` | 891 |
| `FT_AH` | 879 |
| `FH_AH` | 898 |
| `FT_ODD_EVEN` | 326 |
| `FH_ODD_EVEN` | 325 |
| `FT_BTTS` | 326 |
| `FH_BTTS` | 325 |
| `HOME_FT_SCORE_BOTH_HALVES` | 315 |
| `AWAY_FT_SCORE_BOTH_HALVES` | 296 |
| `HOME_FT_WIN_BOTH_HALVES` | 202 |
| `HOME_FT_WIN_EITHER_HALF` | 313 |
| `AWAY_FT_WIN_EITHER_HALF` | 317 |
| `HOME_FT_ODD_EVEN` | 318 |
| `AWAY_FT_ODD_EVEN` | 318 |
| `HOME_FT_WIN_TO_NIL` | 294 |
| `AWAY_FT_WIN_TO_NIL` | 247 |
| `HOME_FT_CLEAN_SHEET` | 312 |
| `AWAY_FT_CLEAN_SHEET` | 293 |
| `FT_BOTH_HALVES_OVER_TOTAL` | 287 |
| `FT_BOTH_HALVES_UNDER_TOTAL` | 318 |
| `HOME_FT_TOTAL` | 318 |
| `AWAY_FT_TOTAL` | 318 |
| `SH_TOTAL` | 301 |
| `SH_ODD_EVEN` | 301 |
| `AWAY_FT_WIN_BOTH_HALVES` | 89 |
| `CORNER_FT_AH` | 12 |
| `CORNER_FH_AH` | 12 |
| `CORNER_FT_TOTAL` | 12 |
| `CORNER_FH_TOTAL` | 12 |
| `CORNER_FT_ODD_EVEN` | 12 |
| `CORNER_FH_ODD_EVEN` | 12 |
| `HOME_CORNER_FT_TOTAL` | 12 |
| `HOME_CORNER_FH_TOTAL` | 12 |
| `AWAY_CORNER_FT_TOTAL` | 12 |
| `AWAY_CORNER_FH_TOTAL` | 12 |

## Defects reproduced and corrected

1. **Signed handicap loss:** 787 native observations marked `NORMALIZED` were absent from the published catalog: FT_AH 339, FH_AH 441, CORNER_FT_AH 3, CORNER_FH_AH 4. APSPORT native signed positive/zero lines were incorrectly interpreted using the shared SBOBET displayed-favourite convention. Native APSPORT markets now explicitly select signed-line handling; the SBOBET default is unchanged.
2. **Deletion stopped later updates:** a valid exact inactive-event response removed adapter state, but the catalog shrink guard rejected the delta and subsequent updates. Exact single-event deletion now carries bounded internal proof, accepted only for APSPORT authenticated-HTTP deltas. Unknown, duplicate, incomplete or still-present deletion IDs are rejected.
3. **Removed markets reappeared:** a later shallow roster could resurrect markets omitted by full detail. Detail controls market membership; newer main-feed prices still update matching retained identities.
4. **Incomplete hydration looked successful:** transient detail failures now receive bounded retries. Per-event diagnostics distinguish queued, in-flight, successful-with-markets, valid-empty and failed detail work; unresolved failures prevent completion.
5. **Malformed detail could erase good state:** incomplete identity, invalid prematch kickoff, malformed market groups and non-object rows are rejected before mutation or success accounting. Unknown structurally valid groups remain observable.
6. **Valid transitions and empty results were suppressed:** live/suspended detail transitions still reach the API while leaving prematch coverage. A valid last-event empty detail can remove the final old quotes without removing the event or allowing a shallow empty response to clear the catalog.
7. **Scheduled page renewal erased complete coverage:** after reaching 451/451 successful detail events, the source epoch changed at approximately 14:07 and hidden-market hydration restarted. The page-lease coordinator scheduled APSPORT navigation every 20 minutes even when collection was healthy. APSPORT is now excluded from timer-only navigation, while explicit observed-failure/manual renewal remains available. Due-timer, explicit-renewal and unaffected-other-provider regressions pass.
8. **Transient thin roster cut the detail queue:** at 14:16:27 a complete-labelled roster contained 266 prematch events instead of 451; all 451 returned 26 seconds later in the same source epoch. The API guard retained the catalog, but the extension had already discarded 185 detail jobs. The observer now rejects unverified nonempty bulk collapse before publishing or changing its active generation/queue/coverage, matching the existing API floor of 20 and 90% retention rule. Exact inactive detail reduces the continuity baseline; newly-live events leave hidden-detail work but remain in the total roster. Initial rosters, the exact 90% boundary and the existing verified-empty path remain covered by tests.

Regression tests reproduced the defects before the fixes. A separate final code review found four edge-case blockers; all four were corrected and re-reviewed with no remaining blocker.

Two further live-audit defects were reproduced and fixed in extension 0.2.32:

- **Unrelated jobs marked failed:** at 15:09 a caught roster-refresh exception marked approximately 430 independent detail jobs failed at once, despite 449 successful event records and continuing successful detail responses. Failure ownership is now per refresh operation; roster-only failures do not alter independent jobs, stale callbacks cannot poison a newer generation, and token-owned cleanup cannot clear a newer refresh's in-flight marker. Genuine failures of the current full sweep still mark its outstanding work failed.
- **Real MLS fixtures mistaken for eSoccer:** ten missing prematch IDs at 15:10:59 were valid active, future, empty `USA Major League Soccer` fixtures (including DC United–Atlanta United). The unbounded `e[\s-]?soccer` expression matched the end of `Leagu[e Soccer]`. All three relevant eligibility paths now require word boundaries. Empty and market-bearing MLS regressions pass; explicit eSoccer/e-Soccer/e Soccer fixtures remain excluded.

Additional recovery investigation: the automatic SOFT recovery confirmation budget is 10 seconds, while captured APSPORT roster refreshes took 14.353–16 seconds. A timeout escalates directly into hard page renewal, destroying hidden-detail hydration while the roster request can still be healthy. The pre-reset socket lifecycle had already rotated out of capture, so a specific initiating socket close is not proven. An end-to-end regression confirms that after a last-football-socket close the catalog correctly remains stale, and a fresh HTTP roster at 16 seconds restores authority in the same epoch while retaining hidden detail. The controller's existing hard-recovery cooldown remains unchanged.

The APSPORT-only SOFT-timeout fix is now implemented and independently reviewed: after a delivered snapshot request times out, automatic recovery returns the timeout without immediate page renewal. A later explicit/controller HARD request remains available. No stale data is promoted to fresh. On a long-running controller after invalidation, the existing cooldown can permit HARD at 30 seconds; this patch does not promise a new 240-second delay.

A later live recovery was directly observed: at 15:12:42 the baseline lease exceeded 240 seconds while transport evidence was only 5.7 seconds old; the feed entered SOFT recovery. It returned LIVE at 15:14:52 on a fresh HTTP baseline in the same source epoch, without page navigation. This proves an actual baseline-expiry recovery in place; it does not retrospectively prove the initiating cause of the earlier 14:48 reset.

The 0.2.33 diagnostics then proved repeated `APSPORT_ROSTER_HTTP_0` failures, including 15:36:22, 15:36:34 and 15:38:36, alternating with successful 7–12-second roster walks. Zero is a local fetch/JSON/evaluation failure signal, not a provider HTTP status; its exact browser-level cause was not established. Roster requests previously had no transient retries, so one failed endpoint discarded the entire baseline walk. The 0.2.34 collector retries only that failed endpoint, up to three total attempts, for 0/408/429/5xx; cancellation and bounded Retry-After are honored. Permanent 4xx and invalid successful-response schema do not retry. No incomplete roster is published, and detail's existing five-attempt policy is unchanged.

## Rejected full snapshot (14:48:39 local)

- Successful detail: 452/452 events; 336 with markets, 116 valid empty; zero failed or pending.
- Raw detail evidence: 452/452 current prematch events; 37,812 rows accounted for, zero dropped, malformed or duplicate rows.
- Prematch publication: 9,942 normalized markets, 19,884 quotes; zero missing native or normalized market identities.
- Native dispositions: 9,942 normalized; 6,762 three-way exclusions; 20,644 canonical-equivalence-not-proven exclusions; 464 push/refund exclusions; no unmapped rows in this snapshot.
- Acceptance failed: catalog `STALE`, 82 sampled quotes older than captured receipts. The source navigated into a new epoch at 14:48:54.631. These numbers demonstrate one complete collection pass, not stable final delivery.

## Deployed version

- Chrome extension: `0.2.34`.
- Extension build: `sha256:ec87ef6f879dad6a309e9453c2cd0ce5b04d44d23d903558639876ef0c4e9d52`.
- API/live build: `sha256:fbda088a115344332f1d7d616eb660a97252a66dd804ffc530f8c06875517f00`.
- Live instance: `ee1905f5-233b-4c0f-934a-46a2a393027d`.

Full build and coordinated exact managed-stack handoff succeeded for the final 0.2.34 deployment; the deployment lease was released. Live capture is restricted to APSPORT (`TSPORT`), and collection continues in observe-only mode without placing bets. Final local health verification returned HTTP 200 with the expected build identity. The aggregate health status remains `degraded` in `OBSERVE` mode; this is not presented as full-stack execution readiness. APSPORT's own accepted catalog was `FRESH` with no failing pipeline hop.

During an earlier API-only deployment, stopping the old orchestration audit also ended its child stack. The exact handoff refused the dead process identities; all three old PIDs were verified absent and both ports free before the stale state was preserved as `.auth/run/live-stack.stale-ap-20260907-1501.json` and the official managed launcher recovered that instance. Subsequent exact handoffs completed normally.

## Verification evidence

| Check | Result |
| --- | --- |
| Final focused adapter/data-plane/coverage-guard/controller/recovery/telemetry tests | 278 passed, 6 files |
| Final full extension suite | 815 passed, 54 files (2-worker rerun) |
| Full API suite before the final SOFT-timeout patch | 1,466 passed; 7 failed — details below |
| Shared adapters | 100 passed |
| Core | 224 passed |
| Contracts | 130 passed |
| Web | 450 passed, 4 skipped |
| Integration / fixture-stack / watch smoke | 2 / 4 / 2 passed |
| Workspace typecheck; final API/extension typechecks | Passed |
| Final build; diff whitespace check | Passed |
| Diagnostic audit synthetic regression tests | 10 passed |

The final full API run had five missing-capture failures for CMD, SABA, SBOBET, IM and BTI: rotated live capture now intentionally contains APSPORT only. The APSPORT real-capture replay passed. Two browser-fixture tests exceeded their existing five-second timeout under parallel suite load. Serial reruns passed: CMD browser manager 20/20 (the affected test 795 ms), Fabet browser 52/52 (the affected test 485 ms); no code change was made for those timeouts. These results are not presented as a green full API suite. Focused and rerun counts overlap the full suites and must not be added to them.

The first 0.2.34 full extension run, concurrent with build, was 814 passed / 1 timed out (`tsport-selection-price`, five-second browser-test limit). Its isolated 10-test file passed, including the affected case in 1,726 ms. A complete rerun with two workers passed all 815 tests. No timeout limit or production behavior was changed to obtain that result.

## Live measurement method

The bounded read-only audit consumes current rotating bridge capture and local catalog/pipeline diagnostics. It assembles exact chunked bodies, keeps the latest detail per event in the current source epoch, and compares current raw-roster membership with detail coverage. Incomplete diagnostic capture fragments do not invalidate subsequent complete bodies. Out-of-order disk writes are assembled by chunk index with the maximum transport sequence; detail arriving before its roster is boundedly deferred until roster proof arrives. Both ordering cases were reproduced as failing diagnostic tests before correction. Source-epoch changes reread retained capture so the polling interval cannot silently discard the first new-source receipts.

Acceptance requires completed extension coverage, detail evidence for the entire current raw prematch roster, exact prematch event membership, fresh catalog state, zero raw-row accounting losses, and every captured native/normalized identity present in publication. Comparing only published native rows against published markets was explicitly rejected as insufficient: both could disappear together. The audit is fenced to the active source/epoch with per-event sequence high-watermarks and reports capture/catalog races rather than treating them as verified.

Normalized selection IDs are checked for missing/older quotes. At least ten exact-receipt current-prematch raw-price comparisons must match, with zero mismatches; legitimate newer prices are counted separately as superseded samples. Matching keys include event, market, selection and update sequence. Full catalog totals and prematch-only totals are reported separately.

Per-event successful collection is not proof that every quote has the same freshness. Detail-only markets follow the bounded background refresh cycle; integer/quarter Asian lines remain collected but excluded from no-refund comparison.

The final accepted counts and observed families are recorded above. For comparison, the rejected 0.2.32 cycle reached 457/457 raw and collector coverage, but a roster baseline gap caused expiry and hard page recovery at 15:28:44. Periodic refreshes completed in 122–6040 ms, not a hung queue. The 0.2.33 diagnostic correction propagated only safe HTTP/schema failure codes and capped thin-roster counts into work-health errors, while preserving prior coverage and redacting arbitrary exception text. The 0.2.34 retry fix followed that evidence without weakening freshness or coverage gates.

The independent final watcher observed 20 complete, nonempty baselines from 15:48:01 through 15:57:33 on 0.2.34. Normal cadence was mostly 15–36 seconds; the maximum gap was 83.976 seconds, below the 240-second baseline lease. Exactly three exhausted-retry outcomes remained, all local `APSPORT_ROSTER_HTTP_0`; subsequent cycles recovered automatically in the same epoch, with no page reset, timeout, forced unlock or incomplete baseline publication. Generations 17–28 published continuously after the third error, including through full acceptance. This is bounded resilience evidence, not a claim that the underlying browser failure was eliminated or a long-duration availability guarantee.
