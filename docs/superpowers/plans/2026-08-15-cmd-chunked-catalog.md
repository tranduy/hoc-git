# CMD Chunked Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transport and atomically publish the complete CMD two-outcome football catalog without exceeding the per-message bridge limit.

**Architecture:** The extension extracts a full sanitized catalog, partitions it into bounded versioned chunks, and sends all chunks through the existing ordered bridge. A stateful API assembler validates and joins a complete snapshot before the existing CMD normalizer publishes it.

**Tech Stack:** TypeScript, Zod, Chrome Debugger API, Vitest, Fastify/WebSocket bridge.

## Global Constraints

- Read-only; never click or place a bet.
- Never read or transmit credentials, cookies, storage, headers, URLs, or form values.
- Include full-time Asian handicap and totals; exclude exact score and 1X2.
- Each message must remain below 256 KiB; target maximum is 240,000 bytes.
- Incomplete data must fail closed and must not replace the last complete catalog.

---

### Task 1: Strict chunk contract

**Files:**
- Modify: `packages/contracts/src/chrome-bridge.ts`
- Modify: `packages/contracts/src/chrome-bridge.test.ts`

**Interfaces:**
- Produces: `CmdSnapshotChunkSchema` and `CmdSnapshotChunk`.

- [ ] Write failing schema tests for valid chunks and invalid index/count/extra fields.
- [ ] Run `npm.cmd test --workspace @tool-chenh/contracts -- --run src/chrome-bridge.test.ts` and confirm RED.
- [ ] Add the strict version-2 chunk schema with `chunkCount <= 64` and `chunkIndex < chunkCount`.
- [ ] Rerun the focused contract test and confirm GREEN.

### Task 2: Complete extraction and bounded partitioning

**Files:**
- Modify: `apps/chrome-extension/src/cmd-dom-snapshot.ts`
- Create: `apps/chrome-extension/src/cmd-snapshot-chunker.ts`
- Create: `apps/chrome-extension/src/cmd-snapshot-chunker.test.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/chrome-extension/src/network-observer.test.ts`

**Interfaces:**
- Consumes: sanitized `CmdCatalogInputRecord[]` JSON from every CMD frame.
- Produces: `chunkCmdSnapshot(records, snapshotId, 240000): CmdSnapshotChunk[]`.

- [ ] Write failing tests proving 783 representative records survive partitioning and every serialized chunk is at most 240,000 bytes.
- [ ] Run the focused extension tests and confirm RED.
- [ ] Implement deterministic byte-bounded partitioning without truncation.
- [ ] Restore all AH and total lines in the legacy CMD extractor while leaving 1X2/exact score excluded.
- [ ] Send every chunk sequentially as `DOM_SNAPSHOT`; deduplicate an unchanged full observation.
- [ ] Rerun focused extension tests and confirm GREEN.

### Task 3: Atomic API assembly

**Files:**
- Create: `apps/api/src/chrome-bridge/cmd-snapshot-assembler.ts`
- Create: `apps/api/src/chrome-bridge/cmd-snapshot-assembler.test.ts`
- Modify: `apps/api/src/chrome-bridge/cmd-dom-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/cmd-dom-adapter.test.ts`

**Interfaces:**
- Consumes: `CmdSnapshotChunk` plus source identity and receive time.
- Produces: a complete ordered `CmdCatalogInputRecord[]` or no value until complete.

- [ ] Write failing tests for out-of-order completion, identical replay, conflicting duplicate, missing chunk timeout, and atomic publication.
- [ ] Run the focused API tests and confirm RED.
- [ ] Implement the bounded 10-second assembler and wire it into `CmdDomCatalogAdapter.decode`.
- [ ] Ensure incomplete/invalid assemblies emit no catalog update and never clear the accepted catalog.
- [ ] Rerun focused API tests and confirm GREEN.

### Task 4: Integration and live proof

**Files:**
- Modify if required by failing integration only: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`

**Interfaces:**
- Consumes: complete adapter update.
- Produces: `catalog-source:CMD:FOOTBALL` through the existing catalog endpoint.

- [ ] Add a failing integration test with a multi-chunk CMD snapshot and assert no publish before the final chunk.
- [ ] Make the minimal integration correction and confirm GREEN.
- [ ] Run contract, extension, API bridge tests, typechecks, and builds.
- [ ] Reload the unpacked extension once, then verify bridge state, payload sizes, event count, market count, and a public sample event through API endpoints.
