# APSPORT/TSPORT Provider Work Log

Status: `IN_PROGRESS` — rerun provider-local checks, report `LOCAL_GREEN`, wait
for root's combined deployment, then the APSPORT worker must run its own live
acceptance. Only the accepted round permits `DONE`.

Historical checkpoint only: all coordination/path/build/runtime ownership text
below is superseded by the current `common.md`; technical evidence remains
reference material.

## Worker and coordination base

- Worker/provider: APSPORT (`TSPORT` bridge lobby)
- Starting coordination-base commit: `f6e25d44296bad2b5e6c88cbc8d92eac47ca26a1`
- Current continuation repo root/branch: `F:\0. PROJECT\tool-chenh` on `feat/six-provider-realtime-feed`
- `git merge-base --is-ancestor f6e25d4 HEAD` exited `0` before editing and again during final verification.

## Exact changed files

- `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts`
- `docs/superpowers/reports/five-provider/apsport.md`

The optional `tsport-authority-assembler` files were unnecessary and were not created.

## Root cause proven by code and test evidence

At the coordination base, `TsportWsCatalogAdapter` parsed complete DOM records as full quote records, retained them in `#domRecords`, merged them with every retained WS partition for the source, and marked a DOM update with `authoritativeBaseline: true`. DOM prices could therefore enter the authoritative catalog. WS updates had no explicit `BASELINE`/`DELTA` evidence mode, WS provenance, or generation, and there was no fresh-stream expected-ID coverage gate. Records from multiple socket stream keys could be merged, so a fresh candidate could not prove that one current socket supplied a complete baseline.

The provider-local adapter now treats a bound, complete current-document DOM sweep only as an expected event-ID set. It creates an empty record map on one fresh `WS_STATE OPEN`, stages only frames from that exact source epoch and stream, and emits authority only after the normalized WS catalog covers every expected event ID. DOM values are never passed to normalization or merge.

Review-driven regressions also proved and closed four rollback paths: duplicate/delayed `OPEN`, interleaved retired DOM chunks, cross-epoch `OPEN` mutation, and canonical source-epoch rollback. Snapshot retirement is bounded to 64 IDs plus a sequence high-water mark. Source epochs use canonical per-lineage generation high-water marks; retired lineages cannot re-enter, and an unseen seventeenth lineage fails closed instead of evicting retirement evidence.

## RED evidence

Every behavioral RED used this focused command:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/tsport-ws-adapter.test.ts
```

- Pre-edit characterization: `13/13` tests passed.
- Primary required authority cases: exactly `10` failing tests/assertions and `6` passing out of `16`.
- Shared update-contract alignment (`evidenceMode`): exactly `4` failing and `13` passing out of `17`.
- Bound complete-sweep requirement: exactly `1` failing and `17` passing out of `18`.
- Normalized expected-ID/empty-authority guards: exactly `2` failing and `17` passing out of `19`.
- Duplicate and delayed `OPEN` lifecycle fences: exactly `2` failing and `19` passing out of `21`.
- Cross-epoch expected evidence and collision-free generation identity: exactly `2` failing and `21` passing out of `23`.
- Interleaved retired DOM chunks and mismatched-epoch `OPEN`: exactly `2` failing and `23` passing out of `25`.
- Canonical epoch rollback and bounded-lineage saturation: exactly `2` failing and `25` passing out of `27`.

Syntax/transform mistakes encountered while authoring tests were corrected before behavioral runs and are not counted as RED evidence.

## GREEN evidence

Focused command:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/tsport-ws-adapter.test.ts
```

Final result: `1` test file passed; exactly `27/27` tests passed and `0` failed.

Only the task-prescribed focused Vitest suite was run. No build, runtime, browser, or broad test/typecheck command was run.

## Authority, baseline, and delta invariants covered

- A DOM envelope emits no catalog update and contributes only trimmed provider event IDs after all chunks form one bound `sweepComplete: true` snapshot.
- Absent, partial, malformed, mismatched, oversized, retired, or rolled-back DOM evidence cannot establish empty or nonempty authority.
- Interleaved chunks from a retired snapshot cannot reset or replace the newer sweep assembly.
- Expected identities are scoped to the exact canonical source epoch. Same-lineage lower generations and retired lineages cannot replace current evidence; lineage tracking fails closed at its bound.
- A pre-DOM socket `OPEN` is consumed but cannot authorize later evidence. A fresh accepted `OPEN` starts a distinct generation scoped by source ID, source epoch, stream ID, and `OPEN` sequence with an empty WS record map.
- Duplicate or delayed `OPEN`, cross-epoch `OPEN`, retired-stream frames, pre-`OPEN` frames, and wrong-epoch frames cannot reset, complete, or mutate the current generation.
- Partial WS coverage emits nothing. Coverage is accepted only when every expected event ID survives normalization into events, markets, and quotes.
- The final covering frame emits exactly one WS-only `BASELINE` with `authoritativeBaseline: true`, `evidenceMode: "BASELINE"`, `provenance: "WS"`, and the fresh generation.
- Every authoritative quote value and quote evidence clock comes from the retained fresh WS frame set, even when DOM fixtures contain different prices.
- A later current-stream frame emits `evidenceMode: "DELTA"` with WS provenance and the same generation; it does not repeat `authoritativeBaseline`.
- A new accepted stream starts with empty coverage and a new generation, so prior-stream records cannot fill it.
- Authoritative empty is emitted only from an explicit bound complete empty expected set plus a fresh accepted stream. An absent/partial set or a nonempty set whose WS data normalizes to empty remains silent.
- Closing only the current epoch/stream emits APSPORT invalidation; stale closes are ignored.

## Shared integration request

- Shared symbol/file: `recoverSourceSnapshot` in `apps/chrome-extension/src/background.ts`; `NetworkObserver.#refreshCatalog`, `#capturePublicCatalogSnapshot`, `#requestFreshSocketBaseline`, `#scheduleFreshSocketBaseline`, `beginSourceEpoch`, and TSPORT WebSocket lifecycle handling in `apps/chrome-extension/src/network-observer.ts`; candidate ingestion and `#promoteCandidate` in `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`.
- Provider-local output already implemented: a bound complete TSPORT DOM sweep stores expected event IDs without emitting authority; one fresh exact TSPORT football stream emits a WS-only `BASELINE` after full normalized coverage and same-generation `DELTA` updates thereafter. The adapter fails closed without bound sweep metadata, a canonical current epoch, a new stream, or complete coverage.
- Exact shared input/wiring required: route TSPORT recovery's `refresh` callback to `observer.refreshCatalog(...)`, not `observer.captureCmdSnapshot(...)`, while retaining the existing `CATALOG_REFRESH`/no-tab-reload recovery mode. In the TSPORT branch of `#refreshCatalog`, first emit the current football document's complete expected-ID sweep with all four bound sweep fields preserved. `#capturePublicCatalogSnapshot` currently collapses non-CMD captures into an aggregate with `sweep: undefined`; TSPORT must instead forward one coherent eligible frame/document sweep without dropping `sweepId`, `sweepComplete`, `sweepFrameKey`, or `sweepDocumentKey`.
- Exact shared socket wiring required: after the bound sweep, discover the page-owned socket even when `beginSourceEpoch` has cleared `#webSockets`, using the known same-tab main-world/OOPIF contexts. Match only host `spws.agenate.com` or `spws.racern.com` and the football event path class `/ln/<locale>/(p/1/u/<one-or-two-segments>/)?s/1/mg/0/tr/0`. Close/reconnect only that matching page-owned socket. The observer must allocate a fresh stream ID in the current source epoch, emit `WS_STATE OPEN` before any frames, and must not replay cached/retired TSPORT frames into the new generation.
- RED integration test the integrator must add: in `apps/chrome-extension/src/network-observer.test.ts`, begin a replacement TSPORT source epoch that clears cached socket metadata, capture a bound complete expected-ID sweep from the current document, discover and reconnect only the exact football socket in the same tab, and assert a fresh `WS_STATE OPEN` precedes frames. Assert unrelated sockets, providers, tabs, and execution contexts are untouched and no reload/navigation occurs. Add or extend the background recovery seam test to prove TSPORT calls refresh rather than capture/reload.
- RED atomic-promotion test the integrator must add: in `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`, ingest candidate TSPORT DOM evidence and assert it remains unpromoted; ingest all but one expected fresh WS event and assert no promotion/publish; ingest the final covering frame and assert exactly one atomic promotion with WS provenance/current generation; then prove retired-stream and rolled-back-epoch frames cannot mutate or renew the promoted catalog. Retain the existing provider-confirmed empty proof path for bound complete empty plus fresh stream.
- Safety invariant: recovery never reloads, navigates, replaces, or focuses the tab; never closes a nonmatching socket; never touches another provider/source/tab; never grants DOM catalog authority; and never relabels cached, partial, stale, retired, or cross-epoch evidence as the fresh stream.
- Focused commands:

```powershell
npm.cmd test --workspace @tool-chenh/chrome-extension -- src/network-observer.test.ts src/snapshot-recovery.test.ts
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/chrome-catalog-data-plane.test.ts src/chrome-bridge/tsport-ws-adapter.test.ts
```

## Concerns and remaining external blockers

- The current shared TSPORT refresh path captures DOM and returns without requesting a fresh exact football socket baseline.
- The current shared non-CMD snapshot aggregation drops bound sweep metadata, so this provider-local adapter intentionally rejects that TSPORT DOM capture until the integrator preserves the frame/document binding.
- The current background TSPORT recovery callback routes refresh to `captureCmdSnapshot`; the integrator must route it to observer catalog refresh.
- Historical worker scope stopped before shared candidate promotion and live acceptance. No build identity, runtime lease, or live APSPORT observation was supplied or used, so this entry is not a completion claim; the next APSPORT worker owns the remaining runtime loop.
- Independent read-only review returned `READY` after the rollback and bounded-fence regressions were addressed.

## Scope and safety confirmation

No Git mutation, build, generated `dist` write, process start/stop/restart/signal, runtime endpoint call, browser/Chrome action, DevTools/CDP/debugger action, tab operation, `.auth` read, shared extension/data-plane edit, other provider-file edit, common/task/spec edit, or other worker-report edit was performed. All writes used `apply_patch` and stayed within the APSPORT whitelist. Secret scanning found no authorization header, bearer value, cookie, password, credential token, launch URL, raw HTTP/WS URL, captured provider body, or debug diagnostic added; test payloads are synthetic fixtures.

Historical patch status: superseded. Runtime status remains `IN_PROGRESS`.
