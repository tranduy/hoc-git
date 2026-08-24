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

---

## Fix Round 2 (review of `214fb0b`)

This section supersedes Fix Round 1's statement that explicit source reset
clears an assembly fault. Reset releases fragments and reservations, but does
not erase the lane's retirement evidence.

### Corrected lineage and pressure invariants

- Each source owned by an assembler retains one compact epoch fence. A
  canonical epoch is parsed at the last colon into observer session identity
  and a canonical nonnegative safe generation. The fence stores only that
  session, its maximum admitted/faulted generation, and the current fault bit.
- A higher generation in the same observer session retires every lower
  generation permanently. Expiry, mismatch, local overflow, or `resetSource`
  retires the current generation. Neither reset nor later advancement can
  re-admit a retired generation.
- An absent epoch is one tagged legacy lineage. Once faulted or reset it cannot
  reopen within that assembler. An arbitrary chunk cannot replace an installed
  observer session; a genuine session replacement receives a fresh data-plane
  lane/assembler, and disposal clears the retired instance.
- Shared body/byte budget denial is non-mutating backpressure. It neither
  faults the source epoch nor removes an already-reserved body. The exact
  2-body/3-byte contention probe preserves both pending reservations; after
  the aggressor completes and releases capacity, the victim retries its denied
  fragment and completes. A new body denied by global count pressure can start
  after capacity is released.
- Local schema, identity, per-body, 8-body/24-MiB per-source failures still
  fault the exact current source epoch. The shared 48-body/144-MiB application
  cap, cross-provider isolation, and KSPORT metadata binding remain unchanged.

### Strict RED record

```text
network-body-assembler.test.ts: 5 failed / 27 passed (32 total).

Three lineage probes demonstrated that:
  a retired generation reopened after advancing and then resetting;
  the maximum of two expired generations was forgotten;
  legacy reset and arbitrary observer-session replacement were re-admitted.

Two shared-pressure probes demonstrated that:
  byte pressure deleted and faulted an existing victim body;
  body-count pressure permanently faulted a source before it allocated a body.
```

Each failure was an assertion on real completion, pending accounting, or fault
state and failed directly because of the reviewed behavior.

### Fix Round 2 verification

```text
Focused assembler GREEN: 32 passed.
Focused contracts/assembler/data-plane: 3 suites / 86 tests passed.
Whole contracts package: 2 suites / 96 tests passed.
Task 5/6 assembler, route, data-plane, CMD, IM, SABA, and KSPORT regressions:
  9 suites / 194 tests passed.
Contracts typecheck and build: passed.
API typecheck and build: passed.
Chrome extension compatibility typecheck and build: passed.
git diff/show --check: passed.
Scoped added-production-line secret/raw-body hygiene scan: no matches.
```

### Fix Round 2 files

- `apps/api/src/chrome-bridge/network-body-assembler.ts`
- `apps/api/src/chrome-bridge/network-body-assembler.test.ts`
- `.superpowers/sdd/2026-08-23-six-provider-realtime-feed-recovery/task-6a-1-report.md`

No contract, data-plane, coordinator, adapter, observer, browser/runtime
process, navigation, reload, or external system behavior was changed in this
fix round.
