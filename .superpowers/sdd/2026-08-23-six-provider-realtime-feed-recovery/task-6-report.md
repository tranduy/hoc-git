# Task 6: SABA and SBOBET Stream Recovery — DONE

Date: 2026-08-24

Workspace: `F:/0. PROJECT/tool-chenh/.worktrees/six-provider-realtime-feed`

Branch / starting HEAD: `feat/six-provider-realtime-feed` / `9148418a45e32ae570f4727ac12d91c2cc8cda50`

## Outcome

SABA and SBOBET/KSPORT now establish `LIVE` only from complete, current-epoch network evidence. SABA requires the current Socket.IO stream to be `OPEN` and to commit a fresh reset/done generation. SBOBET requires both KSPORT `live` and `today` partitions in the same source epoch; a valid empty partition still completes its side of the baseline.

Unknown post-MV3 socket request IDs are no longer silently dropped. The extension requests one provider-scoped, same-tab socket baseline recovery per source epoch through the existing bounded provider lane. It does not reload or navigate a tab and does not restart the browser, extension, or API. Task 3 remains responsible for escalation when a fresh authoritative baseline misses its deadline.

Durable SABA replay may prime decoder state, and the bounded two-generation DOM capture may provide fallback deltas, but neither path establishes authority or renews `LIVE`. A fresh socket baseline is still required. Retired SABA/SBOBET sockets and old source epochs are fenced from replacement state, and SABA retained partitions and authority expire after the maximum baseline age.

## TDD record

Focused RED was captured before production changes:

- Initial Task 6 API RED: SABA realtime and KSPORT focused suites had 4 failed / 18 passed. The expanded SABA/KSPORT run had 7 failed / 28 passed, covering authority annotations, epoch partition mixing, replay/DOM provenance, and retained age.
- Initial extension RED: unknown SABA request recovery had 1 failed / 162 passed. The expanded snapshot/recovery run had 5 failed / 164 passed, including the obsolete replay-only SABA snapshot expectation.
- SBOBET completed-empty partition RED: `ksport-ws-adapter.test.ts` had 1 failed / 17 passed because an empty `today` response was discarded before partition commit.
- Retired SABA socket RED: the focused regression had 1 failed / 15 skipped because a late old-stream snapshot was merged into replacement state.

Final GREEN:

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/saba-ws-adapter.test.ts src/chrome-bridge/saba-ws-realtime-regression.test.ts src/chrome-bridge/ksport-ws-adapter.test.ts src/chrome-bridge/automatic-source-recovery.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/network-observer.test.ts src/saba-snapshot-recovery.test.ts src/source-tab-recovery.test.ts
```

```text
Task 6 API: 4 suites / 53 tests passed.
Task 6 extension: 3 suites / 169 tests passed.
```

Task 1–5 relevant regressions:

```text
Task 5 CMD/IM/data-plane API: 5 suites / 78 tests passed.
Task 1–4 recovery/control/registry/coverage/server API: 7 suites / 72 tests passed.
Extension local bridge and CMD poller lanes: 2 suites / 41 tests passed.
```

Compile/build and hygiene gates:

```powershell
npm.cmd run typecheck --workspace @tool-chenh/contracts
npm.cmd run typecheck --workspace @tool-chenh/api
npm.cmd run typecheck --workspace @tool-chenh/chrome-extension
npm.cmd run build --workspace @tool-chenh/contracts
npm.cmd run build --workspace @tool-chenh/api
npm.cmd run build --workspace @tool-chenh/chrome-extension
git diff --check
```

All six typecheck/build commands exited 0. `git diff --check` exited 0 with only the checkout's existing LF-to-CRLF notices. The hygiene scan found only synthetic secret-like values in existing redaction and source-tab tests; no real credential, provider response body, header, cookie, or account data was added.

## Files changed

- `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- `apps/api/src/chrome-bridge/saba-ws-adapter.test.ts`
- `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/chrome-extension/src/network-observer.test.ts`
- `apps/chrome-extension/src/saba-snapshot-recovery.test.ts`
- `apps/chrome-extension/src/source-tab-recovery.test.ts`
- `.superpowers/sdd/2026-08-23-six-provider-realtime-feed-recovery/task-6-report.md`

`source-tab-recovery.ts` required no production edit: its approved Task 3 behavior already creates only the missing KSPORT `about:blank` target, attaches observation before navigation, and preserves non-KSPORT tabs. Task 6 added the targeted regression.

## Recovery, authority, and ordering semantics

- SABA decoder, partitions, readiness, active socket, authority generation, and retained ages are source-epoch scoped. A replacement socket retires the prior stream; its frames and close callbacks cannot mutate or invalidate the replacement.
- SABA replay and DOM evidence remain `DELTA`/fallback evidence. Only a non-replayed reset/done on the current `OPEN` stream emits `authoritativeBaseline: true`, `evidenceMode: "BASELINE"`, and `provenance: "WS"`.
- SABA A003 and revision gaps invalidate with `PROVIDER_STREAM_GAP`; active close invalidates with `PROVIDER_STREAM_CLOSED`. Expired authority cannot be renewed by a delta.
- SBOBET routing remains exact: lobby `KSPORT`, provider `SBOBET`, and provider-specific socket/HTTP partitions are not conflated with another lobby. HTTP and STOMP state are source-epoch scoped, and both `live` and `today` must be present before publication.
- Full SBOBET partition snapshots advance authoritative generations; event-level STOMP updates retain the generation as deltas. Closed and retired streams do not publish.
- Orphan reconnect work uses the existing keyed provider scheduler and global bounds. No global navigation, reload, or cross-provider recovery path was introduced.

## Concerns and deferred boundaries

- The Task 5 deferred equal-CMD-cursor and AbortSignal-aware IM signer minors remain unchanged; Task 6 did not require them.
- SABA DOM remains viewport-derived and intentionally non-authoritative even after stable two-generation coverage. It can preserve a stale/fallback view while Task 3 recovery seeks current network authority, but it cannot make the provider executable.
- No browser/provider/runtime action was performed for this task.

## Commit

Commit subject: `fix(feed): recover SABA and SBOBET authoritative streams`.
