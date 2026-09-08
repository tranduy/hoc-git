# SBOBET More source integration — 2026-09-08

> Historical worker report, preserved during MAIN consolidation. Its pending integration and deployment status is superseded by [the current SBOBET production report](2026-09-08-sbobet-main-production.md). Use [the current branch handoff](2026-09-08-main-branch-handoff.md) for the next provider task.


Status: LOCAL_READY / WAITING_INTEGRATION_AND_LIVE,13:06UTC+7. The incremental package is implemented, reviewed, verified and exported. This is not deployment or full-provider acceptance.

## Actual source and defects

The assigned KSPORT/SBOBET page issues `GET https://be.sb21.net/api/v2/getEventBetMore` with the actual event/league identity. A saved event5717357 receipt contains54priced groups,138rows and187selection IDs. Opening More exposed96additional DOMselection IDs that all occur in the later HTTPreceipt; capture times differ, so this is identity evidence rather than simultaneous price verification. Two bounded batches read the same34saved owners. The later batch returned34HTTP200,28priced events,6exact empty objects and4111selection IDs in9410ms. Those owners are not a complete current-provider denominator.

Three concrete code defects were found: the old detail route did not describe the actual flat More response; separate goal/corner containers for the same native event overwrote each other; and the native parser treated every price as Malay. Public application code proves that several More groups use Decimal even when the request selects `ma`. The source's group enum, row-index maps, More renderer and price-format predicate are recorded with asset hashes and offsets in the private evidence directory. No price format is inferred solely from its numeric range.

More omits main groups1–6. It provides complementary observations, not whole-event replacement authority. Empty or absent More groups cannot establish absence of hidden markets.

## Implemented path

- Combine only verified same-event goal/corner components with matching explicit metadata, disjoint groups and nonconflicting native market IDs; handle neutral zero handicap. The saved main receipt now produces24markets/48quotes instead of only4corner markets.
- Capture the real More HTTPresponse with exact event/league, request, document, source epoch and receipt-clock attribution. Metadata group0 stays outside market inventory; priced rows retain their native identity and disposition.
- Refresh actual prematch owners through the existing maintenance scheduler. The caller uses the source endpoint, bounded concurrency, TTL, timeout/backoff and cancellation; it publishes through the actual HTTPobserver receipt, including forwarding acknowledgement. No additional realtime timer or synthetic source publication is introduced.
- Merge More by touched native IDs into the existing KSPORT catalog. Preserve detail-only membership across shallow main refreshes, keep newer main/socket prices, retire invalidated known selections and reject stale/retired documents, owners or generations.
- Use the existing catalog/revision path. Full-source baseline freshness rules and the3second publication configuration remain in force.
- Decode the source-proven Decimal More families with exact native row layouts, outcome order and suspension flags: odd/even, BTTS, sending off, team corner totals, team goals/both-halves/win-to-nil/clean-sheet predicates and second-half markets. Native groups16/75 remain refund exclusions. The shared AP/SBO normalizer and settlement contracts were not edited.

## Isolation and verification

Worker checkout: `.worktrees/parallel-sbobet-20260907`. Integration target: clean MAIN `82df06689d2bc30eeee3c85e211807a117188754`.

The private observer starts from an older baseline than MAIN. Its new More changes are merged against the previous frozen worker tree `31d6a692bc1d3b776e1f9a581daef04b408bd124`, preserving MAIN's subsequent SABA changes. Export must use that reviewed merged file, never copy the entire older worker observer over MAIN. Provider and shared-observer patches are separated. Existing historical packages are immutable and already integrated; do not reapply them.

Final staged current-MAIN verification covers180distinct API tests and604extension tests, including existing shared observer/SABA regressions. API/extension typechecks passed. The final API run covered167tests across4files; the final changed source-revision test and the old hidden-market integration suite passed14/14, giving180distinct tests. Independent reviews approved the collector, mappings, source-price revision test and exporter. No production source, runtime, manifest, serving dist or browser session was changed by this integration work.

The real event5717357 More receipt now yields29canonical markets/58quotes instead of4/8. Combining the actual main and More records through the staged API produces49markets/98quotes (25new hidden markets/50new quotes), retains160native observations across60groups, and preserves the original40main goal quotes and clocks. A separate real-source fixture for event5729104 verifies eight odd/even and BTTS selection identities, Decimal format, outcomes, scope and actual changed prices through producer/schema/default API router/data plane/revision/read. Its242591ms capture gap is explicitly compressed for the offline publication test. Identical later data leaves the semantic revision unchanged; a shallow main refresh retains the hidden quotes and clocks.

Across all34saved owners, More-only accounting preserves3067native rows and4111source selection IDs, and produces619canonical binary markets/1238quotes from28priced owners. Every native row has a disposition, and every canonical price equals its source token. This is a saved roster sample, not the full current SBOBET denominator.

Frozen package: MAIN `.run/parallel-hidden-markets-2026-09-07/sbobet/more-source-v1`,18files; candidate tree `35e16a3c4e027e0d4573f02024d78fc7716a0592`. Provider patch183521bytes SHA256 `e13ca70a86e336c9a38b4e2a3dd3861c081af2012cbaa818b90610f249ed831c`; shared-observer patch29982bytes SHA256 `369da9b298fb8ca8e538ebfd2a1ed99c923f3e1985f2a59539b3b0ba5893bd5d`. Alternate-index reconstruction and individual/combined dry-run application against MAIN passed; MAIN source and real index stayed unchanged.

Saved-data integration distinguishes original capture gaps from a compressed offline test timeline. Original main-to-More gaps exceed the current120000ms baseline freshness limit and are correctly rejected without an intervening source baseline. Successful offline publication does not reconstruct missing historical refreshes or prove current deployment.

## Remaining acceptance work

1. Apply the finalized incremental package through the current integration/runtime owner and publish its actual build/epoch. The shared ownership instructions in `02-SBOBET.md`, `05-TIEP-TUC-DEN-NGHIEM-THU.md` and MAIN runtime ledger reserve deployment to that owner.
2. Verify automatic More requests, newly normalized hidden prices and their later changes through API/revision/UI on the deployed build, with a stable10–15minute measurement window for source `chrome:KSPORT:2105829034` (or its explicitly reassigned successor). SBOBET worker retains investigation, measurement and fixes; this does not transfer implementation to SABA.
3. Establish the full current Today/Early roster denominator and reconcile every native group. Public code confirms the Early route and response branch; one unauthenticated plain-Node Early request returnedHTTP400. That probe establishes no Early membership or cause of failure. The observed in-session request still needs verification.
4. Measure actual source refresh, ingest and publication delays separately, and verify continuous recovery. A short successful window cannot establish24hours of operation. Until these checks pass, full SBOBET coverage and24/7 operation remain unaccepted.
