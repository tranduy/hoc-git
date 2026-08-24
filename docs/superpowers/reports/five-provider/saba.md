# SABA Provider Work Log

Status: `IN_PROGRESS` — provider-local tests are not runtime acceptance. A future worker must continue until the built main application satisfies every gate in `common.md`.

Historical checkpoint only: any patch-only/build/runtime restrictions recorded below describe the prior worker run and are superseded by the current end-to-end worker loop in `common.md`.

## Worker and base

- Worker/provider: SABA
- Starting coordination-base commit: `f6e25d4`
- Worktree/branch verified: `F:\0. PROJECT\tool-chenh\.worktrees\six-provider-realtime-feed` on `feat/six-provider-realtime-feed`
- `git merge-base --is-ancestor f6e25d4 HEAD` exited `0` before editing.

## Exact changed files

- `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`
- `docs/superpowers/reports/five-provider/saba.md`

`apps/api/src/chrome-bridge/saba-ws-adapter.test.ts` was inspected and included in every focused run, but was not changed.

## Root cause proven by code and tests

1. Both provider-gap paths dropped the stream decoder and authoritative generation but left the lifecycle state active and authorizing. Unlike the close path, neither the provider-refusal path nor the decoder sequence-gap path cleared `activeStreamId`, `activeStreamOrdinal`, and `authorizing`. The retired stream could therefore send another complete reset/data/done sequence and publish a new `BASELINE` without a strictly newer `OPEN`.
2. Reset/empty handling deleted the committed generation before `SabaPushDecoder.apply()` reported that an envelope was a duplicate. Repeating an identical completed baseline emitted no update, but silently removed the generation; the next real data frame then lacked `DELTA`, `generation`, and `WS` provenance.

The implementation now retires lifecycle authority on both gap paths while preserving the ordinal high-water mark, and rejects decoder duplicates before reset/empty can mutate committed authority.

## RED evidence

Command:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/saba-ws-adapter.test.ts src/chrome-bridge/saba-ws-realtime-regression.test.ts
```

- Initial RED: `2` failing assertions and `29` passing tests out of `31`.
  - Expected no update after a current-stream revision gap, but received authoritative `BASELINE` generation `worker-a:0:saba:1:4`.
  - Expected the next accepted price frame to remain a `DELTA` on generation `worker-a:0:saba:1:2`, but the update had no authority evidence after an identical baseline replay.
- After isolating and fixing revision-gap lifecycle retirement: `1` failing assertion and `30` passing tests out of `31`; only duplicate-baseline generation continuity remained RED.
- A003 mutation RED: with the A003 lifecycle-retirement lines removed, `1` failing assertion and `31` passing tests out of `32`; the refused stream again emitted authoritative `BASELINE` generation `worker-a:0:saba:1:4`.

All RED failures were behavioral assertion failures, not syntax, fixture, import, or test-runner errors.

## GREEN evidence

Focused command:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/saba-ws-adapter.test.ts src/chrome-bridge/saba-ws-realtime-regression.test.ts
```

Result: `2` test files passed and `32/32` tests passed.

Typecheck command:

```powershell
npm.cmd run typecheck --workspace @tool-chenh/api -- --pretty false
```

This ran `tsc -p tsconfig.json --noEmit --pretty false` and did not build. The latest run exited `1` with two concurrent out-of-whitelist errors:

- `src/chrome-bridge/cmd-http-adapter.ts(134,67)`: `PendingDelta` is not assignable to `ChromeBridgeEnvelope`.
- `src/chrome-bridge/tsport-ws-adapter.test.ts(255,21)`: a readonly catalog `markets` array is cast to a mutable array type.

No SABA type error was reported. The CMD/APSPORT workers or integrator must resolve those external errors and rerun the same command.

## Authority, baseline, and delta invariants covered

- Only the current stream selected by `OPEN` can authorize a complete reset/football-data/done sequence.
- Pending baseline data from a newer stream cannot be completed by a stale stream's `done`; the newer stream emits exactly one WS `BASELINE` with a distinct generation.
- Existing regression coverage continues to prove authoritative empty reset/done tombstones the prior catalog, while partial empty/reset does not publish authority.
- Existing coverage continues to reject pre-`OPEN` authority, retired streams, replayed envelopes, delayed retired `OPEN`, and cross-epoch evidence.
- Close, provider refusal, and provider revision/sequence gap invalidate continuity. The same or older stream cannot regain authority; a strictly newer same-epoch stream can establish a fresh baseline.
- A current post-baseline price frame emits WS `DELTA` against the committed generation.
- Identical completed-baseline and post-baseline data evidence emits no duplicate update and does not remove or advance the committed generation.
- The provider-local gap tests assert the exact `PROVIDER_STREAM_GAP` invalidation output consumed by the shared data plane. Shared data-plane/live acceptance remains integrator-owned.

Shared integration request: none

## Concerns and external blockers

- API-wide typecheck is currently blocked by the out-of-whitelist CMD and TSPORT test errors described above.
- The historical worker performed no build or live SABA acceptance. The current SABA worker must build/restart/reload under the deployment lease and prove its exact-tab runtime under an acceptance lease.
- Independent read-only review found no Critical code issues. Its only Important item was the required report, now supplied; its non-blocking note was to retain integrator coverage that generic gap invalidation makes the data plane non-`LIVE`.

## Scope and safety confirmation

No Git mutation, build, runtime process start/stop/restart, browser action, DevTools/debugger action, tab reload/navigation, runtime API call, `.auth` access, shared file, another provider file, generated artifact, or another worker report was touched. All edits used `apply_patch` and stayed inside the exact SABA whitelist. No credentials, raw launch URLs, cookies, tokens, or raw provider bodies were added. Live runtime success is not claimed.
