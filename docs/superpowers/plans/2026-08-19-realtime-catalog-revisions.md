# Realtime Catalog Revisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the football page's 250 ms all-source catalog polling with catalog revision invalidations, changed-account reads, and off-main-thread comparison.

**Architecture:** A bounded API `CatalogRevisionStore` becomes the coherent read model for accepted catalogs and publishes small revision messages through the existing WebSocket. The frontend reconciles only selected changed accounts, uses a one-second ETag fallback while disconnected, and sends catalog updates to a module worker that returns compact comparison projections.

**Tech Stack:** TypeScript 5.9, Fastify 5, `@fastify/websocket`, Zod 3, React 19, Vite 8 Web Workers, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-08-19-realtime-catalog-revisions-design.md`

## Global Constraints

- Do not change event matching, market eligibility, ranking, alert, movement, or preflight semantics.
- Reuse `/api/realtime`; do not open a second WebSocket and do not send catalog bodies over WebSocket.
- Connected and unchanged means zero catalog GETs; disconnected fallback is exactly 1,000 ms.
- A normal invalidation fetches only the selected account that changed.
- Stale/restored data stays display-only and cannot generate executable signals.
- Ignore older HTTP responses, WebSocket sequences, and worker generations.
- Preserve existing strict schema validation, origin checks, payload bounds, and shutdown cleanup.

---

### Task 1: Realtime catalog contracts

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Modify: `packages/contracts/src/schemas.test.ts`

**Interfaces:**
- Produces: `CatalogRevisionEntry`, `CATALOG_REVISION_BASELINE`, and `CATALOG_REVISION` members in `RealtimeMessage` and `RealtimeMessageSchema`.

- [ ] **Step 1: Write failing strict-schema tests**

Add literal valid baseline and update fixtures, then prove negative sequence values, empty revisions, invalid timestamps, and extra fields fail:

```ts
expect(RealtimeMessageSchema.safeParse({
  type: "CATALOG_REVISION", sequence: 2,
  accountId: "catalog-source:SABA:FOOTBALL", revision: "SABA-100-FRESH",
  observedAtMs: 100, snapshotState: "FRESH"
}).success).toBe(true);
expect(RealtimeMessageSchema.safeParse({
  type: "CATALOG_REVISION", sequence: -1,
  accountId: "catalog-source:SABA:FOOTBALL", revision: "", observedAtMs: -1,
  snapshotState: "FRESH", secret: "must-not-pass"
}).success).toBe(false);
```

- [ ] **Step 2: Run `npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts` and verify RED because the new discriminator values are absent**

- [ ] **Step 3: Add the domain members and strict Zod branches**

Use non-negative safe integer sequences/timestamps, trimmed account IDs of 1-128 characters, trimmed revisions of 1-256 characters, and the exact `FRESH | STALE` enum.

- [ ] **Step 4: Run the contracts test and typecheck; verify GREEN**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts
npm.cmd run typecheck --workspace @tool-chenh/contracts
```

### Task 2: Authoritative revision store

**Files:**
- Create: `apps/api/src/catalog/catalog-revision-store.ts`
- Create: `apps/api/src/catalog/catalog-revision-store.test.ts`

**Interfaces:**
- Produces: `CatalogRevisionStore.publish(accountId, catalog, { snapshotState, freshnessMs })`, `get(accountId)`, `baseline()`, `subscribe(listener)`, and `close()`.
- Produces: immutable entries containing `accountId`, `catalog`, `revision`, `observedAtMs`, `snapshotState`, and `sequence`.

- [ ] **Step 1: Write failing behavior tests**

Tests use fake time and literal catalogs to prove:

```ts
const store = new CatalogRevisionStore({ now: () => now });
const seen: CatalogRevisionEntry[] = [];
store.subscribe((entry) => seen.push(entry));
store.publish(accountId, catalogAt(100), { snapshotState: "FRESH", freshnessMs: 20 });
expect(store.get(accountId)?.snapshotState).toBe("FRESH");
now = 121;
store.expire();
expect(store.get(accountId)?.snapshotState).toBe("STALE");
expect(seen.map((entry) => entry.snapshotState)).toEqual(["FRESH", "STALE"]);
```

Separate tests reject older observations, deduplicate exact publications, retain only one full catalog per account, return a sorted baseline, and stop timers/subscribers on close.

- [ ] **Step 2: Run the store test and verify RED because the module is absent**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/catalog/catalog-revision-store.test.ts`

- [ ] **Step 3: Implement the minimal bounded store**

Use a `Map<string, StoredCatalogRevision>`, a global safe integer sequence, a stable SHA-256 digest over the accepted catalog plus snapshot state, and one unref'd expiry timer scheduled for the nearest fresh deadline. `expire()` remains public because it is meaningful production behavior for deterministic scheduler integration, not a test-only cleanup method.

- [ ] **Step 4: Run store tests and API typecheck; verify GREEN**

### Task 3: API publication, coherent GET, and WebSocket delivery

**Files:**
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- Modify: `apps/api/src/routes/catalog.ts`
- Modify: `apps/api/src/routes/catalog.test.ts`
- Modify: `apps/api/src/realtime/opportunity-ws.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `CatalogRevisionStore` from Task 2.
- Produces: Chrome accepted snapshots and successful reader snapshots publish into the store; catalog GET returns the same store snapshot and revision header; `/api/realtime` sends baseline and incremental revisions.

- [ ] **Step 1: Add failing API tests**

Add tests proving:

```ts
expect(initialMessages.some((message) =>
  message.type === "CATALOG_REVISION_BASELINE")).toBe(true);
expect(update).toMatchObject({
  type: "CATALOG_REVISION", accountId, revision: expect.any(String)
});
expect(catalogResponse.headers["x-catalog-revision"]).toBe(update.revision);
```

The route race test publishes a newer Chrome/store snapshot inside the old coalescing window and asserts the next GET returns that newer body rather than a 304 for the old ETag.

- [ ] **Step 2: Run the focused Chrome, catalog-route, and app tests; verify RED for missing wiring**

- [ ] **Step 3: Wire the store through `BuildAppOptions`, server composition, catalog routes, data plane publish callback, and realtime registration**

The catalog route checks the store first, publishes successful reads before replying, emits both `etag` and `x-catalog-revision`, and never lets its local coalescing cache override a newer store entry. The websocket subscribes once, sends a baseline on connection, filters incremental entries by client sequence, and unsubscribes/closes the store during application shutdown at the owning server layer.

- [ ] **Step 4: Run focused tests and API typecheck; verify GREEN**

### Task 4: Frontend revision-aware API and realtime feed

**Files:**
- Modify: `apps/web/src/api/catalog.ts`
- Modify: `apps/web/src/api/catalog.test.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/client.test.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx` if present, otherwise cover ownership through client/page tests.

**Interfaces:**
- Produces: `CatalogReadResult { catalog, revision }` from `CatalogApi.readRevision(accountId)` while preserving `read(accountId)` for existing consumers.
- Produces: realtime callbacks `onCatalogBaseline(entries, sequence)` and `onCatalogRevision(entry)` on the existing single client.

- [ ] **Step 1: Add failing catalog API tests**

Prove a 200 response exposes `x-catalog-revision`, a 304 reuses both cached catalog and revision, and an older response cannot replace a newer cached revision.

- [ ] **Step 2: Add failing realtime client tests**

Prove the client delivers baseline/update messages, ignores decreasing sequences after baseline, and still delivers legacy snapshots over the same socket.

- [ ] **Step 3: Run focused web tests; verify RED**

- [ ] **Step 4: Implement the minimal API/cache and single-socket callbacks, then make `App` always own the socket even when an initial application snapshot exists**

- [ ] **Step 5: Run focused tests and web typecheck; verify GREEN**

### Task 5: Catalog revision coordinator

**Files:**
- Create: `apps/web/src/catalog/catalog-revision-coordinator.ts`
- Create: `apps/web/src/catalog/catalog-revision-coordinator.test.ts`

**Interfaces:**
- Consumes: realtime entries, selected account IDs, connection state, and `CatalogApi.readRevision`.
- Produces: accepted changed-account catalogs through `onCatalog`, state transitions through `onStale`, and a lifecycle `start/stop` or equivalent explicit cleanup.

- [ ] **Step 1: Write failing fake-timer tests**

Tests prove one changed account causes exactly one real coordinator output, a 50 ms burst coalesces to the newest revision, a revision during an in-flight fetch causes one follow-up, unselected accounts wait, reconnect baseline reconciles missed entries, and disconnected state polls selected accounts every 1,000 ms only.

- [ ] **Step 2: Run coordinator test; verify RED because the module is absent**

- [ ] **Step 3: Implement coordinator state maps and cleanup**

Never assert only on spy invocation; assert accepted catalog/revision output and the absence of unchanged account outputs. Use injected timer/fetch boundaries only where real time or network would make the test nondeterministic.

- [ ] **Step 4: Run coordinator tests and web typecheck; verify GREEN**

### Task 6: Web Worker comparison projection

**Files:**
- Create: `apps/web/src/catalog/comparison-worker-protocol.ts`
- Create: `apps/web/src/catalog/comparison-worker-engine.ts`
- Create: `apps/web/src/catalog/comparison-worker-engine.test.ts`
- Create: `apps/web/src/catalog/comparison.worker.ts`
- Create: `apps/web/src/catalog/comparison-worker-client.ts`
- Create: `apps/web/src/catalog/comparison-worker-client.test.ts`

**Interfaces:**
- Produces: generation-tagged `RESET`, `UPSERT`, `SET_STALE`, and `REMOVE` commands.
- Produces: compact `displayEvents` and `freshEvents` projections without full catalog arrays.
- Produces: client hydration that reattaches catalog references from the page's account map and ignores stale generations.

- [ ] **Step 1: Write failing engine parity tests**

For hand-checked existing comparison fixtures, assert worker engine event keys, provider IDs, provider event IDs, rows, best margin, stale/display split, and absence of a `catalogs` field.

- [ ] **Step 2: Run engine tests; verify RED**

- [ ] **Step 3: Implement the pure worker engine around `buildComparisonEvents` and strip only the full catalog references from output**

- [ ] **Step 4: Write failing worker-client generation and restart tests**

Use a complete in-memory Worker-compatible fake to prove a generation older than the requested generation is ignored and a crash triggers exactly one reset before new executable output is accepted.

- [ ] **Step 5: Implement module-worker entry and client; run focused tests and verify GREEN**

### Task 7: Live page integration and polling removal

**Files:**
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/app.tsx`

**Interfaces:**
- Consumes: catalog revision feed, coordinator, and comparison worker client.
- Produces: existing page UI/signals/preflight from hydrated display/fresh comparison results.

- [ ] **Step 1: Add failing page tests**

Use fake timers and full catalog fixtures to prove connected idle time creates no repeat GETs, one revision fetches only its changed account, disconnected mode waits 1,000 ms between ETag reads, a newly selected source reconciles immediately, and worker-derived comparisons still render the same exact ticket.

- [ ] **Step 2: Run the focused page tests; verify RED against the 250 ms loop**

- [ ] **Step 3: Replace `catalogRefreshIntervalMs`, main-thread comparison calls, and load-time duplicate comparison with coordinator/worker outputs**

Keep source/account discovery, stale display, signal tracker, movement tracker, preflight, match detail catalog references, ranking, and scroll anchoring behavior unchanged.

- [ ] **Step 4: Run page tests and web typecheck; verify GREEN**

### Task 8: Full verification and operational smoke check

**Files:**
- Modify only files needed to fix a regression reproduced by a failing test.

**Interfaces:**
- Produces: a buildable, tested realtime catalog revision path on branch `khach_hang`.

- [ ] **Step 1: Run focused mutation checks**

Temporarily verify that removing per-account filtering, stale-generation filtering, or the disconnected/live polling branch breaks its named test; restore production code after each check.

- [ ] **Step 2: Run complete verification**

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

- [ ] **Step 3: Start the local stack using the repository's existing managed command, inspect `/api/realtime` and the football page, and confirm revision-to-changed-account behavior without exposing provider payloads**

- [ ] **Step 4: Review `git diff --check`, ensure temporary screenshots remain untracked, and commit implementation with focused messages**
