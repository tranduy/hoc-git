# Task 5: CMD and IM Authoritative Realtime Paths — DONE

Date: 2026-08-23

Workspace: `F:/0. PROJECT/tool-chenh/.worktrees/six-provider-realtime-feed`

Branch / starting HEAD: `feat/six-provider-realtime-feed` / `8388a5833637d6834f069cab995cf5b0f24812bc`

## Outcome

The former evidence blocker was resolved after the user authorized a controlled reload of the exact authenticated CMD tab. The tab was resolved read-only as `chrome:CMD:2105814342`, host `cgnew.fts368.com`, top path `/BasePage/home.aspx`. No other provider tab was reloaded or navigated, and no browser, extension, or API process was restarted.

The authorized audit recovered CMD's loaded startup handler and captured the provider's exact `fc=1` running-plus-today response. The handler establishes an atomic full baseline by clearing prior data, applying both `data` and `today`, setting both full-data completion flags, and adopting response cursor `t`. Its incremental handler rejects `a=false` and schedules the same full reconciliation. That evidence unblocked a strict network adapter without guessing positional fields.

Task 5 now provides:

- an exact-host/path CMD HTTP adapter with atomic baseline, monotonic provider cursor, characterized price deltas, stable provider IDs, and fail-closed unknown commands;
- a 15-second CMD provider-defined full reconciliation, before the 20-second authoritative-baseline deadline;
- CMD DOM fallback that cannot overwrite or refresh authenticated network authority, preserves per-record quote clocks, and does not refresh identical visible rows;
- IM atomic Market 1 + Market 2 generations, late-generation rejection, and replay of natural deltas received after an in-flight baseline begins;
- bounded IM signed reads with an 8-second abort deadline;
- CMD and IM work isolated by the existing keyed provider lanes.

## Sanitized authoritative evidence

Only scrubbed structural facts, public catalog fields, aggregate counts, and hashes were retained. No raw response, header, request query, cookie, credential, account identifier, browser-storage value, or user data was persisted in the repository or report.

| Evidence | Sanitized provenance / finding | SHA-256 |
| --- | --- | --- |
| Loaded CMD startup JavaScript | Exact authenticated tab, already-loaded source; 676,190 characters. Defines `DataOdds.ashx`, `fc` full/delta codes, callback reset/completion behavior, positional mappings, and `a=false` recovery. | `89b36e6c18da1ecd605ef8417566fc128bcc979d5cae6bca14f036b2f6b09a31` |
| CMD `fc=1` full response | Exact `/Member/BetsView/BetLight/DataOdds.ashx`; root keys `{t,a,data,today,f}`; `t=8281247`, `a=true`; 208 running rows + 763 today rows; 971 unique public IDs. There were 970 characterized 91-position price rows and one provider metadata aggregate. | `a4110f5dd4ecd36633e5a6de26f1cfb95fd62454445ceb14cc2686ed4fab64fb` |
| Full-response public ID set | Sorted 971-ID set used only for coverage comparison. | `ea352492d5523d0691caaaf07c58b8463679b66ec594cc426cde577a4a766b5c` |
| Minimal full-row fixture | One 91-position public catalog row, reduced to decoder-used positions only. | `f263d6ef5165546d72a37c144627b5d53a15a1eb8eb208eec429ffcf234cc731` |
| Minimal FT-total line delta | Public event `25299763`, characterized provider command `33`; row shape `[event,sport,command,line,odd,odd,...]`. | `0b165091221bfa9087cee03d9193f3c08b103d59cc4a98f392814d935afc1ac4` |
| Minimal FT-total odds delta | Same public event, characterized provider command `35`; exact selection prices retained in the fixture. | `854e50a57ae849d81113d3f85efcba6c86a38eeefbc9ef2c22bf4a686dfb04b6` |

The provider handler defines full codes `1/2/4/6`, incremental codes `3/5/7`, and these characterized football price commands: FT AH line/odds `28/30`, FT total `33/35`, FH AH `38/40`, and FH total `43/45`. The decoder ignores every other command shape while still advancing the verified cursor so a late characterized frame cannot roll state backward.

The full response covered 971 public IDs versus approximately 136–150 simultaneously observable public/virtualized-page IDs in the scoped tab. Completeness does not depend on that count comparison: it comes from the provider's `fc=1` callback, which clears old state and sets both running/today full-data flags only after both arrays are applied. The comparison confirms the network generation materially covers offscreen events that DOM cannot establish.

The full-response cursor is a provider version, not a timestamp. It is encoded in generation `cmd:<t>` and used only for ordering; `providerTimestampMs` remains null.

The capture clipboard was cleared immediately after the bounded extraction and verified empty. DevTools was closed on the exact CMD window after the audit, releasing debugger ownership back to the existing extension. No raw provider body remains on the clipboard or in the worktree.

## TDD record

Focused RED was captured before each production change:

- Initial API RED: `npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/cmd-http-adapter.test.ts src/chrome-bridge/cmd-dom-adapter.test.ts src/chrome-bridge/im-http-adapter.test.ts` — 3 suites failed: missing CMD HTTP module plus 4 assertions; 15 tests already passed.
- Extension RED: `npm.cmd test --workspace @tool-chenh/chrome-extension -- src/network-observer.test.ts src/cmd-snapshot-poller.test.ts` — 2 failed / 136 passed (missing IM abort and bounded-lane behavior).
- Integration REDs: authenticated CMD overwritten by DOM (1 failed / 16 passed); identical DOM refreshed quote clocks (1 failed / 7 passed); unseen lower IM generation accepted (1 failed / 12 passed); CMD full reconciliation absent (2 failed / 138 passed).
- Final ordering RED: `npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/cmd-http-adapter.test.ts` — 1 failed / 4 passed, proving an unknown CMD command did not yet close the late-frame cursor window.

Final GREEN:

- Task 5 API: 4 suites / 43 tests passed.
- Task 5 extension: 3 suites / 145 tests passed.
- Task 1–4 API regressions: 8 suites / 89 tests passed.
- Task 1–4 extension regressions: 6 suites / 173 tests passed.
- API typecheck and build: passed.
- Chrome extension typecheck and build: passed.
- `git diff --check`: passed (only Git's existing LF-to-CRLF checkout notices).
- Required fixture scan below: no matches.

```powershell
rg -n -i "cookie|authorization|token|password|session|launch|query" apps/api/src/chrome-bridge/cmd-http-adapter.test.ts
```

## Files

Created:

- `apps/api/src/chrome-bridge/cmd-http-adapter.ts`
- `apps/api/src/chrome-bridge/cmd-http-adapter.test.ts`

Modified:

- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- `apps/api/src/chrome-bridge/cmd-dom-adapter.ts`
- `apps/api/src/chrome-bridge/cmd-dom-adapter.test.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/chrome-extension/src/network-observer.test.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`

`cmd-dom-snapshot.ts` required no production change: its existing legacy extractor already derives disabled state from `no-hover` and `aria-disabled`; Task 5 added `class` and `aria-disabled` to the mutation observer that decides when to recapture it.

## Latency and cadence semantics

- CMD natural `DataOdds.ashx` deltas remain the fast path. A provider cursor lower than the latest observed cursor is rejected. `a=false` invalidates authority immediately and waits for a complete full response.
- CMD full reconciliation runs every 15 seconds, independently of DOM polling and before the 20-second baseline limit. It invokes only the observed `LoadFullRunningTodayData()` in the exact odds frame; it does not reload or navigate.
- CMD DOM is overlay/fallback evidence only. It never establishes `LIVE`, cannot renew authoritative freshness, retains per-record observation clocks, and emits nothing for identical visible rows. Virtualized omission alone is not treated as a removal.
- IM natural `GetSEDelta` is the fast path. A signed two-part GetSE reconciliation runs every 15 seconds. Market signing/fetch stays sequential because signer independence was not proven, and each attempt is bounded by an 8-second abort.
- A newer IM delta received after a pending generation's first partition is buffered and reapplied after both partitions commit. Older/retired generation parts are rejected. No generic heartbeat renews either provider's freshness.
- CMD and IM use per-source keyed lanes; a hung IM read does not block CMD capture/reconciliation or BTI/TSPORT work.

## Concerns and deliberate fail-closed boundaries

- CMD positional decoding is intentionally limited to the eight observed price command codes and the characterized 91-position event row. Unknown commands are cursor-ordered but not published; removals/status transitions therefore reconcile at the next full response unless later characterized from authoritative evidence.
- CMD DOM cannot prove offscreen deletion. Cached fallback rows age naturally and remain non-executable rather than being deleted by a viewport timer.
- IM signed Market 1/2 requests remain sequential. The abort deadline prevents indefinite lane occupation; concurrency should be enabled only after the page signer is proven reentrant.

## Commit

Production/test commit: `8fa4aca` (`fix(feed): make CMD and IM updates authoritative and ordered`).

---

## Fix Round 1

Status: DONE

Review base: `fc49184`

### Review findings resolved

- A CMD `a=false` gap now clears baseline authority without retiring the current source epoch. The adapter retains the provider cursor as the recovery lower bound, rejects all deltas while gapped, rejects a late pre-gap `fc=1`, and accepts a newer same-epoch complete `fc=1` baseline back to `LIVE`.
- IM allocates and announces the reconciliation generation and bridge cutoff before the first signed Market 1 fetch starts. Deltas newer than that cutoff are retained in a bounded per-source log and replayed after both partitions commit, including a delta received before the first synthetic partition envelope exists.
- The observer carries only sanitized numeric CMD `fc` metadata. The adapter explicitly separates full codes `1/2/4/6` from delta codes `3/5/7`, authorizes only the characterized atomic `fc=1` running-plus-today contract, and rejects a full body on the wrong code, partial bodies, and any unexplained malformed baseline row.
- Nonempty IM partitions use accepted/rejected classification. Malformed events, supported-market entries, or selections reject the partition rather than filtering into an authoritative empty catalog; structurally valid out-of-window, cyborg, or unsupported-domain records remain explained exclusions.
- CMD DOM evidence is silent while network authority is `LIVE`. Once that authority is stale, DOM can overlay visible event identity and status only; network prices, provider IDs, quote clocks, and catalog observation time retain precedence. The overlay remains `DOM_FALLBACK`, publishes `STALE`, and never renews authority.
- CMD virtualized capture now carries an explicit sweep ID/completion boundary. The adapter retains partial viewport rows and their clocks, accumulates visited IDs for the sweep, and removes only pre-sweep omissions after a provider-side complete boundary.
- SABA class mutations dirty the DOM observer only when semantic disabled/locked class state changes. Hover/animation class churn is ignored; `data-odds-status`, `data-grey-out`, and `aria-disabled` remain semantic triggers.

The prior sanitized CMD evidence and hashes above are unchanged. No provider tab/runtime action was needed in this fix round, and no raw headers, cookies, tokens, credentials, user data, or response bodies were added.

### Fix Round 1 RED

Focused tests were added before production fixes and run against `fc49184`:

```powershell
npm.cmd test --workspace @tool-chenh/contracts -- src/chrome-bridge.test.ts
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/cmd-http-adapter.test.ts src/chrome-bridge/im-http-adapter.test.ts src/chrome-bridge/cmd-dom-adapter.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- src/network-observer.test.ts
```

```text
Contracts: 1 failed / 13 passed (new safe fc/cutoff/sweep metadata rejected).
API: 6 failed / 43 passed after correcting one test-helper syntax error.
  CMD fc/schema: 1 failed / 5 passed.
  IM pre-first-partition race: 1 failed / 13 passed.
  CMD DOM sweep: 1 failed / 8 passed.
  Data plane gap/overlay/malformed IM: 3 failed / 17 passed.
Extension observer: 4 failed / 124 passed.
  Missing pre-fetch IM generation announcement, CMD fc propagation, sweep-boundary propagation,
  and SABA hover-class filtering each failed once.
```

The end-to-end gap test exercised `fc=1 -> a=false/fc=3 -> late pre-gap fc=1 -> newer same-epoch fc=1`. The IM race held the page-side fetch promise before the first synthetic partition while injecting a newer natural delta.

### Fix Round 1 GREEN

```powershell
npm.cmd test --workspace @tool-chenh/contracts -- src/chrome-bridge.test.ts
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/cmd-http-adapter.test.ts src/chrome-bridge/cmd-dom-adapter.test.ts src/chrome-bridge/im-http-adapter.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- src/cmd-dom-snapshot.test.ts src/cmd-snapshot-poller.test.ts src/network-observer.test.ts
```

```text
Contracts: 1 suite / 14 tests passed.
Task 5 API: 4 suites / 49 tests passed.
Task 5 extension: 3 suites / 149 tests passed.
```

Task 1-4 regressions:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/automatic-source-recovery.test.ts src/chrome-bridge/provider-source-refresh.test.ts src/chrome-bridge/chrome-bridge-control-plane.test.ts src/chrome-bridge/provider-feed-controller.test.ts src/chrome-bridge/provider-feed-registry.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts src/catalog/catalog-coverage-guard.test.ts src/server.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- src/provider-work-scheduler.test.ts src/local-bridge.test.ts src/network-observer.test.ts src/saba-snapshot-storage.test.ts src/cmd-snapshot-poller.test.ts src/bridge-wakeup.test.ts
```

```text
API: 8 suites / 92 tests passed.
Extension: 6 suites / 177 tests passed.
```

Compile/build and hygiene gates:

```powershell
npm.cmd run build --workspace @tool-chenh/contracts
npm.cmd run typecheck --workspace @tool-chenh/api
npm.cmd run build --workspace @tool-chenh/api
npm.cmd run typecheck --workspace @tool-chenh/chrome-extension
npm.cmd run build --workspace @tool-chenh/chrome-extension
rg -n -i "cookie|authorization|token|password|session|launch|query" apps/api/src/chrome-bridge/cmd-http-adapter.test.ts
git diff --check
```

All compile/build commands exited 0. The fixture secret scan returned no matches. `git diff --check` exited 0 with only the checkout's existing LF-to-CRLF notices.

### Ordering, cadence, and isolation after review

- CMD natural delta cadence is unchanged. A gap is recoverable only by a complete, current, newer `fc=1`; generic transport and DOM evidence cannot end the gap or renew `LIVE`.
- IM natural deltas remain the fast path. The cutoff is the last source bridge sequence before the reconciliation-start diagnostic; every later natural delta is replay-eligible even while both same-page signed requests are still pending. The retained delta log is bounded to 128 envelopes.
- CMD DOM sweeps are explicit and provider-side. Partial captures never tombstone; a completion marker closes only its matching sweep generation. DOM overlays preserve network price/clocks and remain non-authoritative.
- CMD and IM continue through the existing keyed provider scheduler lanes. No global heavy-work tail or cross-provider wait was introduced; the Task 1-4 scheduler regressions remain green.

### Deferred minors and concerns

- Equal CMD cursor idempotence and AbortSignal-aware IM signer plumbing remain deferred exactly as review ledgered; neither was broadened into this round.
- Full-family CMD codes `2/4/6` are recognized but remain fail-closed because only `fc=1` has an observed atomic running-plus-today completion contract. No unobserved partition semantics were inferred.
- Unsupported IM market domains and valid out-of-window events are excluded deliberately; malformed supported event/market/selection entries reject their entire nonempty partition.

---

## Fix Round 2

Status: DONE

Review base: `4d89b04`

### Review findings resolved

- IM now retains a bounded, source-scoped log of ordered natural deltas even before the first catalog exists. When the first signed two-part reconciliation completes, only deltas newer than its announced bridge cutoff are replayed. A source reset discards the log, and non-increasing delta sequences are rejected.
- IM validates the required event, identity, timing, flag, and market structure before treating `iscyb: true` as a characterized exclusion. An unexplained nonempty selection partition is rejected, and a two-part generation with input but no accepted or characterized catalog record cannot authorize an empty baseline.
- CMD DOM-on-DOM updates now publish the adapter's accumulated fallback catalog directly. Identity/status overlay is used only when the retained basis is authenticated network evidence. A proven completed DOM sweep can remove omitted fallback records without making the catalog `LIVE` or refreshing authoritative freshness.
- CMD sweep markers and records are paired per CDP frame. The extension emits frame-keyed CMD snapshots, the contract validates the frame key, and the adapter retains independent visited sets and record ownership per frame. A completion from one document cannot tombstone another frame's records; a source-epoch replacement rejects an in-flight old-document result.

The previously captured CMD evidence and hashes are unchanged. This round performed no browser/provider/runtime action and added no response fixture, header, cookie, token, credential, account identifier, user data, or provider response body.

### Fix Round 2 RED

Focused tests were added before their production fixes and run against `4d89b04`:

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/im-http-adapter.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts
npm.cmd test --workspace @tool-chenh/contracts -- --run src/chrome-bridge.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/network-observer.test.ts
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/cmd-dom-adapter.test.ts -t "does not let one completed frame sweep tombstone records owned by another frame"
```

```text
API IM/data-plane: 3 failed / 35 passed.
  First-ever IM reconciliation committed baseline price 0.60 instead of replaying delta price 0.84.
  An iscyb-only malformed partition authorized an empty baseline.
  CMD DOM-only A -> A+B discarded B through the network-overlay path.
Contracts: 1 failed / 13 passed because sweepFrameKey was not yet characterized.
Extension observer: 2 focused failures because a global marker was paired with another frame's records.
CMD adapter frame ownership: 1 failed / 9 skipped because frame B completion removed frame A.
```

The added tests also cover pre-cutoff and retired-source-epoch IM deltas, a malformed Market 2, a fully structured characterized cyborg exclusion, partial versus completed CMD DOM sweeps, same-frame completion, and rejection of an in-flight sweep after a source epoch changes.

### Fix Round 2 GREEN

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/cmd-http-adapter.test.ts src/chrome-bridge/cmd-dom-adapter.test.ts src/chrome-bridge/im-http-adapter.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/cmd-dom-snapshot.test.ts src/cmd-snapshot-poller.test.ts src/network-observer.test.ts
npm.cmd test --workspace @tool-chenh/contracts -- --run src/chrome-bridge.test.ts
```

```text
Task 5 API: 4 suites / 54 tests passed.
Task 5 extension: 3 suites / 152 tests passed.
Contracts: 1 suite / 14 tests passed.
```

Task 1-4 regressions:

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/automatic-source-recovery.test.ts src/chrome-bridge/provider-source-refresh.test.ts src/chrome-bridge/chrome-bridge-control-plane.test.ts src/chrome-bridge/provider-feed-controller.test.ts src/chrome-bridge/provider-feed-registry.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts src/catalog/catalog-coverage-guard.test.ts src/server.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/provider-work-scheduler.test.ts src/local-bridge.test.ts src/network-observer.test.ts src/saba-snapshot-storage.test.ts src/cmd-snapshot-poller.test.ts src/bridge-wakeup.test.ts
```

```text
API: 8 suites / 94 tests passed.
Extension: 6 suites / 180 tests passed.
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
git diff -- . ':!*.md' | rg -n -i "authorization|cookie|password|bearer|session[_-]?id|access[_-]?token|refresh[_-]?token|api[_-]?key"
```

All six compile/build commands exited 0. `git diff --check` exited 0 with only the checkout's existing LF-to-CRLF notices. The hygiene scan found only the intentional synthetic field name `observerSessionId: "worker-a"`; no secret value or authoritative provider payload was added.

### Ordering, freshness, and remaining boundaries

- IM's pre-baseline replay log remains bounded to 128 envelopes. The reconciliation cutoff is still allocated before Market 1 fetch begins; replay never crosses a source reset and does not turn a generic heartbeat into freshness.
- CMD DOM additions and proven same-frame omissions remain fallback evidence only. They publish `STALE`, cannot renew `LIVE`, and never take price or quote-clock precedence over a retained authenticated-network catalog.
- Per-frame CMD capture remains inside the existing CMD keyed lane. No global heavy-work tail or cross-provider wait was introduced, so IM, BTI, TSPORT, and SABA isolation is unchanged.
- Equal CMD cursor idempotence and AbortSignal-aware IM signer plumbing remain deferred as ledgered; this round did not broaden into either minor.

### Files changed in Fix Round 2

- `apps/api/src/chrome-bridge/adapter.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- `apps/api/src/chrome-bridge/cmd-dom-adapter.ts`
- `apps/api/src/chrome-bridge/cmd-dom-adapter.test.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- `apps/chrome-extension/src/cmd-snapshot-chunker.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/chrome-extension/src/network-observer.test.ts`
- `packages/contracts/src/chrome-bridge.ts`
- `packages/contracts/src/chrome-bridge.test.ts`

Commit subject: `fix(feed): close CMD and IM reconciliation races`.

---

## Fix Round 3

Status: DONE

Review base: `858ed0c`

### Review findings resolved

- IM uses one bounded per-source delta log for every reconciliation phase. Natural deltas are retained before partition 1, between partitions, and while an older catalog remains current. At atomic commit, ordered log entries newer than the announced cutoff are replayed once onto the new baseline. The log deterministically evicts its oldest entry above 128, rejects non-increasing source order, and is discarded on source reset.
- IM validates each cyborg event's complete characterized market structure before applying the `iscyb: true` exclusion. A cyborg-shaped event with malformed nested `mls` now rejects the partition/generation; a fully structured characterized cyborg exclusion remains safe.
- CMD semantic dedup now includes per-frame records plus sweep ID, completion state, and document identity. Unchanged records therefore emit the `false -> true` completion transition, while a repeated identical completion inside the dedup interval remains silent.
- A completed, fully bound CMD sweep may carry zero records. The chunk contract rejects empty partial/unbound snapshots, while the chunker, assembler, adapter, and data plane carry an explicit completed-empty sweep through to same-document tombstones without granting `LIVE` authority.
- Sweep metadata is all-or-none: sweep ID, completion, frame key, and document key are required together, and orphan identity fields are rejected. The observer derives the document key from observer session, target tab, source generation, full frame ID, and CDP loader identity. The public key is a bounded opaque hash rather than raw runtime identity.
- The CMD assembler fingerprints all sweep metadata across chunks in addition to records and chunk count. Conflicting frame/document/session/completion metadata closes the snapshot; a normal identically bound multi-chunk snapshot still assembles out of order.
- CMD adapter sweep ownership is keyed by both frame and document. A replacement document cannot complete or tombstone the prior document's sweep, while a new completed sweep from the owning document can remove all of its omitted rows.

The sanitized authoritative CMD evidence and hashes remain unchanged. Fix Round 3 performed no browser/provider/runtime action and added no response fixture, raw provider body, header, cookie, token, credential, account identifier, or user data.

### Fix Round 3 RED

Tests were written before production changes and run against `858ed0c`:

```powershell
npm.cmd test --workspace @tool-chenh/contracts -- --run src/chrome-bridge.test.ts
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/im-http-adapter.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts src/chrome-bridge/cmd-dom-adapter.test.ts src/chrome-bridge/cmd-snapshot-assembler.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/cmd-snapshot-chunker.test.ts src/network-observer.test.ts
```

```text
Contracts: 2 failed / 12 passed.
  Strict document binding and completed-empty sweep acceptance were absent.
API: 9 failed / 49 passed.
  IM lost the between-partition delta and the 129-entry bounded replay burst (2).
  Malformed nested mls under iscyb authorized a generation (1).
  Conflicting assembler document metadata completed incorrectly (1).
  CMD strict binding/completed-empty/document ownership and the data-plane sweep path failed (5).
Extension: 8 failed / 130 passed.
  Completed-empty chunking failed (1).
  Required document propagation, false-to-true semantic emission, zero-record completion,
  and same-frame loader replacement failed in the observer (7).
```

The bounded replay test uses 129 post-cutoff deltas: an oldest event deletion followed by 128 ordered price updates. Correct deterministic eviction drops the deletion and commits the latest `0.7127` price; an unbounded replay would delete the event, while the prior lost-buffer behavior committed `0.60`.

The strict sweep fixtures establish prior frame ownership with an explicitly bound sweep before testing omission. Legacy unbound viewport rows are not retrospectively assigned to a frame/document, so a completion cannot tombstone evidence whose ownership was never proven.

### Fix Round 3 GREEN

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/cmd-http-adapter.test.ts src/chrome-bridge/cmd-dom-adapter.test.ts src/chrome-bridge/im-http-adapter.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts src/chrome-bridge/cmd-snapshot-assembler.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/cmd-dom-snapshot.test.ts src/cmd-snapshot-poller.test.ts src/cmd-snapshot-chunker.test.ts src/network-observer.test.ts
npm.cmd test --workspace @tool-chenh/contracts -- --run src/chrome-bridge.test.ts
```

```text
Task 5 API: 5 suites / 64 tests passed.
Task 5 extension: 4 suites / 159 tests passed.
Contracts: 1 suite / 14 tests passed.
```

Task 1-4 regressions:

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/automatic-source-recovery.test.ts src/chrome-bridge/provider-source-refresh.test.ts src/chrome-bridge/chrome-bridge-control-plane.test.ts src/chrome-bridge/provider-feed-controller.test.ts src/chrome-bridge/provider-feed-registry.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts src/catalog/catalog-coverage-guard.test.ts src/server.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/provider-work-scheduler.test.ts src/local-bridge.test.ts src/network-observer.test.ts src/saba-snapshot-storage.test.ts src/cmd-snapshot-poller.test.ts src/bridge-wakeup.test.ts
```

```text
API: 8 suites / 94 tests passed.
Extension: 6 suites / 183 tests passed.
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
git diff -- . ':!*.md' | rg -n -i "authorization|cookie|password|bearer|session[_-]?id|access[_-]?token|refresh[_-]?token|api[_-]?key"
```

All six compile/build commands exited 0. `git diff --check` exited 0 with only the checkout's LF-to-CRLF notices. The hygiene scan found only the synthetic test value and internal field name `observerSessionId`; document identity is emitted only as a bounded opaque hash.

### Ordering, freshness, and remaining boundaries

- The IM log cap remains 128 and is the only reconciliation replay buffer; no pending-generation array can grow separately. Deltas at or below the cutoff, non-increasing source sequences, and retired source epochs remain rejected.
- Completed-empty CMD sweeps remain `DOM_FALLBACK` deltas. They can remove records proven to belong to that exact frame/document but cannot establish or renew authoritative network freshness or `LIVE`.
- CDP loader identity plus observer/source epoch fencing makes document replacement explicit without exposing the raw loader, session, frame, or target tuple across the bridge.
- Per-frame capture and IM reconciliation remain on their existing keyed provider lanes. No global heavy-work tail or cross-provider blocking was added.
- Equal CMD cursor idempotence and AbortSignal-aware IM signer plumbing remain deferred exactly as ledgered.

### Files changed in Fix Round 3

- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- `apps/api/src/chrome-bridge/cmd-dom-adapter.ts`
- `apps/api/src/chrome-bridge/cmd-dom-adapter.test.ts`
- `apps/api/src/chrome-bridge/cmd-snapshot-assembler.ts`
- `apps/api/src/chrome-bridge/cmd-snapshot-assembler.test.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- `apps/chrome-extension/src/cmd-snapshot-chunker.ts`
- `apps/chrome-extension/src/cmd-snapshot-chunker.test.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/chrome-extension/src/network-observer.test.ts`
- `packages/contracts/src/chrome-bridge.ts`
- `packages/contracts/src/chrome-bridge.test.ts`

Commit subject: `fix(feed): bind reconciliation to current documents`.

---

## Fix Round 4

Status: DONE

Review base: `981c3d4`

### Review findings resolved

- A malformed IM partition now permanently rejects its reconciliation generation for the source epoch. The adapter discards matching pending partitions immediately, rejects every later partition with the same generation, retains a bounded 64-generation rejection set, and keeps a scalar rejected-ordinal watermark so an evicted numeric generation still cannot return. Only a strictly newer numeric generation may reconcile, and `resetSource` clears both fences with the rest of the source state.
- An IM generation whose completed nonempty input cannot authorize an accepted catalog is rejected through the same path. The shared 128-entry source delta log remains available to a later valid generation; a rejected generation has no remaining pending partition or generation-local replay state that can commit.
- CMD no longer hashes a synthetic `document-unknown` identity. A frame with no authoritative loader, and the no-frame-tree top-world fallback, may emit only partial records without sweep ID, completion, frame, or document metadata. An unbound empty completion is suppressed, so it cannot tombstone retained rows.
- A bound CMD capture re-reads the CDP loader after isolated-world creation, after evaluation, immediately before selecting emission groups, and before every emitted chunk. A missing or changed loader discards that frame result; a loader change between multi-chunk emits leaves an incomplete snapshot that the assembler cannot commit. Stable-loader captures retain normal completion and completed-empty behavior.
- Existing adapter ownership tests continue to prove that a new loader-derived document key cannot complete or tombstone a prior document's sweep in the same frame/source generation.

No browser, provider tab, runtime, or external service was touched in this round. No raw provider response, header, cookie, token, credential, account identifier, user data, or new authoritative fixture was added.

### Fix Round 4 RED

Tests were written before each production change and run against `981c3d4` plus only the new tests:

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/im-http-adapter.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/network-observer.test.ts -t "loader is missing|loader changes during evaluation|no-frame-tree"
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/network-observer.test.ts -t "stops a bound multi-chunk"
```

```text
IM: 2 failed / 18 passed.
  A valid Market 1 followed by malformed Market 2 could still commit when a later valid Market 2 arrived.
  A malformed first partition left no rejection state, so later same-generation partitions could commit.
CMD document binding: 3 failed / 134 skipped.
  Missing-loader and no-frame-tree captures carried bound completion metadata.
  A loader replacement during evaluation emitted the old document result.
CMD per-emit fence: 1 failed / 137 skipped.
  Both chunks were forwarded after the first forward boundary changed the loader; only the first was permitted.
```

The IM reset test also proves the rejected generation becomes usable only after the source epoch is explicitly reset, while a strictly newer generation succeeds without a reset.

### Fix Round 4 GREEN

```powershell
npm.cmd test --workspace @tool-chenh/contracts -- --run src/chrome-bridge.test.ts
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/cmd-http-adapter.test.ts src/chrome-bridge/cmd-dom-adapter.test.ts src/chrome-bridge/im-http-adapter.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts src/chrome-bridge/cmd-snapshot-assembler.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/cmd-dom-snapshot.test.ts src/cmd-snapshot-poller.test.ts src/cmd-snapshot-chunker.test.ts src/network-observer.test.ts
```

```text
Contracts: 1 suite / 14 tests passed.
Task 5 API: 5 suites / 66 tests passed.
Task 5 extension: 4 suites / 163 tests passed.
```

Task 1-4 regressions:

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/chrome-bridge/automatic-source-recovery.test.ts src/chrome-bridge/provider-source-refresh.test.ts src/chrome-bridge/chrome-bridge-control-plane.test.ts src/chrome-bridge/provider-feed-controller.test.ts src/chrome-bridge/provider-feed-registry.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts src/catalog/catalog-coverage-guard.test.ts src/server.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- --run src/provider-work-scheduler.test.ts src/local-bridge.test.ts src/network-observer.test.ts src/saba-snapshot-storage.test.ts src/cmd-snapshot-poller.test.ts src/bridge-wakeup.test.ts
```

```text
API: 8 suites / 94 tests passed.
Extension: 6 suites / 187 tests passed.
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
git diff -- . ':!*.md' | rg -n -i "authorization|cookie|password|bearer|session[_-]?id|access[_-]?token|refresh[_-]?token|api[_-]?key"
```

All six compile/build commands exited 0. `git diff --check` exited 0 with only the checkout's existing LF-to-CRLF notices. The hygiene scan found only the intentional synthetic `observerSessionId: "worker-a"` test value and internal identifier; no secret value or authoritative provider payload was added.

### Ordering, document authority, and remaining boundaries

- IM rejection state is source-scoped and bounded. Numeric reconciliation ordinals provide the permanent same-epoch lower fence even after the exact-ID set evicts its oldest entry. The shared source delta log remains bounded at 128 and is replayed only by a later valid generation.
- Unbound CMD data remains `DOM_FALLBACK` partial evidence and cannot carry `completeSweepEvidence`. Only an unchanged authoritative loader can produce a document key and completion/tombstone metadata.
- Per-frame reads remain concurrent. Loader revalidation adds bounded CDP reads inside the existing CMD provider lane and introduces no global work tail or cross-provider wait.
- Equal CMD cursor idempotence and AbortSignal-aware IM signer plumbing remain deferred exactly as previously ledgered.

### Files changed in Fix Round 4

- `apps/api/src/chrome-bridge/im-http-adapter.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/chrome-extension/src/network-observer.test.ts`

Commit subject: `fix(feed): reject poisoned snapshots and stale documents`.
