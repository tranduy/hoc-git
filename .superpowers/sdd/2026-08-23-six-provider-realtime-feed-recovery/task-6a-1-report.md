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

---

## Fix Round 1 (review of `50b6b5af`)

This section supersedes the original report's statements that quarantine/fault
state expires after 30 seconds or is compacted at provider-account scope.

### Corrected invariants

- The 30-second TTL releases incomplete fragments and their byte/body budget,
  but latches one exact source/epoch assembly fault. The same epoch remains
  inadmissible after any number of TTL intervals. Only `resetSource`, lane
  disposal, or a strictly newer canonical epoch in the same lineage clears it.
- Mismatch, expiry, and overflow affect only the exact source/epoch. They do
  not block or delete another source, including another source mapped to the
  same SBOBET account.
- Multipart ownership is keyed by the full `(sourceId, sourceEpoch,
  snapshotId)` tuple. Identical snapshot IDs from BTI, IM, or any other
  independent sources coexist without collision, while every envelope
  authority, security, request, clock, transport, and document field remains
  symmetrically bound across chunks.
- Every active and candidate data-plane lane shares one
  `NetworkBodyAssemblyBudget`. The application-wide cap is therefore exactly
  48 bodies / 144 MiB, while each assembler retains the 8 bodies / 24 MiB per
  source limits. Completion, fault, reset, candidate replacement, promotion,
  and idempotent disposal release accounting exactly once.
- A complete KSPORT recovery metadata triple is accepted only with lobby
  `KSPORT`; IM, BTI, TSPORT, SABA, CMD, and SBO reject it. Absence of all three
  fields remains backward compatible.

### Strict RED record

```text
Contract lobby binding: 1 failed / 14 passed.
  Non-KSPORT lobbies accepted the complete KSPORT recovery triple.

Assembler ownership/fault probes: 4 failed / 24 passed.
  Same snapshot IDs collided across independent sources.
  An SBOBET sibling source was evicted/blocked by another source's overflow.
  Custom-TTL and default-30s probes re-admitted a faulted old epoch.

Shared-budget export probe: 1 failed / 26 passed.
  NetworkBodyAssemblyBudget did not exist.

Data-plane injection probe: 1 failed / 38 passed.
  Active and candidate lanes did not charge the injected shared budget.
```

The TTL regression uses chunk 0 at `t=0`, chunk 1 at `t=101`, and repeats the
old epoch at `t=202`; it never completes. A strictly newer epoch and explicit
source reset both recover. Aggregate probes span multiple assemblers and prove
the exact 48-body / 144-MiB ceiling plus independent and idempotent cleanup.

### Fix Round 1 verification

```text
Focused contract suite: 15 passed.
Focused assembler/data-plane suites: 2 suites / 66 tests passed.
Whole contracts package: 2 suites / 96 tests passed.
Task 5/6 assembler, route, data-plane, CMD, IM, SABA, and KSPORT regressions:
  9 suites / 189 tests passed.
Contracts typecheck and build: passed.
API typecheck and build: passed.
Chrome extension compatibility typecheck and build: passed.
git diff --check: passed.
Scoped secret/raw-provider-body hygiene scan: no matches.
```

### Fix Round 1 files

- `packages/contracts/src/chrome-bridge.ts`
- `packages/contracts/src/chrome-bridge.test.ts`
- `apps/api/src/chrome-bridge/network-body-assembler.ts`
- `apps/api/src/chrome-bridge/network-body-assembler.test.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- `.superpowers/sdd/2026-08-23-six-provider-realtime-feed-recovery/task-6a-1-report.md`

No coordinator, provider adapter, observer, browser/runtime process, navigation,
reload, or external system behavior was changed in this fix round.
