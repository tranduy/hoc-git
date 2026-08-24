# IM Worker Task

Priority: 2

Report: `docs/superpowers/reports/five-provider/im.md`

## Required Reading

Read `common.md`, `ownership.md`, and the parallel runtime design before touching code. Follow the IM whitelist exactly.

## Proven Root Cause

The real authenticated IM GetSE feed can return positive Hong Kong odds greater than 1. The current strict Malay-only validation can reject an otherwise valid complete partition and prevent the two-part baseline from committing.

Observed public transformations establish the intended normalization rule:

- values in the valid Malay range remain unchanged;
- positive Hong Kong values greater than 1 normalize to the equivalent negative Malay value `-1 / hk`;
- zero, non-finite values, and unsupported shapes remain invalid.

The two GetSE partitions must still share one exact cutoff/generation and commit atomically.

## Required Invariant

- Normalize provider odds only at the exact IM decoding boundary.
- Preserve valid negative/positive Malay odds in range.
- Convert finite positive Hong Kong odds greater than 1 using `-1 / value` without rounding away ordering.
- Reject zero, infinities, NaN, malformed strings, and values outside the characterized contract.
- One malformed partition poisons its generation; later parts of that generation cannot recover it.
- Only both complete valid partitions with the same cutoff/generation emit one baseline.
- Ordered later deltas apply only to the committed generation.
- Normalization must not weaken event/market/selection identity validation.

## TDD Cases

1. Prove representative valid Malay value remains unchanged.
2. Prove representative positive Hong Kong values normalize to `-1 / value`.
3. Prove zero, NaN, infinity, malformed strings, and unsupported nested odds reject the partition.
4. Two valid partitions with one cutoff commit one authoritative HTTP baseline.
5. Mixed cutoffs do not combine.
6. A malformed first or second partition poisons the generation and prevents later completion.
7. A strictly newer valid generation can recover after poison.
8. Later ordered delta updates the exact selection without changing unrelated identities.

## Focused Commands

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/im-http-adapter.test.ts src/providers/im/im-football-catalog-source.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api -- --pretty false
git diff --check -- apps/api/src/chrome-bridge/im-http-adapter.ts apps/api/src/chrome-bridge/im-http-adapter.test.ts apps/api/src/providers/im/im-football-catalog-source.ts apps/api/src/providers/im/im-football-catalog-source.test.ts
```

## Phase A — LOCAL_GREEN

After focused GREEN, API typecheck, scoped diff check, and redacted secret scan,
update only the IM report to `LOCAL_GREEN` while the edit lease remains live.
Release it in `finally`, notify root with `LOCAL_GREEN IM`, and wait without
editing, building, restarting, reloading, recovering, or beginning acceptance.
IM never claims a deployment lease.

## Phase C — End-to-End Realtime Gate

Only after root publishes `ACCEPTANCE_ROUND <ROUND_ID> <BUILD_IDENTITY>`, resolve
the exact current IM source and begin the acceptance lease with
`begin-acceptance IM <worker> chrome:IM:<exact-tab-id>`. Always call
`end-acceptance` in `finally`:

Run the provider sampler without building:

```powershell
node scripts/verify-im-runtime.mjs 120000 .run/five-provider/im-runtime-evidence.json
```

1. Require two complete authenticated GetSE partitions with the same cutoff/generation to emit one baseline.
2. Require IM to become `ACTIVE` and `LIVE/FRESH`, with representative positive Hong Kong odds normalized to valid Malay odds and no authoritative empty-catalog laundering.
3. Sample for at least 120 seconds and record at least three authenticated provider response/cursor advances.
4. Record an ordered semantic delta when emitted; prove pre-cutoff deltas cannot roll back the committed generation and malformed deltas cannot renew liveness.
5. Trigger one IM-targeted reconciliation and prove the other providers' source identities are unchanged.
6. If every gate passes, end acceptance and report
   `ACCEPTANCE_PASS <ROUND_ID> IM`; do not edit the report to `DONE` yet.
7. On any failure, end acceptance, report
   `ACCEPTANCE_FAIL <ROUND_ID> IM <REDACTED_REASON>`, and obey root's
   `STOP_ACCEPTANCE`. Wait for all leases to end before returning to
   `IN_PROGRESS` and provider-local TDD.
8. Only after root announces `ROUND_ACCEPTED` for this round may IM acquire a new
   edit lease and update its report to `DONE`. `BLOCKED` is legal only for a
   proven external provider/auth failure.

Do not attach DevTools/CDP, use active-tab fallback, inspect raw provider bodies, or touch another provider. Unit tests without this live gate are not completion.
