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

---

## Review Round 1

Status: DONE

Review base: `fac06a6`

### Review findings resolved

- The legacy `SbobetSocketIoCatalogAdapter` is no longer in `ChromeCatalogDataPlane`'s trusted router. A single `/socket.io/` frame from either SBOBET-classified lobby therefore cannot bypass KSPORT's current-epoch, two-part baseline proof. The decoder remains isolated and unit-tested, but it has no path to establish feed authority.
- The data plane rejects a retired source epoch before touching active-source selection, adapters, body assembly, coverage, or the feed controller. Retirement memory is bounded to 32 epochs per source and 128 source IDs; source handover and same-source epoch replacement both retire the displaced epoch before reset.
- KSPORT WS now separates committed partitions from one explicit pending baseline generation. A full partition starts or updates the pending generation; only matching `live` plus `today` commits atomically. Natural deltas bind only the committed generation and are rejected while a replacement baseline is incomplete.
- KSPORT HTTP recovery now emits a canonical same-request pair, `ksport-http:<tabId>:<positive ordinal>:<partition>`. The adapter validates canonical decimal form and tab identity, scopes the generation by source epoch, retires lower/equal ordinals, and commits only the matching pair.
- Duplicate `OPEN` for the active SABA or KSPORT stream is a no-op. `OPEN` for a retired stream is ignored, so delayed lifecycle callbacks cannot clear or replace current authority.
- A proven complete empty network baseline is now authoritative. SABA requires current `OPEN` plus empty/reset and done; KSPORT requires both valid partitions of the matching pending generation. Partial empty/reset and empty deltas remain silent. End-to-end tests prove a prior nonempty catalog stays readable until completion, then becomes a newer readable `LIVE` empty catalog.

### Ruling and cost

The approved ruling removes legacy SBOBET Socket.IO from trusted authority rather than attempting to infer reset/done and partition semantics that transport does not expose. The cost is deliberate: an SBO-classified Socket.IO page cannot make SBOBET `LIVE`; only the recognized, fenced KSPORT WS/HTTP path can do so.

Atomic KSPORT replacement also trades immediacy for correctness. A single refreshed full partition remains pending and cannot tombstone or authorize against the other partition from an older generation. Publication waits for its matching counterpart. Natural HTTP observations with the former uncorrelated `ksport-http:live|today` IDs are non-authoritative; the bounded same-tab recovery path supplies the canonical paired request IDs.

No tab was reloaded or navigated, and no browser, extension, API process, provider runtime, or external service was restarted or mutated in this review round.

### Review Round 1 RED

Tests were written and run before the corresponding production changes:

```text
Critical data-plane findings: 2 failed / 22 skipped.
  A legacy Socket.IO full frame made SBOBET LIVE.
  Late epoch A invalidated/reset current epoch B before the controller rejected A.
KSPORT generation and OPEN findings: 4 failed / 18 skipped.
  A new full live partition combined with committed old today; canonical HTTP pairs were not recognized;
  duplicate current OPEN reset authority; delayed retired OPEN replaced the active stream.
SABA OPEN findings: 2 failed / 5 skipped.
  Duplicate current OPEN discarded the decoder; delayed retired OPEN displaced the replacement stream.
Extension canonical KSPORT request ID: 1 failed / 137 skipped.
SABA proven-empty baseline: 1 failed / 7 skipped.
```

The KSPORT delayed-OPEN RED also proved that a complete all-empty pair was discarded. A separate end-to-end nonempty → partial empty → complete empty regression passed only after the same baseline implementation. One older data-plane test then failed because it expected a single refreshed KSPORT partition to tombstone immediately; it was updated to the reviewed two-part atomic contract.

### Review Round 1 GREEN

Task 6 focused suites:

```text
API: 5 suites / 85 tests passed.
Chrome extension: 3 suites / 169 tests passed.
```

Task 1–5 regressions:

```text
Task 5 CMD/IM/data-plane API: 5 suites / 81 tests passed.
Task 1–4 recovery/control/registry/data-plane/coverage/server API: 8 suites / 97 tests passed.
Extension observer/scheduler/bridge/storage/poller/wakeup: 6 suites / 187 tests passed.
Contracts chrome-bridge: 1 suite / 14 tests passed.
```

Compile/build and hygiene:

```powershell
npm.cmd run typecheck --workspace @tool-chenh/contracts
npm.cmd run typecheck --workspace @tool-chenh/api
npm.cmd run typecheck --workspace @tool-chenh/chrome-extension
npm.cmd run build --workspace @tool-chenh/contracts
npm.cmd run build --workspace @tool-chenh/api
npm.cmd run build --workspace @tool-chenh/chrome-extension
git diff --check
git diff -- . ':!*.md' | rg -n -i "authorization|cookie|password|bearer|session[_-]?id|access[_-]?token|refresh[_-]?token|api[_-]?key"
```

All six typecheck/build commands exited 0. `git diff --check` exited 0 with only the checkout's existing LF-to-CRLF notices. The hygiene scan returned no matches.

Supplemental whole-package verification passed all contracts tests (95/95) and all extension tests (357/357). The whole API package run reached only two failures, both pre-existing Windows-host assumptions in untouched files: `local-app-data.test.ts` expects POSIX separators for a macOS fixture path, and `local-key-protector.test.ts` expects a POSIX `0600` mode from Windows `stat`. All required API focused and Task 1–5 regression suites above passed; these unrelated platform assertions were not changed as part of this scoped review.

### Files changed in Review Round 1

- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/chrome-extension/src/network-observer.test.ts`
- `.superpowers/sdd/2026-08-23-six-provider-realtime-feed-recovery/task-6-report.md`

Commit subject: `fix(feed): fence SBOBET recovery generations`.

---

## Review Round 2

Status: DONE

Review base: `f14ed85`

### Findings resolved

- Retired source epochs no longer live in an evicting ID list. `ChromeBridgeRegistry` assigns each authenticated bridge connection a monotonically increasing server-side generation and permanently rejects any older connection before publishing to listeners. The data plane receives that context and retains one exact source-lineage record: current connection generation, canonical observer-session prefix, current epoch, and numeric suffix high-watermark. Within a connection, only the exact current epoch or a strictly higher canonical suffix in the same lineage is admitted. A newer connection may establish a new lineage; its predecessor can never reclaim the source.
- This is an exact bounded fence, not a probabilistic one. State is one scalar plus weak connection identities in the registry and one fixed-size lineage record per source in the data plane; it does not grow with epoch count and never evicts evidence needed to reject an old epoch. A 34-replacement regression proves epoch 0 remains rejected after the former 32-entry boundary while the generation-33 feed remains readable.
- KSPORT WS uses the decoded positive provider receipt sequence as the baseline generation. Full `live` and `today` partitions commit only when their receipt generation is exactly equal. A higher receipt starts a new pending generation, a lower/mixed receipt is ignored, and deltas remain bound to the committed generation only.
- KSPORT HTTP requires canonical decimal tab and positive ordinal components, safe integer values, exact tab identity, and exact pending-generation string equality. `ksport-http:8:1:live` cannot pair with `ksport-http:08:1:today`.
- A current-stream SABA `empty/done` baseline is a complete provider replacement rather than an empty bridge shard. Before publication it removes every retained source-epoch partition and retires prior bridge readiness, so data from another bridge cannot survive the empty catalog. Partial and delta empties remain silent, while nonempty parallel bridge snapshots retain their approved union behavior.

### RED

Tests were added and observed failing before their production changes:

```text
Exact epoch/connection fence: 2 failed / 32 skipped.
  Epoch 0 reopened after 34 same-session generations and invalidated the current feed.
  A superseded authenticated connection reclaimed its source and was ACKed/published.
KSPORT WS mixed receipt generations: 1 failed / 22 skipped.
  live@200 plus today@150 emitted an authoritative baseline.
KSPORT HTTP canonical identity: 1 failed / 23 skipped.
  ksport-http:08:1:today completed a pending ksport-http:8:1 generation.
SABA cross-bridge complete empty: 1 failed / 8 skipped.
  After supplying the replacement bridge's required field table, empty/done published the old bridge's retained event instead of an empty catalog.
```

The first SABA fixture attempt omitted the new bridge's field table and therefore failed before reaching the reviewed behavior. The attempted production edit was removed, the fixture was corrected, and RED was rerun to observe the retained-old-bridge failure before the final implementation was applied.

### GREEN and regression matrix

```text
Task 6 focused API: 7 suites / 109 tests passed.
Task 6 focused extension: 3 suites / 169 tests passed.
Task 5 CMD/IM/data-plane API: 5 suites / 82 tests passed.
Task 1-4 recovery/control/registry/data-plane/coverage/server API: 8 suites / 98 tests passed.
Task 1-5 extension observer/scheduler/bridge/storage/poller/wakeup: 6 suites / 187 tests passed.
Contracts chrome-bridge: 1 suite / 14 tests passed.
```

All contracts, API, and extension typechecks exited 0. All three builds exited 0. `git diff --check` exited 0 with only the checkout's LF-to-CRLF notices, and the scoped secret scan returned no matches.

### Files changed in Review Round 2

- `apps/api/src/chrome-bridge/chrome-bridge-registry.ts`
- `apps/api/src/chrome-bridge/chrome-bridge-registry.test.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`
- `apps/api/src/server.ts`
- `.superpowers/sdd/2026-08-23-six-provider-realtime-feed-recovery/task-6-report.md`

No schema was guessed, no global reload/navigation/restart was introduced, and no browser/provider/runtime or external action was performed. The deliberate cost of exact connection ownership is fail-closed behavior for a noncanonical epoch transition on the same connection; the shipped observer emits the characterized canonical `<observer-session>:<generation>` form.

Commit subject: `fix(feed): enforce exact recovery lineages`.
