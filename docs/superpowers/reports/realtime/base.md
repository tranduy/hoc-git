TASK B1 BLOCKED — targeted B1 tests pass (5/5) and API typecheck passes; required live-stack gate failed because the running stack returned HTTP_404 and build/restart is forbidden.

```text
> npm.cmd exec --workspace @tool-chenh/api vitest -- run src/diagnostics/pipeline-telemetry.test.ts src/routes/diagnostics.test.ts
Test Files  2 passed (2)
Tests       5 passed (5)

> npm.cmd run typecheck --workspace @tool-chenh/api
> tsc -p tsconfig.json --noEmit
Exit code: 0

> node scripts/diag-pipeline.mjs
diag-pipeline failed: HTTP_404
Exit code: 1
```

TASK B2 BLOCKED — RED reproduced the permanent in-flight lock and GREEN proves watchdog recovery/forcedUnlocks; required live `diag-pipeline` evidence is unavailable because the running stack still returns HTTP_404.

```text
RED > npm.cmd exec --workspace @tool-chenh/chrome-extension vitest -- run src/cmd-snapshot-poller.test.ts -t "releases a refreshCatalog guard that stays hung across twenty ticks"
FAIL CmdSnapshotPoller > releases a refreshCatalog guard that stays hung across twenty ticks
AssertionError: expected "spy" to be called 2 times, but got 1 times
Test Files  1 failed (1)
Tests       1 failed | 24 skipped (25)
Exit code: 1

GREEN > npm.cmd exec --workspace @tool-chenh/chrome-extension vitest -- run src/cmd-snapshot-poller.test.ts
Test Files  1 passed (1)
Tests       25 passed (25)
Exit code: 0

> npm.cmd exec --workspace @tool-chenh/chrome-extension vitest -- run src/network-observer.test.ts -t "emits only sanitized poller work health as TAB_STATE diagnostic"
Test Files  1 passed (1)
Tests       1 passed | 207 skipped (208)
Exit code: 0

> npm.cmd run typecheck --workspace @tool-chenh/chrome-extension
> tsc -p tsconfig.json --noEmit
Exit code: 0

> node scripts/diag-pipeline.mjs CMD
diag-pipeline failed: HTTP_404
Exit code: 1
```

TASK B3 DONE — real-capture tests replayed all 6 providers through `ChromeCatalogDataPlane`; CLI replayed 97 real SABA envelopes and reported production results without raw bodies.

```text
> node --test scripts/replay-capture.test.mjs
# tests 1
# pass 1
# fail 0

> npm.cmd exec --workspace @tool-chenh/api vitest -- run src/chrome-bridge/replay-harness.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)

> npm.cmd run typecheck --workspace @tool-chenh/api
> tsc -p tsconfig.json --noEmit
Exit code: 0

> node scripts/replay-capture.mjs --capture "%LOCALAPPDATA%\tool-chenh\chrome-bridge-captures\capture-1787556598048.jsonl" --provider SABA
{"provider":"SABA","capture":"capture-1787556598048.jsonl","envelopes":97,"baselines":0,"deltas":0,"rejected":{"total":97,"reasons":{"NOT_APPLIED":91,"NON_CATALOG":6}},"semanticChanges":0}
Exit code: 0

Capture coverage used by the six real-capture tests: CMD, SABA, SBOBET/KSPORT, APSPORT/TSPORT, IM, BTI all present.
```

TASK B4 BLOCKED — policy table and invariant tests pass for all 6 providers; the required live trace gate cannot be observed because the running stack returns HTTP_404 and build/restart is forbidden.

```text
> npm.cmd exec --workspace @tool-chenh/api vitest -- run src/chrome-bridge/provider-feed-policies.test.ts
B4_POLICY_TABLE [{"provider":"CMD","beforeExpectedMs":20000,"beforeBaselineMs":20000,"afterExpectedMs":180000,"afterBaselineMs":360000},{"provider":"IM","beforeExpectedMs":20000,"beforeBaselineMs":25000,"afterExpectedMs":45000,"afterBaselineMs":90000},{"provider":"SABA","beforeExpectedMs":10000,"beforeBaselineMs":60000,"afterExpectedMs":10000,"afterBaselineMs":60000},{"provider":"SBOBET","beforeExpectedMs":10000,"beforeBaselineMs":60000,"afterExpectedMs":10000,"afterBaselineMs":60000},{"provider":"APSPORT","beforeExpectedMs":5000,"beforeBaselineMs":30000,"afterExpectedMs":5000,"afterBaselineMs":30000},{"provider":"BTI","beforeExpectedMs":10000,"beforeBaselineMs":30000,"afterExpectedMs":90000,"afterBaselineMs":180000}]
Test Files  1 passed (1)
Tests       2 passed (2)
Exit code: 0

> node scripts/diag-pipeline.mjs
diag-pipeline failed: HTTP_404
Exit code: 1
```

TASK B5 DONE — sampler now fails zero-change sessions with SEMANTIC_CHANGE_NOT_OBSERVED, fails one-change sessions with SEMANTIC_CHANGE_TOO_SPARSE, and supports an explicit diagnostic --no-lease path while the default remains lease-bound. Proposed minimum for Opus review: 2 semantic changes per sampling session for each of CMD, SABA, SBOBET, APSPORT, IM, and BTI.

```text
> node --test scripts/provider-runtime-sampler.test.mjs
# Subtest: fails an otherwise-green session when no semantic quote change is observed
ok 3 - fails an otherwise-green session when no semantic quote change is observed
# Subtest: fails when semantic changes are below the provider minimum
ok 4 - fails when semantic changes are below the provider minimum
# Subtest: supports diagnostic --no-lease binding while official mode remains lease-bound
ok 5 - supports diagnostic --no-lease binding while official mode remains lease-bound
1..16
# tests 16
# pass 16
# fail 0
Exit code: 0
```

TASK B6 BLOCKED — exponential per-account backoff, reset-on-recovery, coalesced state logs, and HOP6 recovery telemetry pass source tests; the required live 5-minute stack/CPU gate cannot be run because build/restart is forbidden and the running stack has not loaded these source changes.

```text
> npm.cmd exec --workspace @tool-chenh/api vitest -- run src/chrome-bridge/automatic-source-recovery.test.ts
Test Files  1 passed (1)
Tests       34 passed (34)
Exit code: 0

> npm.cmd exec --workspace @tool-chenh/api vitest -- run src/chrome-bridge/automatic-source-recovery.test.ts -t "backs one repeated failure off to at most nine log state changes in five minutes" --reporter=verbose
✓ AutomaticSourceRecovery > backs one repeated failure off to at most nine log state changes in five minutes
Test Files  1 passed (1)
Tests       1 passed | 33 skipped (34)
Exit code: 0

Simulated failure schedule asserted by the passing test: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s; 9 state/log lines in the first 5 minutes, then capped at 300s.

> npm.cmd exec --workspace @tool-chenh/api vitest -- run src/server.test.ts -t "provider recovery sweep lifecycle"
Test Files  1 passed (1)
Tests       4 passed | 12 skipped (16)
Exit code: 0

> npm.cmd run typecheck --workspace @tool-chenh/api
> tsc -p tsconfig.json --noEmit
Exit code: 0
```

BASE_READY_FOR_REVIEW

## BASE review fixes 2026-08-25

FIX F1 DONE — Các test controller/data-plane lấy ngưỡng trực tiếp từ `providerFeedPolicies`, tên test đã đổi theo policy và không xóa/nới assertion. Bằng chứng full suite bên dưới: `provider-feed-controller.test.ts` 16/16 pass; `chrome-catalog-data-plane.test.ts` 51/51 pass.

FIX F2 DONE — CMD/IM/BTI dùng cadence hiệu dụng 15 giây làm gốc; `expectedEvidenceCadenceMs=45000`, `maxBaselineAgeMs=90000`. Comment trong policy ghi rõ cadence gốc và lý do; mọi provider thỏa `maxBaselineAgeMs <= 180000`.

```text
B4_POLICY_TABLE [{"provider":"CMD","beforeExpectedMs":20000,"beforeBaselineMs":20000,"afterExpectedMs":45000,"afterBaselineMs":90000},{"provider":"IM","beforeExpectedMs":20000,"beforeBaselineMs":25000,"afterExpectedMs":45000,"afterBaselineMs":90000},{"provider":"SABA","beforeExpectedMs":10000,"beforeBaselineMs":60000,"afterExpectedMs":10000,"afterBaselineMs":60000},{"provider":"SBOBET","beforeExpectedMs":10000,"beforeBaselineMs":60000,"afterExpectedMs":10000,"afterBaselineMs":60000},{"provider":"APSPORT","beforeExpectedMs":5000,"beforeBaselineMs":30000,"afterExpectedMs":5000,"afterBaselineMs":30000},{"provider":"BTI","beforeExpectedMs":10000,"beforeBaselineMs":30000,"afterExpectedMs":45000,"afterBaselineMs":90000}]
```

FIX F3 BLOCKED — Replay đã trả lý do từ chối thật theo từng envelope và không còn `NOT_APPLIED`; đã thêm recorder từ thời điểm bridge WebSocket mở. Unit test recorder/replay pass, nhưng không thể tạo bằng chứng live bắt buộc vì stack hiện có 0 live source và Chrome không mở CDP. Không có capture mới để chứng minh `baselines >= 1` và `semanticChanges >= 1`.

```text
TAP version 13
# Subtest: parses bounded recorder arguments
ok 1 - parses bounded recorder arguments
# Subtest: redacts sensitive fields before writing a bridge envelope
ok 2 - redacts sensitive fields before writing a bridge envelope
# Subtest: parses the replay contract and semantic assertion threshold
ok 3 - parses the replay contract and semantic assertion threshold
1..3
# tests 3
# suites 0
# pass 3
# fail 0
# cancelled 0
# skipped 0
# todo 0

{"provider":"SABA","capture":"capture-1787556598048.jsonl","envelopes":97,"baselines":0,"deltas":0,"rejected":{"total":97,"reasons":{"CANDIDATE_INVALIDATION_IGNORED:saba-ws-catalog-v1":43,"TAB_STATE_TRANSPORT_ONLY":6,"ADAPTER_DECODE_EMPTY:saba-ws-catalog-v1":29,"CANDIDATE_DOM_FALLBACK:saba-ws-catalog-v1":12,"ADAPTER_FINGERPRINT_UNMATCHED":7}},"semanticChanges":0}

LIVE_SOURCES=0
CDP_AVAILABLE=false
record-capture failed: CDP_ENDPOINT_UNAVAILABLE
Exit code: 1
```

FIX F4 DONE — HOP1 tìm tab theo account/provider bất kể disposition, ưu tiên ACTIVE nếu có, và trả `authorityDisposition` trong detail; HOP5 vẫn chịu trách nhiệm phân định authority. Test candidate-tab mới pass trong full suite (`pipeline-telemetry.test.ts` 4/4).

FULL SUITE — output thật của `npm.cmd test --workspaces --if-present`:

```text
> @tool-chenh/api@0.0.0 test
Test Files  150 passed (150)
> @tool-chenh/chrome-extension@0.0.0 test
Test Files  37 passed (37)
> @tool-chenh/web@0.0.0 test
Test Files  45 passed (45)
> @tool-chenh/adapters@0.0.0 test
Test Files  11 passed (11)
> @tool-chenh/contracts@0.0.0 test
Test Files  2 passed (2)
> @tool-chenh/core@0.0.0 test
Test Files  10 passed (10)
EXIT_CODE=0
```

TYPECHECK — output thật của `npm.cmd run typecheck --workspaces --if-present`:

```text
> @tool-chenh/api@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit

> @tool-chenh/chrome-extension@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit

> @tool-chenh/web@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit

> @tool-chenh/adapters@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit

> @tool-chenh/contracts@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit

> @tool-chenh/core@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit

Exit code: 0
```

## BASE live deployment 2026-08-25

BASE_DEPLOY_LIVE BLOCKED — Build thành công nhưng managed restart thất bại với `STACK_INSTANCE_DISCOVERY_UNAVAILABLE`. Deployment lease đã được abort và xác nhận không còn active. Không chạy `diag-pipeline.mjs` vì bước restart chưa thành công; không reload/chạm tab sportsbook.

```text
> build
> npm run build --workspaces --if-present

> @tool-chenh/api@0.0.0 build
> tsc -p tsconfig.json

> @tool-chenh/chrome-extension@0.0.0 build
> node scripts/build.mjs

> @tool-chenh/web@0.0.0 build
> tsc -p tsconfig.json && vite build

✓ built in 350ms

> @tool-chenh/adapters@0.0.0 build
> tsc -p tsconfig.json

> @tool-chenh/contracts@0.0.0 build
> tsc -p tsconfig.json

> @tool-chenh/core@0.0.0 build
> tsc -p tsconfig.json

Exit code: 0

DEPLOYMENT_LEASE=CLAIMED
[live-stack] restart failed: STACK_INSTANCE_DISCOVERY_UNAVAILABLE
MANAGED_RESTART_FAILED
Exit code: 1

DEPLOYMENT_LEASE_ACTIVE=False
```

## BASE exact-v2 live handoff 2026-08-25

EXACT_V2_HANDOFF DONE — Đã claim deployment lease, set `TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN`, chạy exact-v2 handoff và release lease. Giao dịch chứa lệnh handoff exit 0 sau 20.0 giây; shell wrapper không trả stdout nên report không dựng lại dòng output không quan sát được.

```text
node scripts/exact-v2-stack-handoff.mjs
Exit code: 0
Wall time: 20.0 seconds
Observed stdout: (empty)

DEPLOYMENT_LEASE_ACTIVE=False
```

DIAG_PIPELINE DONE — Output thật của `node scripts/diag-pipeline.mjs`:

```text
CMD      firstFailingHop=null             LIVE/NO_FEED                       baseline=19.0s>90.0s   evid=19.0s>45.0s   quotes=946 Δ60s=527 forcedUnlocks=0
IM       firstFailingHop=null             LIVE/NO_FEED                       baseline=13.3s>90.0s   evid=7.0s>45.0s    quotes=3196 Δ60s=1452 forcedUnlocks=0
SABA     firstFailingHop=HOP1_TAB         SOFT_RECOVERY/RECOVERY_SOFT        baseline=n/a>60.0s     evid=n/a>10.0s     quotes=2024 Δ60s=8 forcedUnlocks=0
SBOBET   firstFailingHop=HOP1_TAB         SOFT_RECOVERY/RECOVERY_SOFT        baseline=n/a>60.0s     evid=n/a>10.0s     quotes=554 Δ60s=0 forcedUnlocks=0
APSPORT  firstFailingHop=HOP1_TAB         SOFT_RECOVERY/RECOVERY_SOFT        baseline=n/a>30.0s     evid=n/a>5.0s      quotes=368 Δ60s=0 forcedUnlocks=0
BTI      firstFailingHop=null             LIVE/NO_FEED                       baseline=2.4s>90.0s    evid=2.4s>45.0s    quotes=646 Δ60s=320 forcedUnlocks=0

Exit code: 0
```

Shape verification:

```text
DIAG_SHAPE providers=6 hops=8,8,8,8,8,8
Exit code: 0
```

BASE_DEPLOYED_LIVE

## Opus live check 2026-08-25

Independent `GET /api/health` after handoff: `buildIdentity=sha256:7356eef5012a98608d88681ab19baf494d738adb987d0bbf4564b748f22dddd8` (new process, not the pre-handoff `c342dc6…` stack). Independent `node scripts/diag-pipeline.mjs`: HTTP_404 gone; 6 providers × 8 hops. Remaining hop failures are provider work, not BASE.

BASE_APPROVED

