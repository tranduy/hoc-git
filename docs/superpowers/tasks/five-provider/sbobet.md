# SBOBET/KSPORT Worker Task

Priority: 2

Report: `docs/superpowers/reports/five-provider/sbobet.md`

## Required Reading

Read `common.md`, `ownership.md`, and the parallel runtime design before touching code. Follow the SBOBET whitelist exactly.

## Proven Root Cause

KSPORT live and today baseline partitions are separate provider receipts. Requiring their receipt sequence numbers to be exactly equal is not a valid generation contract and can leave SBOBET permanently pending even while both current partitions arrive.

Receipt order remains important for delta ordering and overlap resolution, but it must not be confused with the explicit recovery/baseline generation that pairs the two partitions.

## Required Invariant

- A recovery request or fresh stream establishes one explicit pending baseline generation.
- Current live and today full partitions carrying that same generation commit atomically even when their receipt sequence numbers differ.
- Receipt sequence remains monotonic evidence inside each partition and for later deltas.
- Mixed explicit generations never combine.
- Overlapping event IDs select the record with the newest receipt order; live wins exact ties for deterministic compatibility.
- Deltas arriving while a replacement baseline is pending are bounded and replay only when newer than the committed partition evidence.
- Overflow, gap, close, malformed, replayed, stale-stream, or retired-generation evidence cannot renew authority.
- A strictly newer stream/generation can recover in the same source epoch.

Use a separate `ksport-baseline-generation` unit only if it keeps generation pairing, receipt ordering, and bounds explicit.

## TDD Cases

1. Live receipt 100 and today receipt 104 with one explicit recovery generation commit one baseline.
2. Equal receipt numbers with different explicit generations do not combine.
3. Delayed old live/today parts cannot complete a newer pending generation.
4. Overlapping event IDs choose the higher receipt order; live wins exact ties.
5. A bounded pending delta newer than its partition baseline is applied after commit.
6. Pending-delta overflow invalidates the generation and suppresses heartbeat authority until a newer full pair commits.
7. Close/gap followed by a strictly newer stream can rebaseline in the same source epoch.
8. Complete authoritative empty partitions tombstone old state only when both explicit partitions complete.

## Focused Commands

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/ksport-ws-adapter.test.ts src/chrome-bridge/ksport-baseline-generation.test.ts
git diff --check -- apps/api/src/chrome-bridge/ksport-ws-adapter.ts apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts apps/api/src/chrome-bridge/ksport-baseline-generation.ts apps/api/src/chrome-bridge/ksport-baseline-generation.test.ts
```

If the optional generation files are unnecessary, do not create them and omit them from the command.

## Required Shared Integration Request

The common base must carry the explicit recovery generation. If runtime proves that shared wiring defective, send the exact failing test/symbol to the root while continuing provider-local work.

## End-to-End Realtime Gate

After focused GREEN, perform the exact common deployment transaction verbatim, then begin the SBOBET acceptance lease with `begin-acceptance SBOBET <worker> chrome:KSPORT:<exact-tab-id>`. Retain its token and always call `end-acceptance` in `finally` before another edit/deployment:

Run the provider sampler without building:

```powershell
node scripts/verify-sbobet-runtime.mjs 120000 .run/five-provider/sbobet-runtime-evidence.json
```

1. Require current live and today full partitions under one explicit recovery generation to commit atomically even when receipt sequences differ.
2. Require SBOBET to become `ACTIVE` and `LIVE/FRESH`; mixed generations and partial pairs must remain non-authoritative.
3. Sample for at least 120 seconds and record at least three current KSPORT evidence/receipt advances and a semantic delta when emitted.
4. Prove pending-delta overflow/gap/close suppresses liveness until a strictly newer full pair commits.
5. Trigger one SBOBET-targeted recovery, require a current baseline within 90 seconds, and prove all other provider sources remain unchanged.
6. Update the report to `DONE` only if every gate passes. On a failed gate keep
   it `IN_PROGRESS`, record the redacted failure, end acceptance, and return to
   the worker loop. `BLOCKED` is legal only after proving a genuine external
   provider/auth failure that in-scope code and same-tab recovery cannot fix.

Do not attach DevTools/CDP, use active-tab fallback, inspect launch/auth data, or touch another provider. Unit tests without this live gate are not completion.
