# SBOBET categorical normalization — 2026-09-10

SBO's native More rows were retained in inventory but 22 proven market groups
were not decoded into the existing common football contracts. This change adds
their outcome tables, native offer IDs, explicit Decimal prices, periods and
settlement profiles. It also withdraws a retained categorical quote when a later
native receipt removes its price, and preserves valid disjoint goal/corner
components when a categorical row cannot be decoded.

## Fixed-snapshot result

SBO snapshot captured 08:51:20 Asia/Bangkok, SHA256
`3680a9a25d4966d303e74a18ff2e43dbf5642e6362862f604796cbdd04bc09c4`.
Both runs use exactly this snapshot and the same five frozen peer snapshots.

| Measure | Before | After |
| --- | ---: | ---: |
| Native SBO rows accounted | 26,799 | 26,799 |
| Canonical SBO markets | 10,124 | 26,314 |
| Canonical SBO quotes | 21,766 | 39,170 |
| Unmapped native rows | 16,353 | 365 |
| Excluded native rows | 322 | 120 |
| Distinct opposing source-market pairs involving SBO | 25,780 | 26,214 |
| SBO source markets participating in those pairs | 9,787 | 10,198 |
| SBO events participating in those pairs | 524 | 524 |
| Opposing source-market pairs across all six books | 79,710 | 80,144 |

Gain: **16,190 canonical markets, 17,404 quotes and 434 opposing pairs**.
All old pair identities remain present: **zero lost pairs**. Added pairs comprise
287 SBO×APSPORT and 147 SBO×BTI. Existing 10,124 markets and 21,766 quotes were
retained byte-for-byte; all native row strings, selection IDs and prices were
checked. Replayed new quote clocks and sequences are zero, never freshened.

The increase in opposing pairs is smaller than the normalization increase:
two different exact-score outcomes do not cover every possible score. The
matcher needs an actual complementary outcome, compatible period, line and
settlement, not merely another quote for the same fixture. For example SBO
DRAW+NO-BTTS is exactly 0–0 and can oppose prematch OVER 0.5; HOME+NO-BTTS
can oppose a win-to-nil NO quote. No new equivalence or freshness gate was
relaxed in the matcher.

These are structural counts, **not verified current arbitrages or profit**.
IM's frozen peer is stale. The five peers contain 338 SABA, 15,957 IM, 7,596 CMD,
58,179 APSPORT and 308,217 BTI markets. Different live receipts must not be
presented as a code-only before/after benchmark.

## Decoded native groups

| Native IDs | Common market families | Added markets |
| --- | --- | ---: |
| 10, 11 | Full-time / first-half correct score | 6,480 |
| 14, 15 | Full-time / first-half inclusive goal ranges | 4,076 |
| 132, 133 | Home / away full-time goal ranges | 1,283 |
| 68 | Half-time/full-time result | 1,458 |
| 81 | Result and both teams to score | 966 |
| 98 | Double chance and both teams to score | 966 |
| 82 | Result and total | 163 |
| 65, 87, 88 | Highest-scoring half: match / home / away | 486 |
| 16, 75 | Full-time / first-half draw no bet | 202 |
| 17, 18 | Full-time / first-half corner result | 15 |
| 131, 134, 135, 136 | Match / team / first-half corner ranges | 90 |
| 140 | First-half corners over / exact / under | 5 |

Public SBO bundles prove the mappings; names alone are not the evidence.
The checked-in `sbobet-categorical-native.fixture.json` records source hashes,
references and literal rows from the frozen capture. The native `tG` enum
differs from the bet-placement `Gt` enum. Row layouts likewise differ:
single outcomes use offer index 2, highest-half/result rows use index 3, and
corner over/exact/under uses index 4. Suspension follows the offer ID.

Critical distinctions tested:

- Half/full `13` = HOME_DRAW, `31` = DRAW_HOME. Its result codes are
  1 HOME / 2 AWAY / 3 DRAW.
- Result-BTTS `24` = DRAW_YES; double-chance-BTTS `24` = HOME_AWAY_YES.
- Range `0:1` means inclusive zero through one goal, whereas correct-score
  `0:1` is the exact score. Team totals and periods remain separate.
- Native `9:9` is SBO's OTHER-score sentinel, never literal SCORE_9_9.
- Corner group 140 is a three-outcome integer total, never Asian over/under.
- Draw no bet retains its explicit refund settlement, separate from Asian 0.
- Missing suspension evidence cannot open a quote; invalid/unavailable prices
  cannot retain an older open price. Original native IDs survive projection.

## Remaining inventory

324 rows are OTHER-score sentinels: 162 full-time and 162 first-half. A precise
excluded-score domain is still required before cross-book equivalence can be
asserted. All remain in native inventory.

41 total-goal rows belong to 15 native event IDs absent from the captured
canonical event list. Replay preserves these unchanged rather than inventing
teams, phase or competition. The existing 120 normalization-rejected rows are
also preserved; this patch does not override their event/market eligibility.

## Verification and evidence

- Initial categorical tests: 25 failures demonstrated the missing mappings.
- Final focused decoder/direct-catalog/HTTP-socket integration: 190 tests pass.
- Remaining SBO provider tests: 62 tests pass (full provider suite before the
  final six additional regressions: 198 tests passed).
- Shared normalizer: 39 tests pass. Matching regressions: 137 tests pass.
- API TypeScript check passed; deployment also compiles the API.
- Frozen replay `after-r2`: same input and peer hashes, zero lost source pairs,
  all native rows accounted, unchanged existing semantic checksum.

Ignored local evidence: `.run/sbo-normalization-2026-09-10/` contains the original
capture, five frozen peers, before/after engine bundles, pair identity sets,
remaining native rows, and `before-result.json` / `after-r2-result.json`.
The initial exploratory replay was corrected to restrict replay to the 22
changed groups; production eligibility of unrelated retained rows is not
reconstructed from incomplete event metadata.

## Deployed runtime

Managed API handoff completed; deployment lease released. Instance
`5bb8d2ef-a101-46f1-b746-9c8b0dd9a493`, API build
`sha256:c7cb19c19babe930219a70b4e88da2c0c13cce5be82aee992907e81d65cc77b0`.
The existing 4096 MiB API heap budget is retained.

At 09:15:42 local, a newly received FRESH SBO catalog contained 549 events,
12,743 canonical markets / 20,978 quotes and 12,914 accounted native rows:
12,743 normalized, 44 OTHER-score unmapped, 127 excluded. All 22 newly supported
market types were present. More detail was still being collected after the
handoff (22 highest-half offers versus 162 in the fixed historical capture), so
this live count is not a replacement for the fixed-snapshot benchmark.

Local `http://127.0.0.1:4311/football-live` and public
`https://live.babiesbo.uk/football-live` both returned HTTP 200 with existing
web asset `index-DD7xKG6J.js`. API-only normalization required no web rebuild.
Runtime evidence: `.run/sbo-normalization-2026-09-10/runtime-1789006542243.json`.
