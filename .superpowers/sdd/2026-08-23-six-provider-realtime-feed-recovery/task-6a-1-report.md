# Task 6A.1: Contract and Multipart Authority Fences — DONE

Date: 2026-08-24

Workspace: `F:/0. PROJECT/tool-chenh/.worktrees/six-provider-realtime-feed`

Branch / starting HEAD: `feat/six-provider-realtime-feed` / `20bfe688b338713069111541c5f304093781dcf1`

## Outcome

The Chrome bridge contract now exposes optional, all-or-none KSPORT recovery metadata. The only accepted recovery partitions are `KSPORT_LIVE` and `KSPORT_TODAY`, the content intent is exactly `FOOTBALL_FULL_CATALOG`, and `requestStartSequence` is a nonnegative safe integer. Partial recovery metadata, unsupported values, negative/fractional cutoffs, unsafe integers, and secret-bearing extras fail closed.

Multipart HTTP assembly now binds the complete sanitized request object in addition to envelope authority, clocks, source/epoch, tab, lobby, transport, chunk count, and snapshot request/document identity. This automatically includes the new KSPORT partition, intent, and request-start cutoff and prevents a later contract request field from being silently omitted from multipart identity.

The existing resource budgets remain unchanged and are behaviorally covered: 30-second body TTL, 8 pending bodies and 24 MiB per source, and 48 pending bodies and 144 MiB globally. Exact quarantine and its bounded per-account source-epoch compaction fence use the same TTL and still clear on explicit source reset or a strictly newer canonical epoch. A mismatch or overflow never evicts another provider's pending body.

## TDD record

Contract RED was captured before the schema change:

```text
chrome-bridge.test.ts: 1 failed / 14 passed.
The complete KSPORT recovery request was rejected because the fields and partition values did not exist.
```

Contract GREEN:

```text
chrome-bridge.test.ts: 15 passed.
```

Assembler RED was captured before the identity and quarantine changes:

```text
network-body-assembler.test.ts: 3 failed / 23 passed.
providerContentIntent mismatch completed the body.
requestStartSequence mismatch completed the body.
An exact quarantine did not expire at its documented 30-second TTL.
```

Assembler GREEN after the minimal implementation and preservation probes:

```text
network-body-assembler.test.ts: 27 passed.
```

The 5,000-first-chunk adversarial probe retains fixed pending/quarantine state, preserves another provider's already-pending body, rejects late overflow fragments, recovers after TTL, and also recovers on a strictly newer canonical epoch.

## Final verification

```text
Whole contracts package: 2 suites / 96 tests passed.
Task 5/6 assembler, route, data-plane, CMD, IM, SABA, and KSPORT regressions:
  9 suites / 188 tests passed.
Contracts typecheck: passed.
Contracts build: passed.
API typecheck: passed.
API build: passed.
Chrome extension compatibility typecheck: passed.
git diff --check: passed.
Scoped secret/raw-provider-body hygiene scan: no matches.
```

## Files changed

- `packages/contracts/src/chrome-bridge.ts`
- `packages/contracts/src/chrome-bridge.test.ts`
- `apps/api/src/chrome-bridge/network-body-assembler.ts`
- `apps/api/src/chrome-bridge/network-body-assembler.test.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.ts`
- `.superpowers/sdd/2026-08-23-six-provider-realtime-feed-recovery/task-6a-1-report.md`

The one adapter edit is compile-only fallout from widening the contract's partition union: the IM delta path now explicitly narrows to `IM_MARKET_1 | IM_MARKET_2`, preserving its prior runtime behavior and rejecting KSPORT metadata.

## Migration and hygiene

Existing non-recovery requests remain valid. Producers that emit any KSPORT recovery metadata must migrate atomically to all three fields. Consumers that inspect the widened `providerPartition` type must narrow to their provider-specific values before use.

No cookie, signed URL, authorization material, credential, raw provider response body, or secret-bearing request metadata was added. No coordinator, provider adapter behavior, observer behavior, browser/runtime process, navigation, reload, or external system was changed.

Commit subject: `fix(bridge): bind provider recovery evidence`.
