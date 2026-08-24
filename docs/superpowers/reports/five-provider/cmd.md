# CMD Provider Work Log

Status: `IN_PROGRESS` — provider-local tests are not runtime acceptance. A future worker must continue until the built main application satisfies every gate in `common.md`.

Historical checkpoint only: any patch-only/build/runtime restrictions recorded below describe the prior worker run and are superseded by the current end-to-end worker loop in `common.md`.

## Worker and base

- Worker/provider: CMD
- Starting coordination base: `f6e25d44296bad2b5e6c88cbc8d92eac47ca26a1`
- Branch observed throughout: `feat/six-provider-realtime-feed`
- Scope: deterministic provider-local implementation and focused tests only. No live runtime success is claimed.

## Exact changed files

- `apps/api/src/chrome-bridge/cmd-http-adapter.ts`
- `apps/api/src/chrome-bridge/cmd-http-adapter.test.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`
- `apps/chrome-extension/src/cmd-recovery-state.ts` (new)
- `apps/chrome-extension/src/cmd-recovery-state.test.ts` (new)
- `docs/superpowers/reports/five-provider/cmd.md` (new)

## Root cause proven by code and tests

1. The adapter used `providerVersion` for both committed authority and uncommitted pre-baseline evidence. A delta at `t=101` therefore made the early cursor guard reject a later-arriving complete `fc=1` baseline at `t=100`. The regression test failed with `expected [] to have a length of 1 but got 0` before pending evidence was separated from the committed cursor.
2. Pre-baseline storage was unbounded and rejected pre-baseline function families could also advance the same cursor. The overflow regression initially received no reconciliation update, and the wrong-family regression initially rejected the later complete baseline.
3. CMD refresh returned only the page-call Promise and ran on the normal 15-second cadence. There was no provider-local attempt/deadline/document state, so `busy` or `baseline-requested` could not be distinguished from a matching completed response and could wait a full cadence before retrying.

## RED evidence

All commands were focused. The initial missing-module collection error for the new recovery file was scaffold-only and is not counted as RED evidence.

| Cycle | Command | Exact RED result |
| --- | --- | --- |
| Pre-baseline delta then lower full baseline | `npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/cmd-http-adapter.test.ts` | 1 failed assertion, 6 passed (7 total) |
| Bounded pending overflow and reconciliation | same API command | 1 failed assertion, 7 passed (8 total) |
| Overflow must not poison the next lower full baseline | same API command | 1 failed assertion, 7 passed (8 total) |
| Rejected pre-baseline function family must not poison the cursor | same API command | 1 failed assertion, 8 passed (9 total) |
| Recovery cap/deadline/document/completion state | `npm.cmd test --workspace @tool-chenh/chrome-extension -- src/cmd-recovery-state.test.ts` | 5 failed assertions (5 total) after executable stub |
| Explicit complete-`fc=1` correlation contract | same recovery command | 2 failed assertions, 3 passed (5 total) |
| Immediate non-overlapping poller recovery | `npm.cmd test --workspace @tool-chenh/chrome-extension -- src/cmd-snapshot-poller.test.ts` | 1 failed assertion, 16 passed (17 total) |

## GREEN evidence

- `npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/cmd-http-adapter.test.ts`
  - 1 test file passed; 9 tests passed; 0 failed.
- `npm.cmd test --workspace @tool-chenh/chrome-extension -- src/cmd-snapshot-poller.test.ts src/cmd-recovery-state.test.ts`
  - 2 test files passed; 22 tests passed; 0 failed (17 poller and 5 recovery-state tests).

## Authority, baseline, and delta invariants covered

- Only a complete atomic `fc=1` running-plus-today body can emit CMD `BASELINE` authority.
- Before the first baseline, supported deltas are retained as normalized operations only, bounded to 32 responses and 256 operations. They do not advance the committed provider cursor and no raw provider body is retained.
- A lower-cursor complete baseline commits after newer supported buffered deltas are applied in provider-cursor/receipt order; the emitted authoritative catalog includes the replayed state.
- Overflow, duplicate pending cursors, unsupported pending shapes, or replay that cannot apply fail closed and request reconciliation once. Untrusted pending evidence is discarded, so the next valid complete baseline is not permanently blocked even when its cursor is lower.
- Rejected pre-baseline function families do not advance the committed cursor. After baseline, stale/equal cursor replay remains rejected and existing wrong-family/malformed/reset fail-closed behavior remains covered.
- `CmdRecoveryState` permits one active session per CMD source, matches source epoch/frame/loader identity, and has both a fixed attempt cap and absolute deadline.
- `busy` and `baseline-requested` only finish an attempt; neither resolves success. Success requires an explicit `providerFunctionCode: 1`, `responseComplete: true`, matching-document completion and resolves exactly once.
- Document/epoch replacement, abort, release, attempt cap, and deadline are terminal and prevent later attempts or completion.
- `CmdSnapshotPoller` schedules the CMD recovery callback immediately, shares the normal catalog cadence/in-flight gate so it cannot overlap, and preserves the existing `refreshCatalog` fallback until shared wiring is installed.

## Shared integration request

- Shared symbol/file: `apps/chrome-extension/src/network-observer.ts` — add the observer-owned `recoverCmdCatalog(source: ObservedSource): Promise<void>` path and its CMD response-completion hook; at the integrator-owned `CmdSnapshotPoller` construction site, pass that method as `recoverCmdCatalog`.
- Provider-local output already implemented: `CmdRecoveryState`/`CmdRecoverySession`, `CmdRecoveryCompletion`, terminal attempt/deadline/document semantics, and `CmdSnapshotPollerDependencies.recoverCmdCatalog` with cadence/in-flight coalescing.
- Exact shared input/wiring required:
  1. Keep one `CmdRecoveryState` owned by the observer. For a CMD source, resolve the exact current frame, current loader, source epoch/generation, and the child CDP session that owns that frame; never default `Runtime.evaluate` to the top-level session when the frame belongs to a child session.
  2. Snapshot `{ sourceId, sourceEpoch, frameId, loaderId }` and call `begin` with fixed `maxAttempts`, `nowMs`, and `deadlineMs`. A second request for the same identity must reuse the active session; a changed epoch/frame/loader must retire the old session before starting replacement work.
  3. Before and after every await—frame lookup, owning-session lookup, retry wait, `Runtime.evaluate`, request completion, and response-body retrieval—re-read source generation and current loader. On mismatch call `abort`/start the replacement session, stop the old loop, and ignore all late results.
  4. Drive `nextAttempt`; run the existing CMD page expression only on an `ATTEMPT` step through the owning child session. Feed only `busy` or `baseline-requested` to `recordPageResult`. Neither page result may resolve the returned recovery Promise.
  5. Correlate request start through loading completion/body retrieval for exactly one CMD DataOdds response with `fc=1` on the same source epoch, frame, loader, and owning session. Set `responseComplete: true` only after the response completed and its body was retrieved/validated as the complete current-document body; then call `complete`. Wrong function codes, wrong/retired loaders or sessions, partial/error bodies, and duplicate completion must be ignored.
  6. Schedule deadline expiry even while an evaluate/body operation is pending. Resolve the observer Promise once on success or terminal failure, cancel retry/deadline work, and release state on source detach. Diagnostics may include only outcome/reason, attempt count, and bounded timing; they must not include raw URL, frame/loader/session identifiers, response body, cookies, credentials, or launch material.
  7. Do not add reload, navigation, focus, tab replacement, or debugger-recovery actions to this path.
- RED integration test the integrator must add: in `apps/chrome-extension/src/network-observer.test.ts`, add `evaluates CMD recovery on the owning child session and completes only matching current-loader fc=1`. Use fake parent/child sessions; prove the parent never evaluates, `busy -> baseline-requested` stays pending, wrong-loader/wrong-function/partial completions are ignored, the matching completed body resolves once, and a loader/source-generation change between awaits aborts all later evaluate/completion work.
- Safety invariant: page-call acknowledgement never renews authority; only one current-document complete `fc=1` body observed through the owning session can resolve recovery, and every retry/completion is bounded, loader-fenced, generation-fenced, idempotent, non-disruptive, and redacted.
- Focused command: `npm.cmd test --workspace @tool-chenh/chrome-extension -- src/network-observer.test.ts src/cmd-snapshot-poller.test.ts src/cmd-recovery-state.test.ts`

## Verification, concerns, and prohibited-action confirmation

- `git diff --check` exited 0 for the CMD whitelist; a separate scan covered new untracked recovery files. Added-code scans found no credentials, launch URLs, cookies, authentication material, raw provider bodies, private keys, or long encoded payloads.
- Coordination base `f6e25d4` remained an ancestor and HEAD remained `f6e25d44296bad2b5e6c88cbc8d92eac47ca26a1`.
- Remaining blocker: the shared observer/session/loader/completion wiring above is integrator-owned. Live CMD authority and runtime recovery have not been tested or claimed by this worker.
- This worker performed no Git mutation, build, generated/dist edit, process start/stop/restart, runtime API call, browser/tab action, DevTools/debugger action, `.auth` access, `network-observer.ts` read/edit, or other-provider file edit.
