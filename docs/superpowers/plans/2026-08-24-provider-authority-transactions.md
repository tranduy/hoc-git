# Provider Authority Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace split provider ownership and evidence flags with bounded, atomic authority transactions that cannot be promoted by replay, DOM data, non-catalog empties, or unordered recovery evidence.

**Architecture:** A fixed six-account `ProviderAuthorityCoordinator` owns active and candidate lanes. Adapters prepare strict `CatalogCommitProof` values; the coordinator atomically promotes a candidate and its network catalog, coverage, feed state, and control target. SABA uses bounded characterized channel state, while KSPORT uses one WS/HTTP/lifecycle ordering ledger.

**Tech Stack:** TypeScript 5.9, Node.js, Fastify, Chrome MV3/CDP, Zod, Vitest, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-24-provider-authority-transactions-design.md`

## Global Constraints

- Work only in `.worktrees/six-provider-realtime-feed`; do not restart or modify the separately running production-like stack during Tasks 6A.1–6A.6.
- Preserve the fail-closed feed policy: tab heartbeat, bridge ACK, replay, restored data, DOM capture, OPEN, ping/pong, and partial baselines never create authority.
- Use TDD for every behavior: record a focused RED on commit `30513a59cdbdf1e18ed9b70acfd6d28b6dbbe2d9`, implement the smallest coherent slice, then run its GREEN and prior-task regressions.
- Never persist or log cookies, signed URLs, authorization data, raw provider bodies, or secret-bearing request metadata.
- Bounds fail closed; probabilistic membership, LRU replay reopening, and silent schema eviction are forbidden.
- Task 7 cannot begin until every task below passes independent review and the final breaker reports zero Critical and Important findings.

## File Structure

- Create `apps/api/src/chrome-bridge/provider-authority-types.ts`: authority identities, candidate tokens, comparable cursors, commit proofs, and coordinator decisions.
- Create `apps/api/src/chrome-bridge/provider-authority-coordinator.ts`: fixed six-account active/candidate state and compare-and-swap promotion.
- Create `apps/api/src/chrome-bridge/ksport-order-ledger.ts`: one source-epoch KSPORT WS/HTTP/lifecycle ordering state.
- Modify contracts and `network-body-assembler.ts`: exact generated-recovery metadata and multipart identity.
- Modify registry, route, control plane, data plane, feed controller, coverage guard, and server: coordinator-owned authority and lifecycle.
- Modify SABA/KSPORT adapters and extension observer: strict content proof, bounded state, lifecycle invalidation, and request cutoff.
- Create `apps/api/src/chrome-bridge/six-provider-authority-independence.test.ts`: cross-provider invariance gate.

---

### Task 6A.1: Contract and Multipart Authority Fences

**Files:**

- Modify: `packages/contracts/src/chrome-bridge.ts`
- Modify: `packages/contracts/src/chrome-bridge.test.ts`
- Modify: `apps/api/src/chrome-bridge/network-body-assembler.ts`
- Modify: `apps/api/src/chrome-bridge/network-body-assembler.test.ts`

**Interfaces:**

- Produces optional all-or-none KSPORT recovery request metadata:

```ts
providerPartition: "KSPORT_LIVE" | "KSPORT_TODAY";
providerContentIntent: "FOOTBALL_FULL_CATALOG";
requestStartSequence: number;
```

- `NetworkBodyAssembler.ingest()` requires every chunk to match source, epoch, lobby, tab, path, method, request/document/frame identity, replay flag, partition, intent, cutoff, stream, function code, clocks, chunk count, and snapshot ID.

- [ ] **Step 1: Add failing contract tests for all-or-none recovery metadata**

```ts
expect(ChromeBridgeEnvelopeSchema.safeParse({ ...base, request: {
  ...base.request, providerPartition: "KSPORT_LIVE", requestStartSequence: 10
} }).success).toBe(false);
expect(ChromeBridgeEnvelopeSchema.parse({ ...base, request: { ...base.request,
  providerPartition: "KSPORT_LIVE", providerContentIntent: "FOOTBALL_FULL_CATALOG",
  requestStartSequence: 10 } }).request.requestStartSequence).toBe(10);
```

- [ ] **Step 2: Run the contract tests and record RED**

Run: `npm test --workspace @tool-chenh/contracts -- --run chrome-bridge.test.ts`

Expected: the partial metadata envelope is accepted or the new fields are missing.

- [ ] **Step 3: Implement the strict Zod union and exported TypeScript shape**

Use one strict recovery-metadata object so a missing partition, intent, or cutoff fails parsing. Require a nonnegative safe integer cutoff and exact enum strings.

- [ ] **Step 4: Add failing assembler tests for every authority field and resource bound**

```ts
expect(assembler.ingest(chunk(0, { replayed: true }))).toBeNull();
expect(assembler.ingest(chunk(1, { replayed: false }))).toBeNull();
expect(assembler.ingest(chunk(0, { requestStartSequence: 10 }))).toBeNull();
expect(assembler.ingest(chunk(1, { requestStartSequence: 11 }))).toBeNull();
```

Also seed 5,000 unique first chunks and assert only the documented per-source/global count and byte limits remain completable; advance the injected clock beyond 30 seconds and assert expired chunks cannot complete.

- [ ] **Step 5: Run assembler tests and record RED**

Run: `npm test --workspace @tool-chenh/api -- --run src/chrome-bridge/network-body-assembler.test.ts`

Expected: mixed metadata completes or pending state exceeds the bound.

- [ ] **Step 6: Implement exact identity, fixed accounting, TTL, and scoped quarantine**

Keep at most 8 bodies/24 MiB per source and 48 bodies/144 MiB globally. A mismatch or overflow discards and quarantines that exact source/epoch/snapshot identity until TTL or epoch reset; it never evicts another provider's active body.

- [ ] **Step 7: Run focused tests, contracts typecheck/build, and commit**

Run:

```text
npm test --workspace @tool-chenh/contracts -- --run chrome-bridge.test.ts
npm test --workspace @tool-chenh/api -- --run src/chrome-bridge/network-body-assembler.test.ts
npm run typecheck --workspace @tool-chenh/contracts
npm run build --workspace @tool-chenh/contracts
```

Commit: `fix(bridge): bind provider recovery evidence`

---

### Task 6A.2: Atomic Account Authority Coordinator

**Files:**

- Create: `apps/api/src/chrome-bridge/provider-authority-types.ts`
- Create: `apps/api/src/chrome-bridge/provider-authority-coordinator.ts`
- Create: `apps/api/src/chrome-bridge/provider-authority-coordinator.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-registry.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-registry.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-control-plane.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-control-plane.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-route.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-route.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**

```ts
observe(identity: AuthorityIdentity, evidenceClass: "REPLAY" | "TRANSPORT" | "CANDIDATE_DATA"):
  { disposition: "ACTIVE" | "CANDIDATE" | "REJECTED"; token: AuthorityCandidateToken | null };
promote(token: AuthorityCandidateToken, proof: CatalogCommitProof): AuthorityPromotion;
invalidate(identity: AuthorityIdentity, reason: ProviderFeedInvalidationReason): AuthorityDecision;
snapshot(accountId: string): AuthoritySlotSnapshot;
```

- [ ] **Step 1: Write coordinator RED tests for active/candidate isolation**

Establish active A, then send replay, TAB_STATE, OPEN, heartbeat, partial HTTP, and malformed/non-catalog data from B. Assert A's identity, catalog revision, coverage, feed status, and active control target remain unchanged. Turn over 1,000 candidates and assert one active plus one candidate remain.

- [ ] **Step 2: Run coordinator/integration tests and record RED**

Run: `npm test --workspace @tool-chenh/api -- --run src/chrome-bridge/provider-authority-coordinator.test.ts src/chrome-bridge/chrome-bridge-registry.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts`

Expected: coordinator is missing and registry/control replace ownership before proof.

- [ ] **Step 3: Implement fixed six-account slots and candidate tokens**

Use the canonical account mapping from `chrome-bridge-account.ts`. Store exactly `{active,candidate}` per configured account. Candidate tokens use a coordinator-local monotonically increasing nonce. A stale token, replayed identity, older connection, or retired lineage returns `REJECTED`.

- [ ] **Step 4: Integrate registry and control routing without pre-promotion replacement**

Transport ACK remains connection-level. `sourcesByAccount` and normal control targets change only from the coordinator promotion callback. Candidate bootstrap is explicitly addressed by its token/source and is removed on rejection, replacement, disconnect, or promotion. Every late close compares socket identity before deletion.

- [ ] **Step 5: Integrate isolated candidate pipelines and atomic promotion**

Prepare a proof in the candidate pipeline without mutating active feed, coverage, catalog, router, assembler, timestamps, or recovery state. `promote()` swaps authority and lane state synchronously; publish only after the swap succeeds. Late active/candidate emissions fail their identity/token check.

- [ ] **Step 6: Run route/control/data-plane lifecycle GREEN tests**

Run: `npm test --workspace @tool-chenh/api -- --run src/chrome-bridge/provider-authority-coordinator.test.ts src/chrome-bridge/chrome-bridge-registry.test.ts src/chrome-bridge/chrome-bridge-control-plane.test.ts src/chrome-bridge/chrome-bridge-route.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts`

Expected: all pass, including silent-old-socket, late-close, replay candidate, KSPORT/SBO collision, and 1,000 turnover probes.

- [ ] **Step 7: Run API typecheck/build and commit**

Commit: `refactor(feed): transact provider authority`

---

### Task 6A.3: Proven Football Content and Provenance Separation

**Files:**

- Modify: `apps/api/src/chrome-bridge/adapter.ts`
- Modify: `apps/api/src/chrome-bridge/saba-push-decoder.ts`
- Modify: `apps/api/src/chrome-bridge/saba-push-decoder.test.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`

**Interfaces:**

- Adapters return `CatalogCommitProof | null` for complete network commits and keep DOM output in a separate `DOM_FALLBACK` plane.
- SABA decode distinguishes `FOOTBALL_ROWS`, `PROVIDER_CONFIRMED_EMPTY_CHANNEL`, `NON_CATALOG`, `PARTIAL`, and `FAULT`.

- [ ] **Step 1: Add RED tests for false-empty and DOM laundering**

Cover SABA configuration reset/done after a valid football baseline, KSPORT shallow league/config objects paired with empty today, unproven SABA empty, and a DOM-only event `999` followed by a WS baseline containing only event `101`.

- [ ] **Step 2: Run SABA/KSPORT tests and record RED**

Run: `npm test --workspace @tool-chenh/api -- --run src/chrome-bridge/saba-push-decoder.test.ts src/chrome-bridge/saba-ws-adapter.test.ts src/chrome-bridge/ksport-ws-adapter.test.ts src/chrome-bridge/saba-ws-realtime-regression.test.ts`

Expected: config/shallow inputs clear catalogs or DOM event 999 appears in WS authority.

- [ ] **Step 3: Implement strict content classification and safe-empty proof**

SABA config/control frames return `NON_CATALOG`. Channel-empty proof is allowed only for a previously proven football channel and tombstones that channel only. KSPORT empty proof requires matching strict football live/today partitions; a shallow object or unsupported normalized row is non-catalog.

- [ ] **Step 4: Separate network and DOM catalog planes**

Network merge functions consume only network partitions. DOM fallback is retained and published as stale/diagnostic under `DOM_FALLBACK`; it cannot add or overwrite executable network entities. Remove the second data-plane SABA union that launders DOM into network authority.

- [ ] **Step 5: Run GREEN plus CMD/IM provenance regressions**

Run: `npm test --workspace @tool-chenh/api -- --run src/chrome-bridge/saba-push-decoder.test.ts src/chrome-bridge/saba-ws-adapter.test.ts src/chrome-bridge/ksport-ws-adapter.test.ts src/chrome-bridge/saba-ws-realtime-regression.test.ts src/chrome-bridge/cmd-dom-adapter.test.ts src/chrome-bridge/cmd-http-adapter.test.ts src/chrome-bridge/im-http-adapter.test.ts`

- [ ] **Step 6: Commit**

Commit: `fix(feed): require proven football catalogs`

---

### Task 6A.4: Unified KSPORT Ordering and Lifecycle

**Files:**

- Create: `apps/api/src/chrome-bridge/ksport-order-ledger.ts`
- Create: `apps/api/src/chrome-bridge/ksport-order-ledger.test.ts`
- Modify: `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/chrome-extension/src/network-observer.test.ts`
- Modify: `apps/api/src/chrome-bridge/provider-feed-controller.ts`
- Modify: `apps/api/src/chrome-bridge/provider-feed-controller.test.ts`

**Interfaces:**

- The order ledger consumes `{transport, envelopeSequence, receiptSequence, lifecycleSequence, streamOrdinal, requestStartSequence}` and returns `ACCEPT`, `FENCE_PENDING`, `INVALIDATE`, or `REQUIRE_BASELINE`.

- [ ] **Step 1: Add the full race-table RED tests**

Include baseline100→delta201→baseline150, HTTP cutoff10 followed by WS data/open/close11, WS delta between sequential HTTP live/today fetches, pending overflow then heartbeat59s, duplicate/lower/replacement OPEN, same-epoch close/reopen, post-HTTP old WS delta, and switching back through a new WS pair.

- [ ] **Step 2: Run KSPORT/observer/controller tests and record RED**

Run: `npm test --workspace @tool-chenh/api -- --run src/chrome-bridge/ksport-order-ledger.test.ts src/chrome-bridge/ksport-ws-adapter.test.ts src/chrome-bridge/provider-feed-controller.test.ts`

Run: `npm test --workspace @tool-chenh/chrome-extension -- --run src/network-observer.test.ts`

- [ ] **Step 3: Capture and emit the HTTP request-start cutoff**

The observer records its current source envelope sequence immediately before the first generated KSPORT fetch. Both sequential responses carry the same generation, cutoff, partition intent, frame/document identity, and source epoch. Abort or metadata mismatch discards both parts.

- [ ] **Step 4: Implement one ledger across WS, HTTP, and lifecycle**

Every current-source WS/lifecycle envelope advances the comparable envelope watermark even if its payload cannot yet update a catalog. Evidence above an HTTP cutoff permanently fences that HTTP pair. Receipt/lifecycle/stream high-watermarks survive close/open. Overflow emits one invalidation and suppresses transport heartbeats until a strictly newer pair commits.

- [ ] **Step 5: Implement replacement OPEN invalidation**

When a higher stream replaces the stream that owns current WS authority, emit `INVALIDATE` before resetting decoder state. Do not invalidate current HTTP authority merely because a WS candidate opens; promote WS only after its complete pair.

- [ ] **Step 6: Run the race table and extension regressions GREEN**

Run the commands from Step 2 plus `src/chrome-bridge/chrome-catalog-data-plane.test.ts` and `src/source-tab-refresh.test.ts`.

- [ ] **Step 7: Typecheck/build API and extension, then commit**

Commit: `fix(feed): order SBOBET recovery evidence`

---

### Task 6A.5: Bounded SABA Decoder and Quiet-Stream Liveness

**Files:**

- Modify: `apps/api/src/chrome-bridge/saba-push-decoder.ts`
- Modify: `apps/api/src/chrome-bridge/saba-push-decoder.test.ts`
- Modify: `apps/api/src/chrome-bridge/saba-socket-frame.ts`
- Modify: `apps/api/src/chrome-bridge/saba-socket-frame.test.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`
- Modify: `apps/api/src/catalog/catalog-coverage-guard.ts`
- Modify: `apps/api/src/catalog/catalog-coverage-guard.test.ts`

**Interfaces:**

- Decoder limits: 64 bridge IDs, 64 logical channels, 512 dense field columns.
- Exact current-stream Engine.IO heartbeat may emit `transportAlive` after baseline; it never changes catalog content or baseline age.
- Coverage retains one comparable current authority cursor and bounded accepted identities per lane.

- [ ] **Step 1: Add RED tests for heartbeat eligibility and sparse offset**

Test current quiet stream heartbeat, prebaseline heartbeat, replayed/retired/malformed heartbeat, max baseline age, and offset `4294967294`. The huge offset test must return synchronously within 100 ms and leave a fresh decoder usable.

- [ ] **Step 2: Add RED flood tests for every decoder/coverage bound**

Exercise 65 bridge IDs, 65 channels, 513 field columns, 50,000 malformed generations, and repeated authoritative cursor changes. Assert one explicit fault/invalidation and fixed-size externally observable state; no silent eviction allows old evidence back.

- [ ] **Step 3: Run RED**

Run: `npm test --workspace @tool-chenh/api -- --run src/chrome-bridge/saba-push-decoder.test.ts src/chrome-bridge/saba-socket-frame.test.ts src/chrome-bridge/saba-ws-adapter.test.ts src/chrome-bridge/saba-ws-realtime-regression.test.ts src/catalog/catalog-coverage-guard.test.ts`

- [ ] **Step 4: Implement dense bounds and latched stream fault**

Check offset and range before allocation or assignment. Bound failure clears the stream's decoder/channel/field state, emits `SCHEMA_CHANGED` invalidation once, and accepts no further evidence until a strictly higher OPEN.

- [ ] **Step 5: Implement exact heartbeat liveness and compact coverage cursor**

Recognize only the characterized received Engine.IO heartbeat forms. Require current lane, current stream, non-replay, and existing complete baseline. Coverage compares lane-issued cursors and keeps the current accepted identity set; it does not accumulate opaque generation strings.

- [ ] **Step 6: Run GREEN, API typecheck/build, and commit**

Commit: `fix(feed): bound SABA authority state`

---

### Task 6A.6: Six-Provider Independence and Breaker Gate

**Files:**

- Create: `apps/api/src/chrome-bridge/six-provider-authority-independence.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `.superpowers/sdd/2026-08-23-six-provider-realtime-feed-recovery/progress.md`
- Create: `.superpowers/sdd/2026-08-23-six-provider-realtime-feed-recovery/task-6a-report.md`

**Interfaces:**

- No new production interface. This task freezes the shared authority transaction contract for Tasks 7–11.

- [ ] **Step 1: Add a parameterized six-provider RED integration test**

Establish authoritative CMD, IM, SABA, SBOBET, APSPORT, and BTI lanes. For each provider, inject replay, candidate turnover, stream close/open, malformed content, and valid promotion. Snapshot the other five providers before and after and assert identical active source, source epoch, catalog hash/revision, feed state, control target, and recovery counters.

- [ ] **Step 2: Add accumulated breaker regressions**

Include false-empty SABA/KSPORT, DOM laundering, mixed HTTP/WS order, replacement OPEN, replay ownership, quiet SABA heartbeat, sparse offset, 50,000 decoder inputs, 1,000 candidate turnovers, multipart provenance laundering, pending overflow, and silent old socket late-send.

- [ ] **Step 3: Run the new integration tests and record RED for any uncovered seam**

Run: `npm test --workspace @tool-chenh/api -- --run src/chrome-bridge/six-provider-authority-independence.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts src/server.test.ts`

- [ ] **Step 4: Make only integration corrections required by the RED evidence**

Corrections may wire already-defined coordinator/proof/ledger interfaces; do not add a third authority owner, alternate cursor model, or provider-specific bypass.

- [ ] **Step 5: Run the complete verification matrix**

```text
npm test --workspace @tool-chenh/contracts
npm test --workspace @tool-chenh/chrome-extension
npm test --workspace @tool-chenh/api
npm run typecheck --workspace @tool-chenh/contracts
npm run typecheck --workspace @tool-chenh/api
npm run typecheck --workspace @tool-chenh/chrome-extension
npm run build --workspace @tool-chenh/contracts
npm run build --workspace @tool-chenh/api
npm run build --workspace @tool-chenh/chrome-extension
git diff --check
```

Expected API exception: only the two unchanged Windows path/mode assertions in `local-app-data.test.ts` and `local-key-protector.test.ts` may fail; all changed and provider suites must pass.

- [ ] **Step 6: Run hygiene scans and write the report**

Confirm no raw provider bodies, cookies, tokens, signed URLs, authorization values, or secret-shaped fixture fields exist in the diff. Record every RED/GREEN command, bound, migration risk, and final commit in `task-6a-report.md`.

- [ ] **Step 7: Commit and request an independent breaker review**

Commit: `test(feed): prove six-provider authority isolation`

The breaker must inspect source and run adversarial probes. Task 6A is complete only with zero Critical and zero Important findings.
