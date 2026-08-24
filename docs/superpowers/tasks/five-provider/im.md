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

## Completion

Write the report. If observer metadata or shared integration changes are needed, specify the exact contract in the report and leave shared files untouched. Do not query the live IM page or provider endpoint.
