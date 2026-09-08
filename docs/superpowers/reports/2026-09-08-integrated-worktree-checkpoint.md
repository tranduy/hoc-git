# Integrated worktree checkpoint — 2026-09-08

## Scope and provenance

Requested operation: preserve all current work, integrate worker changes into
`feat/realtime-hardening`, and commit/push that branch. This is a WIP checkpoint,
not a provider acceptance or deployment milestone.

- Root starting commit: `30ed8006fb75e5fd022b3548291f034550bf3a04`.
- Worker shared baseline: `1710d642136138b536e4e2736a6ccb611e55fd97`.
- BTI: integrated 13 modified files and 9 new files from
  `.worktrees/parallel-bti-20260907`.
- SBOBET: integrated 12 modified files and 15 new files from
  `.worktrees/parallel-sbobet-20260907`.
- CMD and IM: both worktrees have no changes or commits after their shared
  baseline; there was no additional worker delta to import.
- Worker deltas were combined with the root's later SABA work. The shared API
  data plane merged cleanly using the common baseline. Shared extension changes
  were reconciled separately to retain each provider's behavior.
- Independent normalized-content audit confirmed all 20 non-shared modified
  files and all 24 new worker files were included. Intentional differences from
  those worker files are a synthetic secret marker in a SBOBET test fixture and
  removal of an extra end-of-file blank line in `bti-catalog-refresh.ts`.

No worker branches or worktrees were deleted or rewritten. Credentials, browser
profiles, runtime state, raw captures, and ignored build artifacts are excluded.

## Verification

Results below are from the integrated root tree, not historical worker reports.

| Check | Result |
| --- | --- |
| API typecheck | Passed |
| Web, adapters, contracts, core typecheck | Passed |
| Chrome-extension typecheck | Passed |
| API tests | 1,758 passed; 5 failed due to missing real captures |
| Chrome-extension tests | 1,307 passed |
| Web tests | 450 passed; 4 skipped |
| Adapters tests | 125 passed |
| Contracts tests | 130 passed |
| Core tests | 224 passed |
| Integration tests | 2 passed |
| Fixture-stack tests | 4 passed |
| Watch-smoke tests | 2 passed |
| SBOBET observer-to-API verification | 3 passed |

Total across these suites: **4,005 passed, 5 failed, 4 skipped**. The additional
focused observer run passed 367 tests; these are already included in the full
extension count and are not counted twice.

The five API failures are in the unchanged `replay-harness.test.ts`: missing
capture inputs for CMD, SBOBET, APSPORT, IM, and BTI. The assertions were not
weakened and no capture data was added to Git. The full test run is therefore
not reported as green.

## Acceptance and runtime boundary

Existing provider reports remain the source of their measured acceptance status.
Merging code does not establish full hidden-market coverage, exact real-time
retention, or 24/7 recovery acceptance. In particular, SABA's complete hidden
market denominator and retention acceptance remain unfinished.

The root source manifest is `0.2.67`; this checkpoint does not deploy it. The
previously observed running extension was `0.2.66`. No runtime build, restart,
source-tab reload, or deployment is part of this Git operation.
