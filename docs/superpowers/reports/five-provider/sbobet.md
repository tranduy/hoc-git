# SBOBET/KSPORT Provider Work Log

Status: `IN_PROGRESS` — provider-local tests are not runtime acceptance. A future worker must continue until the built main application satisfies every gate in `common.md`.

Historical checkpoint only: any patch-only/build/runtime restrictions recorded below describe the prior worker run and are superseded by the current end-to-end worker loop in `common.md`.

## Worker and base

- Worker/provider: SBOBET/KSPORT
- Starting coordination base: `f6e25d44296bad2b5e6c88cbc8d92eac47ca26a1`
- Branch observed read-only: `feat/six-provider-realtime-feed`
- Live/runtime acceptance: not run and not claimed

## Exact changed files

- `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- `docs/superpowers/reports/five-provider/sbobet.md`

The optional `ksport-baseline-generation.ts` and test file were not created; the provider-local state remains in the adapter.

## Root cause proven

The WS full-snapshot path used `SbobetStompProviderReceipt.receiptSequence` both as receipt order and as the baseline-generation key. A live full receipt at order 100 created pending generation 100; a today full receipt at order 104 then replaced it with pending generation 104, so neither pair could commit even though both belonged to one recovery attempt.

The HTTP path already demonstrated the correct separation: its canonical request generation pairs partitions, while envelope sequence only orders receipts. The WS fix now reads an explicit positive safe-integer `request.recoveryGeneration` to pair/retire recovery state. STOMP `message-id` receipt sequence is used only for partition-local order, pending-delta replay, and overlap resolution.

Additional state tracing and RED tests proved four related failure paths:

- a global receipt high-watermark incorrectly let one partition fence the other;
- retired-generation deltas/full receipts and generation-mismatched heartbeats could mutate or renew current state;
- malformed non-full zero-record bodies could advance receipt evidence;
- a valid newer-generation delta arriving before the first full partition was discarded instead of entering bounded pending state.

## RED to GREEN evidence

Baseline before edits:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/ksport-ws-adapter.test.ts
```

Result: 31 passed, 0 failed.

Primary required RED:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/ksport-ws-adapter.test.ts -t "pairs different live and today receipt orders by one explicit recovery generation"
```

Result: exactly 1 failed test, 30 skipped. The today@104 call returned no update after live@100, producing `Cannot read properties of undefined (reading 'value')`; the live fixture had parsed and its expected partial result had passed, so this was not a missing-fixture or syntax failure. The final regression now asserts the missing baseline output directly before inspecting its catalog.

Assertion-based RED runs each produced exactly 1 failing test/assertion and no unrelated failures:

- partition-local order: expected generation-2 baseline, received `[]`;
- retired-generation delta: expected `[]`, received a `DELTA` update;
- stale pending-delta replay: expected odds `0.90`, received `0.60`;
- missing generation heartbeat: expected `[]`, received `transportAlive`;
- fenced-generation recovery: expected generation-3 baseline, received `[]` after fenced receipt@900 advanced the old fence;
- generation-mismatched heartbeat: expected `[]`, received `transportAlive`;
- malformed zero-record delta: expected one valid later delta, received zero updates;
- delta before full partitions: expected replayed odds `0.95`, received baseline odds `0.85`.

Final GREEN command:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/ksport-ws-adapter.test.ts
```

Result: 1 test file passed, exactly 43 tests passed, 0 failed.

## Provider invariants covered

- One explicit recovery generation pairs live and today full partitions even when receipt orders differ (live@100/today@104).
- Equal receipt orders from different explicit generations never combine; delayed old partitions cannot fill a newer pending generation.
- Receipt evidence is monotonic per partition and carried across same-source-epoch stream handoff, without a global cross-partition fence.
- Overlapping event IDs select the higher receipt order; exact ties deterministically select live.
- Valid newer-generation deltas may establish/preempt bounded pending state before either full partition; only deltas newer than that partition's eventual baseline replay.
- Retired-generation full/delta evidence cannot mutate pending or committed state. Heartbeats renew transport liveness only for the exact committed generation and only when no replacement is pending.
- Pending delta record/market overflow fences the generation, invalidates authority, ignores later same-generation evidence without advancing fences, and permits only a strictly newer generation to recover.
- Missing generation metadata, missing receipt order, replayed envelopes, malformed zero-record deltas, stale streams, close, and fenced generations remain fail-closed.
- Close followed by a strictly newer stream can rebaseline in the same source epoch while retaining per-partition receipt fences.
- A complete explicit-generation pair of authoritative empty partitions emits an empty baseline to tombstone prior events, markets, and quotes.

## Shared integration request

- Shared symbol/file: `ChromeBridgeEnvelope.request` in integrator-owned `packages/contracts/**`; KSPORT capture/forwarding in `apps/chrome-extension/src/network-observer.ts` and, if it reconstructs request metadata, `apps/chrome-extension/src/background.ts`.
- Provider-local output already implemented: `KsportWsCatalogAdapter` reads `request.recoveryGeneration`, accepts only a positive `Number.isSafeInteger` value, namespaces it by source epoch and canonical stream ID, and fails closed for KSPORT WS frames/heartbeats when it is absent or invalid.
- Exact shared input/wiring required: add `readonly recoveryGeneration?: number` to the request metadata contract. For every KSPORT `WS_FRAME`, set it to the recovery attempt that originated the decoded provider receipt(s). Initialize generation 1 for a newly accepted canonical stream; increment strictly for each same-stream recovery attempt. Preserve the original generation through buffering/forwarding/replay. Do not derive it from STOMP `message-id`, bridge `sequence`, or arrival time. Both live and today full receipts, their intervening deltas, and heartbeats for one attempt carry the same value. A scalar envelope value is safe only when every provider receipt decoded from that SockJS frame belongs to that generation; split mixed-generation batches before the API boundary (or introduce per-receipt metadata and update this adapter explicitly).
- RED integration test the integrator must add: in `apps/chrome-extension/src/network-observer.test.ts`, start KSPORT recovery generation 7, emit live receipt order 100 and today receipt order 104, and assert both forwarded envelopes carry `request.recoveryGeneration === 7`; then start generation 8 and prove a delayed generation-7 part retains 7 while current parts carry 8. Add a contract/bridge round-trip assertion that the number is preserved unchanged. Feed those envelopes into the focused adapter regression and assert only the generation-8 pair commits.
- Safety invariant: recovery generation identifies origin/cycle and must never be inferred from receipt order; receipt order remains independently monotonic within each partition. Delayed, replayed, mixed, malformed, or retired evidence must never be relabeled as the active generation or renew authority.
- Focused command: `npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/ksport-ws-adapter.test.ts`

## Concerns and external blockers

- Shared contract/observer wiring above is required before current live KSPORT WS traffic can establish or renew authority; without it the adapter intentionally fails closed.
- No provider-local runtime blocker remains in the focused fixture suite. Live page behavior, build output, extension forwarding, shared authority integration, and browser/runtime acceptance remain for the integrator.

## Scope and safety confirmation

No Git mutation, commit, build, generated `dist` write, process start/stop/signal, runtime recovery call, browser/Chrome/DevTools/debugger action, `.auth` access, shared observer/contract/data-plane edit, or other provider-file edit was performed. Only the exact SBOBET whitelist files listed above were changed.
