# BTI Today + All Early — 2026-09-08

Status: deployed; current prematch acquisition, hidden-detail publication and automatic price updates verified on 0.2.75.

## Final result

- **1,466 / 1,466** current prematch owners returned valid detail and were normalized and published. No pending, failed or evicted detail remained in the captured complete generation.
- The captured roster contained **10,129** supported markets. Detail added **26,760** markets across **1,355** owners, giving **36,889** supported native markets; the later API snapshot contained **36,891** markets and **73,782** quotes as prices and lines continued changing.
- The native capture retained **82,091** detail market rows and **1,110,875** selection rows across roster/detail. Unsupported types remain accounted for as `UNMAPPED`; three-way, refund and invalid shapes retain explicit dispositions. There were no normalized observations without their canonical market, and no event/market semantic differences.
- Initial reconciliation found one delayed corner line, six delayed selection identities and two older prices. A targeted follow-up in the same epoch confirmed all had arrived correctly. Six other historic selection IDs had already been replaced by newer authoritative API receipts, with outcomes and lines preserved.
- After full detail acquisition, **184 of 186** observed price changes were on detail-only markets relative to the captured roster. The 66.9-second window covered 34 owners and 25 WebSocket revisions; all six samples were FRESH and there were no errors.
- A single preservation check found SBOBET still LIVE/FRESH with automatic price changes. This was a smoke check, not another full SBOBET acceptance window.

The shared branch `feat/realtime-hardening` now collects BTI All Early in addition to the existing Today feed. The previous collector omitted the separate Early partition. Native football navigation reported 1,247 Early owners and 219 Today owners during discovery; these counts change as fixtures enter or leave each partition.

## Source evidence and change

The native Early initial request opens ten leagues. Its following normal request returns the complete league/event inventory, including unnamed shells. The captured normal response contained 178 master leagues and 1,247 unique Early event IDs, exactly matching navigation. `allEvents=true` included fixtures through November 29; the seven dates displayed by the calendar were not the inventory boundary.

Hydration uses native `MasterLeagueId` at league tuple index 3, in batches of ten. A source probe passing all 178 IDs returned only 47 named events, so that oversized request was not adopted. Each batch contributes only its requested master leagues, preventing other unexpanded shells from overwriting full rows. Container identity, request/receipt clocks, failure retention, and the existing detail endpoint are preserved. Today and Early enter the same authoritative prematch generation and existing publication pipeline.

The detail cache remains bounded at 2,048 owners, with an aggregate limit of 256 × 1,024² JavaScript string units. Each refresh replays at most eight detail batches through a persistent fair owner queue, alongside the three required roster responses. Replays retain the original clocks. Previous incompatible collector workers are cancelled during migration while compatible same-session cached receipts are retained.

Live reconciliation of the first deployment exposed a delivery bottleneck: all 1,467 details had been acquired, but a two-batch limit left 13,975 supported markets on 811 owners waiting for detail publication. The final deployment increases that bounded limit to eight batches. It also fixes one proven classification error: the shared virtual-football check matched `ảo` inside `Quần đảo Faroe`, incorrectly excluding AB Argir–B68 Toftir. The word now requires Unicode boundaries; actual Vietnamese virtual-football competitions remain excluded.

Roster selection compaction retains every native row and the fields consumed by the existing decoder. On the untouched 175-event initial receipt, serialized UTF-8 size fell from 2,053,067 to 1,451,053 bytes, while 175 decoded records, 3,132 native observations and 1,042 native market identities were exactly unchanged.

## Deployment and verification

- Extension: **0.2.75**, bundle `sha256:a134ac0ab1bf1a6288cd98a70e2c2be8edc4014444473648fee6b31d2c28a782`.
- Managed stack: `sha256:b98e008181348abe1a356870f86f274d7fd04ad32b695bb3382d4d61a6920e97`.
- Exact managed handoff completed; deployment lease released.
- Initial changes passed 41 focused collector/page-health/manifest checks and extension typecheck/build. The final batch limit passed 34 collector/manifest checks; the shared normalizer passed all 17 focused checks, including real Faroe and explicit virtual fixtures. Adapter and extension builds passed.
- Implementation commits: `665dc88`, `6eabfd0` on the shared branch.
- Final deployment evidence uses source epoch `a6047bff-e1f9-4d4a-af7e-ce6d96f5c943:2`. Counts moved from 1,465 to 1,466 as the provider added an owner; snapshots are compared with their own actual membership.

Raw evidence and verification scripts are in the ignored `.run/parallel-hidden-markets-2026-09-08/bti/` directory. Key discovery receipts are `native-discovery-1788858213242.json`, `native-discovery-1788858457593.json`, `native-discovery-1788858653513.json`, and `native-discovery-1788858745490.json`.

Final reconciliation artifacts:

- `native-cache-1788860177471.json`, SHA-256 `5bbe7e56b2a17a3044ce4dc9b813d7cdaa1676b2704fda6ab71485d01a46b88f`.
- `catalog-aligned-1788860305092.json`, `COVERAGE075-1788860177471.json`, and `COVERAGE075-FINDINGS-1788860177471.json`.
- `TARGETED-RESIDUALS-1788860503772.json` and `catalog-residual-aligned-1788860503772.json` resolve the remaining delayed observations without another source probe or full comparison.
- `CURRENT-WINDOW-1788860152864.json` and `ACQUISITION075-1788859992091.json` preserve the update/acquisition evidence.

Cached request/receipt clocks were preserved throughout. Complete acquisition does not mean every detail receipt is three seconds old: a whole detail refresh pass takes longer, while new data uses the existing publication pipeline. No claim of a three-second source refresh for every market or 24-hour session reliability is made.

The user deferred continuous operation/session maintenance/24-hour hardening. This change targets collection coverage and observed automatic market updates; it does not claim every native market type has a safe binary mapping.
