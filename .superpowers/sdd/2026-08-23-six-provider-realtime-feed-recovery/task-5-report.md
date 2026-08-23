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
