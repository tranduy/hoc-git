# IM Worker Task

Priority: 4

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
git diff --check -- apps/api/src/chrome-bridge/im-http-adapter.ts apps/api/src/chrome-bridge/im-http-adapter.test.ts apps/api/src/providers/im/im-football-catalog-source.ts apps/api/src/providers/im/im-football-catalog-source.test.ts
```

## Phase A Handoff

Write the report with status `READY_FOR_INTEGRATION`. If observer metadata or shared integration changes are needed, specify the exact contract and leave shared files untouched. Do not describe the task as done and remain available.

## Phase B Realtime Gate

After the integrator supplies the IM runtime lease:

Run the provider sampler without building:

```powershell
node scripts/verify-im-runtime.mjs 45000 .run/five-provider/im-runtime-evidence.json
```

1. Require two complete authenticated GetSE partitions with the same cutoff/generation to emit one baseline.
2. Require IM to become `ACTIVE` and `LIVE/FRESH`, with representative positive Hong Kong odds normalized to valid Malay odds and no authoritative empty-catalog laundering.
3. Sample for at least 45 seconds and record at least three authenticated provider response/cursor advances.
4. Record an ordered semantic delta when emitted; prove pre-cutoff deltas cannot roll back the committed generation and malformed deltas cannot renew liveness.
5. Trigger one IM-targeted reconciliation and prove the other providers' source identities are unchanged.
6. Update the report to `DONE` only if every gate passes; otherwise mark `BLOCKED` with exact redacted reason.

Do not attach DevTools/CDP, use active-tab actions, build/restart/reload, inspect raw provider bodies, or touch another provider.
