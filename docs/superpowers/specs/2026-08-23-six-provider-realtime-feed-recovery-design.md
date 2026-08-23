# Six-Provider Realtime Feed and Recovery Design

Date: 2026-08-23

Status: approved for implementation

Scope: CMD, IM, SABA, SBOBET/KSPORT, APSPORT/TSPORT, and BTI football catalogs

## 1. Goal

Make all six provider catalogs update continuously from provider-authoritative evidence, recover a failed source without disturbing healthy sources, and fail closed whenever current prices cannot be proven.

The system must never equate a reachable Chrome tab, a bridge heartbeat, a replayed disk snapshot, or an unchanged viewport DOM capture with a live price feed. A source may be reported `LIVE` only when it has a complete baseline for the current source epoch and its configured authoritative transport remains current without an unresolved gap.

The system cannot guarantee that an external bookmaker, its authentication service, or the network is always available. It must guarantee correct behavior under that condition: report the source as stalled or action-required, suppress stale prices and tickets, attempt bounded targeted recovery, and return to `LIVE` only after new authoritative evidence is accepted.

## 2. Current Findings

The effective runtime is the dirty `auto-source-recovery-remote-test` worktree at committed base `d47e63e`. The older `arbitrage-foundation` worktree is five commits behind, while `run.md` can direct operators to that older tree. Runtime identity and startup documentation must be consolidated as part of this work.

Observed provider state during diagnosis:

| Provider | Observed state | Main correctness gap |
| --- | --- | --- |
| CMD | Catalog observations advance, but collection is viewport-DOM based | Offscreen prices can remain stale; unchanged DOM can look fresh |
| IM | Prices currently move; signed full reconciliation runs about every 15 seconds | Delta/baseline ordering, shared scheduling, and polling latency |
| SABA | Bridge sequence advances while the catalog is over 40 minutes stale | Orphan Socket.IO stream, replay-only recovery, false liveness |
| SBOBET | No KSPORT bridge source; persisted catalog is about 35 hours stale | Recovery requests a snapshot from a nonexistent source and stops |
| APSPORT | Catalog timestamp/sequence advances while a fixed 54-quote set does not | Orphan WS frames, non-periodic HTTP baseline, DOM-generated false freshness |
| BTI | Native live prices move, but quote identities churn heavily | List/detail scheduling and overlay lifecycle are non-atomic |

There is no common upstream price source for the six providers. Fabet is an authentication and launch anchor for five of them, not a price authority.

## 3. Chosen Approach

Keep the Chrome bridge and the six provider-specific collectors, but put one shared `ProviderFeedController` between decoded provider evidence and the catalog/revision/UI layers. Migrate each adapter to emit explicit evidence metadata and give each provider its own bounded recovery strategy.

This approach is preferred over two alternatives:

1. Patching the six adapters independently is faster initially but leaves contradictory health states, dead-end recovery, stale partition merging, and duplicate monitoring logic.
2. Replacing all browser collectors with direct Node connectors would be cleaner long-term, but current provider authentication and handshake knowledge is not sufficient for CMD, SABA, and APSPORT. Doing that now would introduce more unverified failure modes.

## 4. Architecture

### 4.1 Provider feed controller

Create one controller instance per catalog account. It owns feed state, current source identity, authoritative-evidence timestamps, baseline generation, recovery attempts, and publication eligibility.

States:

```text
STARTING -> SYNCING -> LIVE -> STALLED -> SOFT_RECOVERY
                                      -> HARD_RECOVERY -> ACTION_REQUIRED
```

Valid transitions back to `LIVE` require a newly accepted complete baseline for the active epoch, or a current baseline plus valid ordered deltas/provider transport continuity according to the provider strategy. Sending a control message, opening a tab, or receiving `TAB_STATE` is never recovery success.

The controller tracks at least:

- `sourceId` and `sourceEpoch`
- `tabReachableAtMs`
- `providerTransportAtMs`
- `lastAuthoritativeEvidenceAtMs`
- `lastCompleteBaselineAtMs`
- `lastDeltaAtMs`
- `lastSemanticChangeAtMs`
- configured `expectedEvidenceCadenceMs` and `maxBaselineAgeMs`
- current baseline generation and required partitions
- latest accepted provider sequence/timestamp when available
- recovery stage, attempt, deadline, cooldown, and last structured error

`lastSemanticChangeAtMs` is diagnostic only. A quiet market is not stale when an authenticated provider response or provider-protocol heartbeat proves continuous transport. Provider heartbeat may preserve delta continuity only inside the provider's bounded `maxBaselineAgeMs`; it cannot postpone full reconciliation indefinitely. Conversely, a generic tab heartbeat or identical viewport DOM capture cannot renew authoritative liveness.

### 4.2 Evidence contract

Extension envelopes continue to carry raw captures, but decoded adapter output becomes a discriminated feed update:

- `TRANSPORT`: provider-specific open/heartbeat/response evidence; never a Chrome tab heartbeat.
- `BASELINE_PART`: one named partition in an explicit epoch/generation.
- `BASELINE_COMMIT`: proves all required partitions are present and atomically replaces the old baseline.
- `DELTA`: ordered changes against the current committed epoch/generation.
- `INVALIDATE`: socket close, sequence gap, source replacement, schema failure, or explicit provider invalidation.

Each update carries provenance (`WS`, authenticated `HTTP`, or `DOM_FALLBACK`), local receive time, provider timestamp when present, source epoch, generation, and sequence. Existing adapters may still internally materialize complete catalogs, but they must return the evidence that justified publication.

### 4.3 Atomicity and ordering

- A baseline is invisible until every required partition commits.
- Late parts from retired epochs or generations are rejected.
- Deltas received during a replacement baseline are buffered and applied after commit only when newer than that baseline.
- A sequence gap invalidates delta eligibility until a new authoritative baseline commits.
- Tombstones/removals are applied only from a complete baseline or an explicit provider removal event.
- Bridge queue pressure drops or coalesces a whole provider generation and starts a new epoch; it must not remove arbitrary chunks from an otherwise publishable generation.
- Persisted catalogs load as display-only `STALE` state and never satisfy the current-process baseline requirement.

### 4.4 Unified health and publication

`/api/catalog/sources`, `/api/health`, catalog metrics, realtime status messages, and the web UI consume the same controller snapshot. `/api/chrome-bridge/sources` remains a transport diagnostic and must be labeled as such rather than treated as catalog health.

The revision stream publishes two independent kinds of change:

1. semantic catalog revisions for price/status/identity changes;
2. feed-state revisions for freshness, recovery stage, and action-required transitions.

The UI excludes all stale or invalidated catalogs from comparison, ranking, alerts, and ticket construction. It may display the last catalog for diagnosis, but must visibly label it stale and make it non-executable.

## 5. Recovery State Machine

Recovery is per account, single-flight, deadline-bound, and isolated from healthy provider tabs.

### 5.1 Soft recovery

Use the least disruptive provider-specific action:

- CMD: request a new complete collection generation.
- IM: issue a signed two-part GetSE reconciliation and re-establish delta observation.
- SABA: request a new reset/done baseline or one controlled Socket.IO reconnect.
- SBOBET: request a fresh `getEvent` baseline and STOMP resubscription when a KSPORT source exists.
- APSPORT: request an atomic `live/today/early` HTTP baseline and restore WS attribution.
- BTI: request a native live/list baseline without blocking detail enrichment.

Soft recovery succeeds only after the controller accepts newer authoritative evidence before its deadline.

### 5.2 Hard recovery

If the source is missing or soft recovery times out:

- CMD restores only the CMD lobby/tab.
- Fabet-backed providers obtain a current validated launch, then call targeted `ensureLobby` for only the affected provider.
- CDP observation attaches before consuming one-time navigation whenever the provider requires it.
- The old catalog remains stale/display-only until the replacement epoch commits a full baseline.

Authentication, launch acquisition, portal validation, source attachment, baseline acquisition, and schema validation expose distinct error reasons. After bounded attempts and backoff, the controller enters `ACTION_REQUIRED`; it does not loop indefinitely or reset unrelated sources.

Explicit manual/scheduled maintenance suppresses automatic hard recovery for the same source to prevent races.

## 6. Provider-Specific Design

### 6.1 CMD

Prefer the provider's underlying `DataOdds.ashx`/sport-item traffic for price deltas and full reconciliation. Use DOM for event/market identity, visible-price verification, and fallback only.

If network decoding cannot cover a market, the DOM fallback commits by complete virtualized sweep generation rather than a 15-second wall-clock cache. Each quote retains its own observation age; an unvisited row becomes ineligible instead of inheriting the catalog timestamp. The observer includes text, `class`, `aria-disabled`, and provider status attributes. CMD capture and discovery run on a per-source lane.

### 6.2 IM

Treat `GetSEDelta` as the realtime path. Signed GetSE Market 1 and Market 2 form an atomic reconciliation baseline. Fetches are bounded and cancelled when superseded. Deltas received during reconciliation are buffered and reapplied when newer; a late baseline cannot roll a price backward. IM uses a per-source scheduling lane and a watchdog independent of other providers.

### 6.3 SABA

Socket.IO reset/done is authoritative. A worker restart that leaves an orphan socket triggers one rate-limited controlled reconnect. The new epoch must observe OPEN plus a complete reset/done baseline. An `A003`, reconnect loop, timeout, or incomplete baseline escalates to targeted SABA tab replacement.

Retained frames are bootstrap evidence only until current traffic validates them. DOM fallback gets a bounded safety capture, explicit complete-coverage quorum, source-epoch cleanup, and partition expiry. It must not indefinitely merge a current visible viewport with hidden stale WS partitions.

### 6.4 SBOBET/KSPORT

A missing KSPORT source goes directly to hard recovery; requesting a snapshot from zero connected sources is not terminal. Promotion to `LIVE` requires a recognized sportsbook source plus complete current-epoch `live` and `today` baselines. Existing-but-quiet sources first use same-tab football discovery, fresh `getEvent`, and controlled STOMP recovery.

The controller distinguishes `AUTH_EGRESS_UNAVAILABLE`, expired/consumed launch, portal failure, missing tab, transport failure, incomplete baseline, and provider schema failure.

### 6.5 APSPORT/TSPORT

WS delta traffic is primary. Unknown-request-ID TSPORT frames after an extension-worker restart mark the WS attribution as lost and trigger recovery instead of being discarded silently. Until a newly attributed socket is established, a bounded periodic worker fetch supplies atomic `live/today/early` baselines.

DOM is an audit/visible-row overlay only. Identical DOM cannot advance authoritative freshness, and DOM values cannot overwrite newer WS/HTTP values. Every retained partition/quote keeps provenance and age; complete baselines remove or explicitly expire old partitions.

### 6.6 BTI

Keep the page's native `/live` response as the primary low-latency live partition. Generated list baselines provide bootstrap/reconciliation; event details run in a separate bounded pool and never delay the next live update.

Prioritize selected/watched events, then sweep the remaining details. Do not clear all details on every list baseline. Retain each detail until replacement, provider tombstone, or an explicit stale transition based on the measured full-sweep interval. Publish list/detail changes as one coherent semantic generation to prevent identity blinking or list/detail price rollback.

## 7. Observability

Add a bounded, redacted provider journal and expose:

- active build/extension fingerprint;
- source ID and epoch;
- authoritative baseline/delta/transport ages;
- expected cadence and missed-cycle count;
- generation/partition state;
- sequence gaps and rejected late updates;
- recovery stage, attempts, outcomes, and structured error;
- provider timestamp and capture-to-API/UI latency where available.

Catalog telemetry must record adapter ingestion and controller decisions, not only HTTP reads. No credential, signed URL, cookie, launch token, or unredacted response body is written to logs.

## 8. Worktree and Deployment Consolidation

Use `auto-source-recovery-remote-test` as the implementation source because it is the active runtime and contains the newer committed and uncommitted provider work. Preserve all existing dirty changes and isolate commits by purpose. After verification, integrate the validated result into the canonical `fix/auto-source-recovery` branch currently checked out by `arbitrage-foundation`; do not overwrite that worktree's unrelated dirty changes. Then:

1. consolidate the validated implementation into the canonical development branch;
2. update `run.md` and launch scripts to use that canonical path;
3. expose the API and extension build fingerprints at runtime;
4. verify a clean restart loads the exact tested artifacts.

No implementation is considered complete while the tested source, built artifacts, extension bundle, and documented startup path disagree.

## 9. Testing Strategy

### 9.1 Automated tests

Add cross-layer tests from extension envelope through bridge, adapter, controller, revision store, API, and UI. Unit tests alone are insufficient.

Required scenarios:

- generic TAB_STATE cannot renew an authoritative feed;
- identical DOM fallback cannot conceal a stalled feed;
- current baseline plus provider heartbeat remains live during a quiet market;
- incomplete/late baseline partitions never publish;
- delta during baseline is preserved and cannot be rolled back;
- queue pressure and sequence gaps force an atomic resync;
- API restart and extension-worker restart recover every provider;
- missing source escalates to targeted creation;
- socket close, tab close, debugger detach, auth expiry, launch failure, and schema failure produce correct states;
- hard recovery replaces only the failed provider;
- stale catalogs never enter ranking, alerts, or ticket construction;
- a blocked provider lane cannot delay another provider's cadence;
- build fingerprints identify the exact running source.

### 9.2 Live acceptance

Run a minimum 30-minute six-provider soak at one-second observation resolution, followed by fault injection for API restart, extension-worker restart, source-tab close, and provider socket close.

Completion requires:

- all six sources obtain a post-start authoritative baseline;
- no `ACTIVE`/`LIVE` status contradicts a stale or unreadable catalog;
- direct provider AH and TOTAL changes propagate through capture, catalog, realtime revision, and UI without refresh, normally within three seconds and never beyond five seconds under the accepted fallback cadence;
- quiet markets remain live only through provider-authoritative continuity, not tab heartbeat or DOM timestamp renewal;
- SABA recovers an authoritative baseline within 60 seconds of a recoverable worker/tab fault;
- SBOBET recreates KSPORT and commits `live + today` within 90 seconds when valid authentication/launch is available;
- no false-zero catalog, catastrophic coverage collapse, old-generation rollback, stale executable ticket, or unrelated tab reset;
- exact event/market/selection values match a current provider response or visible direct probe;
- external auth/upstream failure results in truthful `ACTION_REQUIRED` and fail-closed UI behavior.

If a provider is externally unavailable during the run, the six-of-six realtime gate remains unpassed. Correct fail-closed behavior is necessary but is not counted as a realtime pass.

## 10. Non-Goals

- Replacing all browser collectors with new direct Node connectors.
- Resetting all provider tabs to recover one source.
- Generating synthetic price changes to prove activity.
- Treating a test-suite pass, a bridge heartbeat, or one successful snapshot as sufficient live acceptance.
- Refactoring unrelated catalog, matching, or opportunity logic.
