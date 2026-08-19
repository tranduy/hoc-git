# Provider-Coherent Realtime Odds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all six football catalogs update through provider-coherent state while preventing retained, replayed, disconnected, or incomplete data from appearing newly realtime.

**Architecture:** Extend the Chrome bridge with safe source/stream lifecycle metadata, materialize each provider according to its real baseline/delta/partial semantics, and publish semantic revisions separately from freshness renewals. Preserve the existing revision WebSocket, changed-account ETag read, and comparison Worker.

**Tech Stack:** TypeScript 5.9, Chrome Debugger/CDP, Zod 3, Fastify 5, React 19, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-08-19-provider-coherent-realtime-odds-design.md`

## Global Constraints

- Price correctness and source-generation validity take priority over coverage.
- Do not reload a healthy provider page to obtain ordinary price updates.
- Do not poll full catalogs from the web UI; retain revision WebSocket plus changed-account ETag reads.
- Do not renew one event or partition with another event's observation clock.
- Unchanged semantic content renews freshness without a revision broadcast.
- Never log or persist credentials, headers, query strings, cookies, tokens, or unredacted provider payloads.
- Existing untracked screenshots remain untouched.

---

### Task 1: Semantic revision and freshness renewal

**Files:**
- Modify: `apps/api/src/catalog/catalog-revision-store.ts`
- Modify: `apps/api/src/catalog/catalog-revision-store.test.ts`

**Interfaces:**
- Produces: semantic `revisionFor(catalog, snapshotState)` behavior that excludes observation clocks and transport sequence.
- Produces: `publish(...)` freshness renewal without listener notification when semantic content is unchanged.

- [ ] **Step 1: Write the failing behavior test**

Add two catalogs with identical events/markets/prices/statuses but different `observedAtMs`, `receivedMonotonicMs`, and `sequence`. Assert the second publication keeps the same revision and store sequence, updates the stored observation metadata, extends `freshUntilMs`, and does not notify the listener a second time:

```ts
const first = store.publish(accountId, catalogAt(100, 10, 1),
  { snapshotState: "FRESH", freshnessMs: 20 });
now = 110;
const renewed = store.publish(accountId, catalogAt(110, 20, 2),
  { snapshotState: "FRESH", freshnessMs: 20 });
expect(renewed.revision).toBe(first.revision);
expect(renewed.sequence).toBe(first.sequence);
expect(renewed.catalog.observedAtMs).toBe(110);
expect(renewed.freshUntilMs).toBe(130);
expect(seen).toHaveLength(1);
```

- [ ] **Step 2: Run `npm.cmd test --workspace @tool-chenh/api -- --run src/catalog/catalog-revision-store.test.ts` and verify RED because volatile clocks currently change the hash**

- [ ] **Step 3: Implement semantic projection and silent renewal**

Hash this literal projection with SHA-256:

```ts
{
  dataMode, accountId, provider, category, comparisonState,
  rejectedMarketCount, events, markets,
  quotes: quotes.map(({ receivedMonotonicMs: _received, sequence: _sequence,
    sourceTimestampMs: _sourceTime, ...quote }) => quote),
  snapshotState
}
```

When the semantic revision matches, replace the stored catalog and observation
metadata, renew `freshUntilMs`, reschedule expiry, retain sequence/revision, and
do not invoke listeners.

- [ ] **Step 4: Run the focused test and API typecheck; verify GREEN**

- [ ] **Step 5: Commit `fix(realtime): separate semantic revisions from freshness`**

### Task 2: Safe source, socket, partition, and replay identity

**Files:**
- Modify: `packages/contracts/src/chrome-bridge.ts`
- Modify: `packages/contracts/src/chrome-bridge.test.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/chrome-extension/src/network-observer.test.ts`
- Modify: `apps/chrome-extension/src/redactor.test.ts`

**Interfaces:**
- Produces: optional backward-compatible envelope field `sourceEpoch`.
- Produces: optional request fields `streamId`, `providerPartition`, and `replayed`.
- Produces: `WS_STATE` transport with body exactly `{"state":"OPEN"}` or `{"state":"CLOSED"}`.

- [ ] **Step 1: Write failing strict-contract tests**

Assert safe epoch/stream/partition metadata and `WS_STATE` are accepted, while
query material, unknown partition values, oversized identifiers, and secret
extras are rejected. Allowed provider partitions are `IM_MARKET_1` and
`IM_MARKET_2`.

- [ ] **Step 2: Run the contracts test and verify RED**

- [ ] **Step 3: Add contract schemas and types with bounded credential-free identifiers**

Use `/^[a-z0-9._:-]+$/iu`, length 1-128, and strict optional request fields.

- [ ] **Step 4: Write failing observer tests**

Prove that:

```ts
expect(open.request.streamId).toBe("1");
expect(open.transport).toBe("WS_STATE");
expect(frame.request.streamId).toBe("1");
expect(close.payload.body).toBe('{"state":"CLOSED"}');
expect(imResponse.request.providerPartition).toBe("IM_MARKET_2");
expect(replay.request.replayed).toBe(true);
expect(replay.observedAtMs).toBe(original.observedAtMs);
```

The IM partition test supplies `Network.requestWillBeSent.request.postData` with
a complete JSON body containing `Market: 2`; only that enum is retained.

- [ ] **Step 5: Implement observer metadata and original-clock replay**

Assign a local monotonically increasing stream ID on `webSocketCreated`. Emit
open before frames and closed before removing the socket. Track safe IM request
partition by CDP request key. Store original wall and monotonic clocks in replay
records and pass explicit clock overrides to `#emit`.

- [ ] **Step 6: Run extension/contracts focused tests and typechecks; verify GREEN**

- [ ] **Step 7: Commit `feat(chrome): expose safe provider stream lifecycle`**

### Task 3: Fail-closed epoch and stream invalidation

**Files:**
- Modify: `apps/api/src/chrome-bridge/adapter.ts`
- Modify: `apps/api/src/chrome-bridge/adapter-router.ts`
- Modify: `apps/api/src/catalog/catalog-coverage-guard.ts`
- Modify: `apps/api/src/catalog/catalog-coverage-guard.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Produces: `ChromeTrafficAdapter.resetSource(sourceId)` optional lifecycle hook.
- Produces: decoded invalidation `{ sourceId, sequence, observedAtMs, invalidateAccountId, reason }`.
- Produces: data-plane publication callback `(catalog, snapshotState)`.

- [ ] **Step 1: Write failing data-plane tests**

Prove a changed `sourceEpoch` resets adapter/coverage state before the next
catalog, an invalidation immediately publishes `STALE`, and a partial catalog
cannot let heartbeat transport freshness promote stale provider data.

- [ ] **Step 2: Run focused tests and verify RED**

- [ ] **Step 3: Implement reset/invalidation plumbing**

Track the last epoch per `sourceId`; on change call router, coverage, body
assembler, and adapter reset hooks. Extend `CatalogCoverageGuard` with
`reset(sourceKey)`. The server forwards `FRESH` and `STALE` publications to the
existing revision store without changing the web contract.

- [ ] **Step 4: Run focused tests and API typecheck; verify GREEN**

- [ ] **Step 5: Commit `fix(catalog): invalidate disconnected source generations`**

### Task 4: Preserve per-event clocks for CMD, SABA, SBOBET, and APSPORT

**Files:**
- Create: `apps/api/src/chrome-bridge/catalog-part-merge.ts`
- Create: `apps/api/src/chrome-bridge/catalog-part-merge.test.ts`
- Modify: `apps/api/src/chrome-bridge/cmd-dom-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/cmd-dom-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts`

**Interfaces:**
- Produces: `mergeCatalogParts(parts, catalogHeader)` with deterministic last-part-wins identity and original quote clocks.
- Produces: provider adapters scoped to source/stream generation.

- [ ] **Step 1: Write failing merge and adapter tests**

The tests update event B after event A and assert A retains its literal original
`receivedMonotonicMs` and `sequence`. Separate tests prove CMD records outside
the observation window disappear instead of receiving B's clock, SABA does not
publish a new stream until `reset ... done`, SABA gap invalidates, socket close
invalidates, APSPORT DOM cannot erase a richer WS event, and KSPORT untouched
events cannot survive the bounded executable retention window.

- [ ] **Step 2: Run focused tests and verify RED for false re-stamping/lifecycle behavior**

- [ ] **Step 3: Implement catalog-part merge and provider state machines**

Normalize each CMD/KSPORT/APSPORT event with its own stored wall clock,
monotonic clock, and sequence before merging. Keep SABA decoder/parts keyed by
source epoch and stream. Keep APSPORT DOM and WS maps separate with WS winning
identity conflicts. Reduce unproven KSPORT executable retention to a bounded
15-second observation window until reset/delete protocol evidence exists.

- [ ] **Step 4: Run focused adapter tests and API typecheck; verify GREEN**

- [ ] **Step 5: Commit `fix(providers): preserve event clocks and socket generations`**

### Task 5: Authoritative IM partition replacement

**Files:**
- Modify: `apps/api/src/chrome-bridge/im-http-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- Modify: `apps/api/src/providers/im/im-football-catalog-source.ts`
- Modify: `apps/api/src/providers/im/im-football-catalog-source.test.ts`
- Modify: `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- Modify: `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`

**Interfaces:**
- Produces: per-source `Map<IM_MARKET_1 | IM_MARKET_2, PartitionState>`.
- Produces: a completed two-partition baseline cycle and native delta updates.

- [ ] **Step 1: Write failing IM tests**

Prove a later `GetSE` replaces only its named partition, absence removes an
event from that partition, the other current partition remains, a delta cannot
publish before any baseline, and an unknown-event delta requests recovery
without mutating accepted state.

- [ ] **Step 2: Run focused tests and verify RED against additive union behavior**

- [ ] **Step 3: Implement partition replacement and bounded baseline cadence**

Require `providerPartition` on forced baselines; retain compatibility for a
native unlabelled baseline as `IM_NATIVE`. Publish the union of current
partitions, preserve per-partition clocks, and run IM maintenance every 15
seconds single-flight while leaving deltas event-driven.

- [ ] **Step 4: Run focused tests and extension/API typechecks; verify GREEN**

- [ ] **Step 5: Commit `fix(im): replace authoritative catalog partitions`**

### Task 6: BTI independent detail freshness and bounded refresh

**Files:**
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/chrome-extension/src/network-observer.test.ts`
- Modify: `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- Modify: `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`
- Modify: `apps/api/src/chrome-bridge/bti-http-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/bti-http-adapter.test.ts`

**Interfaces:**
- Produces: independent list/detail clocks and a detail executable SLA of 10 seconds.
- Produces: bounded least-recently-visited detail batches of 12 every two seconds, single-flight.

- [ ] **Step 1: Write failing BTI tests**

Prove a new list response cannot renew an old detail quote, a detail older than
10 seconds is removed before merge, empty detail removes the event partition,
the least-recently-visited scheduler does not starve reordered events, and no
refresh overlaps the prior one.

- [ ] **Step 2: Run focused tests and verify RED against the current 60-second detail TTL and five-second/six-event scheduler**

- [ ] **Step 3: Implement bounded detail freshness and scheduling**

Set detail TTL to 10 seconds, select 12 least-recently-visited event IDs per
cycle, run refresh every two seconds, and keep one in-flight refresh per tab.
Continue four list reads for discovery. Do not add tab reloads.

- [ ] **Step 4: Run focused tests and extension/API typechecks; verify GREEN**

- [ ] **Step 5: Commit `fix(bti): bound hidden detail freshness`**

### Task 7: Verification, live capture evidence, performance measurement, and deploy

**Files:**
- Modify only files required by a freshly reproduced failing test or measured acceptance failure.

**Interfaces:**
- Produces: tested build and a live six-source evidence report on branch `khach_hang`.

- [ ] **Step 1: Run complete static and automated verification**

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration
npm.cmd run build
git diff --check
```

- [ ] **Step 2: Restart the managed local stack from the verified build with bounded sanitized capture enabled**

Use the repository's managed start/stop scripts. Confirm all six configured
sources recover after reset and no extra manual provider process is required.

- [ ] **Step 3: Measure a fixed live observation window**

Record per source: event/market/quote counts, semantic revisions per minute,
catalog GETs per changed source, quote clock spread, stale transitions,
provider-frame-to-publication latency where available, API process memory/CPU,
Chrome process count/memory, and web render responsiveness. Do not print payload
bodies or credentials.

- [ ] **Step 4: Apply TDD fixes for any measured acceptance failure, then rerun the complete verification command**

- [ ] **Step 5: Review the final diff against every spec acceptance criterion and commit the verified implementation**
