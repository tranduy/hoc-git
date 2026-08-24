# SABA Worker Task

Priority: 1

Report: `docs/superpowers/reports/five-provider/saba.md`

## Required Reading

Read `common.md`, `ownership.md`, and the parallel runtime design before touching code. Follow the SABA whitelist exactly.

## Proven Starting Point

The common foundation already does the shared extension work:

- rejects authentication/error pages such as SPA error titles;
- recognizes an explicitly addressed authenticated SABA launch without changing generic SBO discovery;
- requires a complete current SABA socket baseline before SourceTabRecovery reports ready;
- requests a targeted same-tab Socket.IO reconnect after a new source epoch.

This worker must harden the provider-local API adapter. It must not edit extension or integration files.

## Required Invariant

SABA becomes authoritative only after one current stream produces a complete protocol sequence:

```text
OPEN -> reset -> football data (zero or more records) -> done
```

The complete `done` may publish an authoritative empty catalog only when it belongs to that proven current stream/generation. Retired, replayed, unopened, cross-stream, cross-epoch, partial, or post-gap frames cannot establish or renew authority.

After current-stream close/gap, the previous catalog may remain diagnostic but cannot be `LIVE`. A strictly newer stream in the same source epoch may rebaseline.

## TDD Cases

Add failing tests first for all cases not already covered:

1. A new current stream with reset/data/done emits exactly one WS `BASELINE` with a new generation.
2. A same-source current stream with reset/done and no football records emits an authoritative empty `BASELINE` and tombstones the old catalog.
3. Frames before `OPEN`, frames from a retired stream, and replayed envelopes produce no authority and do not mutate the active generation.
4. A stale stream `done` cannot complete a newer stream's pending baseline.
5. Close/gap invalidates delta continuity; a later same-epoch newer stream can establish a fresh baseline.
6. A current-stream post-baseline data frame emits a WS `DELTA` against the committed generation only.
7. Repeating identical done/data cannot publish duplicate authority or advance freshness.

## Focused Commands

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/saba-ws-adapter.test.ts src/chrome-bridge/saba-ws-realtime-regression.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api -- --pretty false
git diff --check -- apps/api/src/chrome-bridge/saba-ws-adapter.ts apps/api/src/chrome-bridge/saba-ws-adapter.test.ts apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts
```

## End-to-End Realtime Gate

After focused GREEN, perform the exact common deployment transaction verbatim, then begin the SABA acceptance lease with `begin-acceptance SABA <worker> chrome:SABA:<exact-tab-id>`. Retain its token and always call `end-acceptance` in `finally` before another edit/deployment:

Run the provider sampler without building:

```powershell
node scripts/verify-saba-runtime.mjs 120000 .run/five-provider/saba-runtime-evidence.json
```

1. Verify the leased tab is the current authenticated SABA page and not an auth/error page, without reading its launch token.
2. Require the leased source to move to `ACTIVE` and catalog/feed to `LIVE/FRESH` only after a current socket OPEN/reset/data/done baseline.
3. Sample for at least 120 seconds and record at least three current provider socket/evidence advances; a bridge/tab heartbeat does not count.
4. Record a semantic price/status revision if SABA emits one during the window.
5. Trigger one SABA-targeted recovery. Require a strictly newer current-stream baseline within 60 seconds and prove CMD/APSPORT/IM/SBOBET/BTI source identities were not reset.
6. Update the report to `DONE` only if every item passes. On a failed gate keep
   it `IN_PROGRESS`, record the redacted failure, end acceptance, and return to
   the worker loop. `BLOCKED` is legal only after proving a genuine external
   provider/auth failure that in-scope code and same-tab recovery cannot fix.

Do not attach a debugger, use active-tab fallback, or touch another provider. Unit tests without this live gate are not completion.
