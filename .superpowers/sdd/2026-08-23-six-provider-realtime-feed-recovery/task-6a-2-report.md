# Task 6A.1B + Task 6A.2: Request/Lane Identity and Atomic Provider Authority — DONE

## Design checkpoint

The Task 6A.1 breaker required request identity to be closed at the same
boundary that owns immutable authority lanes, so Task 6A.1B and Task 6A.2 were
implemented as one transaction.

- `ProviderAuthorityCoordinator` is the sole owner of six fixed Football
  account slots: CMD, IM, SABA, SBOBET, APSPORT, and BTI. KSPORT and legacy SBO
  map to the same SBOBET account.
- An exact authority identity is
  `{ accountId, sourceId, sourceEpoch, connectionGeneration }`. Each slot owns
  at most one active identity and one candidate identity. Candidate tokens and
  lane tokens use coordinator-local monotonically increasing nonces; tokens are
  frozen and promotion compare-and-swaps by exact token object identity.
- `observe(identity, evidenceClass)` can retain ACTIVE, retain/create/replace
  CANDIDATE, or reject. Replay always rejects as diagnostic-only. Transport
  ACK, TAB/OPEN/heartbeat, partial bodies, and non-catalog data can bootstrap a
  bounded candidate but cannot replace active ownership.
- `promote(token, proof, transact)` stages the candidate as active, invokes the
  synchronous lane/feed/catalog/coverage transaction, rolls back authority if
  that transaction rejects, and notifies routing/lifecycle observers only
  after the transaction commits. Publishing happens after `promote` returns.
- Control routing is coordinator-gated: normal snapshots, reload, navigation,
  focus, and probes address only active authority. A candidate snapshot is an
  explicit token-addressed bootstrap command.
- Each candidate/active decode pipeline owns its router, coverage guard, and
  lane-bound multipart assembler. Candidate replacement, candidate release,
  active transport release, and promotion synchronously dispose affected
  pending bodies and shared-budget reservations.

The compatibility proof prepared by the current Task 1–6 adapters remains
deliberately limited to the existing complete baseline signals. Strict
provider content proof, SABA characterization, and KSPORT cross-transport
ordering remain Tasks 6A.3+ and were not implemented here.

## Exact request and multipart closure

- Every HTTP envelope now requires a sanitized exact uppercase HTTP `method`
  and public `observerRequestId` in the contract.
- `NetworkObserver` allocates a safe-integer request ordinal synchronously at
  CDP `Network.requestWillBeSent` or at direct/generated request entry, before
  any await or concurrent emission. Stored/replayed responses retain method,
  request ID, and ordinal. Multipart snapshot IDs are ordinal-derived rather
  than clock/bridge-sequence-derived.
- Multipart keys bind source, exact source epoch, observer request identity,
  and snapshot identity. Interleaved large same-clock responses therefore
  assemble independently.
- A schema-marked chunk wrapper missing required fields or exceeding fragment
  bounds faults the exact admitted source epoch and never reaches provider
  adapters as JSON.
- New source-lineage state is committed only after shared-budget reservation.
  Global pressure therefore neither inserts nor consumes an unseen lineage
  slot. Local bound failure still records the exact fail-closed epoch fence.
- Promotion completes the proof-triggering body before CAS, then rotates the
  candidate assembler inside the promotion transaction. No unrelated pending
  body from that candidate lane survives as active multipart state.

## Strict RED record

```text
Contracts HTTP identity: 1 failed / 15 passed (16 total).
Observer concurrent request identity: 1 failed / 139 passed (140 total).
Assembler request/wrapper/budget closure: 3 failed / 42 passed (45 total).
Assembler immutable lane binding: 1 failed / 45 passed (46 total).
Coordinator: 1 failed suite / 0 collected tests (missing module).
Data-plane authority integration: 2 failed / 39 passed (41 total).
Control-plane active/candidate routing: 1 failed / 16 passed (17 total).
```

The retained RED probes cover distinct concurrent observer IDs/snapshot IDs,
interleaved assembly, malformed and oversize wrapper quarantine, non-mutating
budget denial, frozen lane tokens, complete-body promotion rotation, replay and
transport candidate isolation, exact CAS, rollback ordering, active-only
control, 1,000 candidate turnovers, silent-old-socket fencing, late-close
identity guards, KSPORT/SBO account sharing, and other-five-account invariance.

## GREEN and regression matrix

```text
Focused coordinator/registry/control/route/data-plane/assembler:
  6 suites / 143 tests passed.
Focused server composition: 1 suite / 7 tests passed.
Whole contracts package: 2 suites / 97 tests passed.
Whole Chrome extension package: 32 suites / 359 tests passed
  (network observer: 140 tests passed).
Task 5/6 assembler, route, data-plane, CMD, IM, SABA, and KSPORT regressions:
  9 suites / 211 tests passed.
Whole API package: 144 suites passed; 1,101 of 1,103 tests passed.
Contracts, API, and extension typechecks: passed.
Contracts, API, and extension builds: passed.
git diff --cached --check: passed.
Scoped added-production-line credential/raw-provider-body scan: no matches.
```

The whole API package has only the two previously documented Windows-host
assertions in untouched files: `local-app-data.test.ts` expects POSIX
separators for a Darwin fixture path, and `local-key-protector.test.ts` expects
a POSIX `0600` mode from Windows `stat`. All changed and required API suites
pass.

## Files changed

- `packages/contracts/src/chrome-bridge.ts`
- `packages/contracts/src/chrome-bridge.test.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/chrome-extension/src/network-observer.test.ts`
- `apps/api/src/chrome-bridge/provider-authority-types.ts`
- `apps/api/src/chrome-bridge/provider-authority-coordinator.ts`
- `apps/api/src/chrome-bridge/provider-authority-coordinator.test.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-account.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-registry.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-registry.test.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-control-plane.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-control-plane.test.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-route.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-route.test.ts`
- `apps/api/src/chrome-bridge/network-body-assembler.ts`
- `apps/api/src/chrome-bridge/network-body-assembler.test.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- `apps/api/src/server.ts`
- `.superpowers/sdd/2026-08-23-six-provider-realtime-feed-recovery/task-6a-2-report.md`

No provider schema was guessed, no credential or raw provider payload was
persisted or logged, and no browser/runtime process, navigation, reload,
provider action, or external side effect was introduced.

---

## Fix Round 1

Status: DONE

Review base: `3393ecd12c5049e6c9005742394a5f4874475e46`

### Boundary corrections

- A non-authoritative candidate, including CMD DOM snapshots and completed DOM
  sweeps, now stops after its candidate-local assembler/router/adapter work. It
  cannot call the shared feed registry, commit shared coverage/catalog state,
  publish, or establish source ownership. The exact CMD source 9 DOM -> source
  10 HTTP replacement path proves that a later bound network candidate can
  still promote normally.
- `releaseTab` advances a monotonic tab lifetime before cleanup, retires every
  source generation associated with the tab, and clears pending requests,
  request identity/function/partition/stream maps, sockets, execution-context
  ownership, and durable replay state. Pending and queued async work checks both
  source and tab lifetime before and after awaits and immediately before
  forwarding. Both response events arriving after release and an already
  awaiting `Network.getResponseBody` completion emit nothing.
- HTTP requests carry the all-or-none public pair `requestFrameKey` and
  `requestDocumentKey`. CDP frame/loader/session values are bounded internally,
  converted to opaque keys, and never forwarded. The loader is re-read from
  `Page.getFrameTree` before authority emission and before each multipart
  forward. Generated BTI, IM, and KSPORT requests bind the evaluated frame and
  verified current document. Unverified direct/generated large bodies are not
  chunked; unverified small bodies remain diagnostic-only and the API rejects
  them before routing. Multipart identity and keys include both public
  provenance fields, so different frames/documents cannot combine.
- Provider-feed promotion is now a synchronous account transaction. Feed
  controller preflight restores a complete checkpoint, subscriber delivery is
  suppressed during invalidation and baseline commit, and one final snapshot is
  flushed only after coordinator CAS, catalog, basis, coverage, lane pipeline,
  registry role, and control target all point to the winner. The route attaches
  candidate control ownership before data-plane delivery, which also closes the
  one-envelope HTTP promotion case. Publishing remains outside the transaction
  and occurs only after successful flush.
- All fallible promotion checks and time capture occur before the no-throw
  pointer swap. Defensive rollback checkpoints cover feed controller state,
  coverage, catalog/basis maps, active/candidate pipeline maps, last-envelope
  ownership, coordinator identity, registry role, and control target. Fault
  injection after the pointer swap restores active A and leaves candidate B
  isolated and reusable; a later strictly newer B baseline promotes.
- Maintenance replacement accounting accepts only `authorityDisposition ===
  "ACTIVE"`. Server composition supplies `listActiveSources()`, while the
  refresh function independently filters both its initial and current source
  sets. Six fresh candidate-only tabs cannot satisfy replacement or stability;
  six promoted active replacements do.

No Task 6A.3 content-proof, SABA characterization, or KSPORT ordering behavior
was implemented.

### RED evidence

The first focused RED run recorded 11 failures with 270 passing tests:

```text
Contracts: 1 failure in 17 tests.
API data-plane/registry/assembler/catalog refresh: 7 failures in 120 tests.
Extension observer: 3 failures in 143 tests.
```

The one-envelope control-target refinement then failed its isolated probe once
(`controlRequests: 0`, expected `1`) before the registry pre-delivery handoff.
All probes were retained as regressions.

### GREEN and verification matrix

```text
Focused coordinator/registry/feed/control/route/data-plane/assembler/coverage/refresh/server:
  11 suites / 205 tests passed.
Task 5/6 API regressions:
  9 suites / 177 tests passed.
Task 5/6 extension regressions:
  6 suites / 200 tests passed.
Contracts chrome-bridge:
  1 suite / 17 tests passed.
Whole contracts package:
  2 suites / 98 tests passed.
Whole Chrome extension package:
  32 suites / 363 tests passed (network observer: 144 tests passed).
Whole API package:
  144 suites passed; 1,111 of 1,113 tests passed.
Contracts, API, and extension typechecks: passed.
Contracts, API, and extension builds: passed.
```

The whole API package has only the two previously documented Windows-host
assertions in untouched files: `local-app-data.test.ts` expects POSIX separators
for a Darwin fixture path, and `local-key-protector.test.ts` expects POSIX
`0600` mode from Windows `stat`. Every changed and required API suite passes.

### Files changed in Fix Round 1

- `packages/contracts/src/chrome-bridge.ts`
- `packages/contracts/src/chrome-bridge.test.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/chrome-extension/src/network-observer.test.ts`
- `apps/api/src/chrome-bridge/network-body-assembler.ts`
- `apps/api/src/chrome-bridge/network-body-assembler.test.ts`
- `apps/api/src/chrome-bridge/provider-feed-controller.ts`
- `apps/api/src/chrome-bridge/provider-feed-registry.ts`
- `apps/api/src/chrome-bridge/provider-feed-registry.test.ts`
- `apps/api/src/catalog/catalog-coverage-guard.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-registry.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-control-plane.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-route.ts`
- `apps/api/src/catalog-refresh.ts`
- `apps/api/src/catalog-refresh.test.ts`
- `apps/api/src/server.ts`
- `.superpowers/sdd/2026-08-23-six-provider-realtime-feed-recovery/task-6a-2-report.md`

No provider schema was guessed, no raw provider response or credential was
added, and no navigation, reload, browser/runtime action, or external side
effect was performed.

Commit subject: `fix(feed): close authority promotion races`.
