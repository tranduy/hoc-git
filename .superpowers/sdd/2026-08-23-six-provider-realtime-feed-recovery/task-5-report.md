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
