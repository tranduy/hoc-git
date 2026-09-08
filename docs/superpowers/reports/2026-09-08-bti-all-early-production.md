# BTI Today + All Early — 2026-09-08

Status: deployed; final native detail reconciliation in progress.

The shared branch `feat/realtime-hardening` now collects BTI All Early in addition to the existing Today feed. The previous collector omitted the separate Early partition. Native football navigation reported 1,247 Early owners and 219 Today owners during discovery; these counts change as fixtures enter or leave each partition.

## Source evidence and change

The native Early initial request opens ten leagues. Its following normal request returns the complete league/event inventory, including unnamed shells. The captured normal response contained 178 master leagues and 1,247 unique Early event IDs, exactly matching navigation. `allEvents=true` included fixtures through November 29; the seven dates displayed by the calendar were not the inventory boundary.

Hydration uses native `MasterLeagueId` at league tuple index 3, in batches of ten. A source probe passing all 178 IDs returned only 47 named events, so that oversized request was not adopted. Each batch contributes only its requested master leagues, preventing other unexpanded shells from overwriting full rows. Container identity, request/receipt clocks, failure retention, and the existing detail endpoint are preserved. Today and Early enter the same authoritative prematch generation and existing publication pipeline.

The detail cache remains bounded at 2,048 owners, with an aggregate limit increased from 24 to 256 million-scale string units (256 × 1,024²). Each refresh replays at most two detail batches through a persistent fair owner queue; this avoids returning the whole cache and dropping required roster responses at the observer's response limit. Replays retain the original clocks. Previous collector workers are cancelled during migration while compatible same-session cached receipts are retained.

Roster selection compaction retains every native row and the fields consumed by the existing decoder. On the untouched 175-event initial receipt, serialized UTF-8 size fell from 2,053,067 to 1,451,053 bytes, while 175 decoded records, 3,132 native observations and 1,042 native market identities were exactly unchanged.

## Deployment and verification

- Extension: **0.2.74**, bundle `sha256:535347997a95ec438a8f62bb18830b9194f19b98bf535f03f6cd74335e0d3fb1`.
- Managed stack: `sha256:9406e1f17391d43842b3bb9c7b770952f16a2feaccafbffa1108efc10aa3b7c0`.
- Exact managed handoff completed; deployment lease released.
- 41 focused collector/page-health/manifest checks passed; extension typecheck and build passed.
- Initial deployed observation: 1,466 desired prematch owners, 1,246 valid Early roster identities, then automatic growth in cached detail and published catalog.

Raw evidence and verification scripts are in the ignored `.run/parallel-hidden-markets-2026-09-08/bti/` directory. Key discovery receipts are `native-discovery-1788858213242.json`, `native-discovery-1788858457593.json`, `native-discovery-1788858653513.json`, and `native-discovery-1788858745490.json`.

The user deferred continuous operation/session maintenance/24-hour hardening. This change targets collection coverage and observed automatic market updates; it does not claim every native market type has a safe binary mapping.
