# BTI continuous collection — 2026-09-08

Status: extension **0.2.88** and the final API are deployed. The short live verification window passed; the 24-hour soak remains in progress. This is not 24-hour live acceptance.

The operator requested BTI maintenance and explicitly suspended IM after reporting an account block. This work does not investigate or attribute the reported IM block.

## Changes

- Healthy BTI documents survive the old periodic 20-minute page lease. Existing observed-failure recovery remains available.
- A replacement All Early roster can run in the background while the current committed generation continues delivering detail. Cached request and receipt timestamps remain unchanged.
- List hydration uses two workers per partition. The three detail lanes wait 500ms between requests, limiting immediate-response detail traffic to six starts per second; actual response time slows it further. This is a local pacing bound, not a provider-published rate allowance.
- HTTP 429 and 5xx pause all owned collector requests, abort outstanding owned requests, and back off from 30 seconds up to five minutes. A longer Retry-After is respected. HTTP 401/403 stops collection until the native session credentials change. Same-session extension upgrades retain these restrictions.
- Restore, ensure, reload and the authentication-page watchdog cannot replace BTI's document to bypass a recorded request pause.
- Each publication prioritizes up to four MiB of newly received detail bodies, with room left in the existing eight-batch bound for fair replay. Only actual returned publications advance delivery state; background roster completion cannot consume unpublished price updates.
- IM is excluded from production extension attachment and recovery. Upgrade reconciliation retires its previously injected collector, aborts owned requests, and releases waiters. IM retirement runs independently so an unresponsive IM renderer cannot block BTI attachment.
- The API rejects already committed roster replays before parsing and current-generation detail receipts already held at an equal/newer clock before extracting or normalizing them. Future generations still pass through ownership staging, and a late optional roster partition remains supported.
- Durable catalog storage explicitly validates and retains native market observations. Its previous strict schema silently rejected every BTI catalog carrying that field, preventing restart persistence. Original receipt times are preserved on disk.
- `/api/diag/runtime` exposes numeric process uptime, heap, RSS and cumulative CPU counts without reading catalogs or causing provider requests.
- Revision hashing streams the same JSON bytes in groups of 128 array entries. Durable storage passes an iterator of equally bounded groups to `writeFile`, retaining the existing exclusive temporary file and atomic rename. This avoids full projected quote/observation arrays, a full serialized catalog string, and its simultaneous UTF-8 copy. The group bound is an item count, not a fixed byte guarantee for arbitrary rows.

## Evidence and checks

Initial diagnostics found BTI's tab alive while decoded evidence had stopped for more than five minutes. Code inspection found the destructive periodic lease and the shared wait between roster acquisition and detail publication.

Deployment 0.2.87 retained a continuous BTI source epoch, but exposed a second issue: cycling old cached detail delayed delivery of newly acquired prices. Recorded catalog receipt ages reached 50–75 seconds even while feed evidence advanced. Version 0.2.88 adds the bounded fresh-receipt priority and its background-completion regression.

Verification passed: 79 BTI collector, observer, page-health and inventory tests; the earlier 129 extension lifecycle tests (overlapping BTI checks included); 52 API BTI adapter tests; extension typecheck and build. Four historical observer tests were updated to include the already-deployed third All Early partition. Pacing tests now allow the bounded queue enough time to complete. Tests cover native clock preservation, lost-forward replay, timeout handling, session replacement, request pauses, priority publication, and a simulated day without periodic BTI navigation.

Independent review identified two issues, both reproduced and fixed: a hanging IM cleanup could block allowed-provider restoration, and an unforwarded background snapshot could consume fresh-delivery priority. Focused rechecks passed.

The initial 0.2.88 observation retained the same BTI document epoch beyond 20 minutes, but did **not** pass uninterrupted-operation acceptance: one API process restart caused a consumer WebSocket disconnect and temporarily restored an old journal. Several diagnostic requests exceeded ten seconds. At the recorded 20-minute checkpoint, 27/28 post-settling BTI samples were LIVE/ACTIVE/FRESH, five diagnostic requests failed, and four catalog ages exceeded 30 seconds (including the restored old journal). This evidence is retained in `acceptance-088-initial.json`; no claim of a confirmed OOM cause is made.

Follow-up review found redundant full normalization of replayed receipts and the durable-schema defect described above. Both have red-to-green regressions. Follow-up verification passed 55 BTI adapter/collector integration tests, three BTI data-plane cases, seven persistence tests, eight revision tests, three diagnostic route tests, and the API build/typecheck. The revision test includes 24 exact comparisons with the previous hash algorithm across provider, freshness state, observation presence and property insertion order. Independent review found no blocking issue in these changes.

The API still restarted after that first follow-up. A fatal diagnostic report from process 37332 at 22:21:00 explicitly confirms **JavaScript heap out of memory / allocation failure**: total heap 584,454,144 bytes with a 587,202,560-byte V8 heap limit. This identifies the failure class; it does not prove an unbounded retained-object leak. A ten-second CPU profile also found substantial serialization and validation work in durable saves. Both revision hashing and durable writes now use bounded groups; the managed API remains configured with `--max-old-space-size=512`.

An independent synthetic comparison (38,000 quotes and 110,000 observations) measured sampled heap growth at hash updates of 59 MiB for the old revision algorithm versus 16 MiB for the chunked algorithm, with identical digests. This is allocation evidence, not a production soak result. `fatal-summary.json` and `profile-result.json` contain shape/count diagnostics. Fatal reports exclude environment and network-interface diagnostics; report flags remain enabled for the current managed stack and its automatic child restarts.

Runtime identities:

- Extension 0.2.88: `sha256:be6ac2aadcbbf1954f140fa897fef389fbbf90523370292ee0579622c394abda`.
- Final managed stack: `sha256:8dfbe58373e667ad11f3e8b67fc363bbcf05df8f7b0bb9d8880f1d00b385ad97`.
- Extension handoff completed at epoch milliseconds `1788878071069`; API follow-ups at `1788879533953` and `1788881484453`. No handoff navigated provider tabs as a deployment step. The final handoff encountered a stale managed-state record after the old processes stopped; all three recorded process identities and both listener ports were verified absent before the exact-state removal allowed handoff to finish.

The ignored `.run/bti-maintenance/` directory holds handoff records and read-only monitoring:

- `soak-087.jsonl` records pipeline counts and ages every 15 seconds, spanning deployments; filter by the final API handoff plus ten minutes for settled samples.
- `monitor.json` records the 24-hour monitor's PID, start time and duration.
- Earlier `realtime-*.json` files preserve pre-fix and startup consumer counts. `realtime-settled.json` tracks the final API after its settling interval. The monitor was corrected to retry a failed WebSocket handshake even when Node emits an error without a close event.
- `resources.jsonl` and `resources-monitor.json` track API PID, uptime and numeric resource use; CPU deltas must be divided by elapsed sample time.
- Monitoring only reads loopback diagnostics and the loopback realtime stream. It does not request provider refreshes or change source tabs.

## Final live window

At 22:48:21 local time, approximately 17 minutes after the final handoff, the API still had its original PID 10252 and no new fatal report. The first ten minutes included recovery from the deployment outage and old queued envelopes; BTI reattached during that startup interval. Those startup samples remain in the log and are excluded from settled acceptance under the repository's measurement rule.

From the ten-minute cutoff through the final checkpoint:

- 25/25 pipeline samples were LIVE/ACTIVE/FRESH, with actual quote changes in every sampled one-minute window.
- Decoded-evidence age ranged from 1.0 to 7.7 seconds. Catalog receipt age ranged from 2.5 to 11.5 seconds; no sample exceeded 30 seconds.
- One BTI source epoch, zero recovery attempts and zero failed pipeline/resource diagnostic requests in this window.
- 1,627 events and 38,464–38,541 markets were retained. An independent read of the persisted BTI catalog successfully validated all 76,916 quotes and 114,119 native observations in that earlier disk sample, preserving original receipt times.
- The consumer WebSocket observed 125 revisions after its settled monitor started, with a maximum revision gap of 11.6 seconds, zero disconnects and zero errors. A semantic revision gap measures content changes, not every receipt heartbeat.
- Sampled heap use stayed between about 278 and 421 MiB. The API heap setting remained 512 MiB; no resource or freshness limit was increased.
- Announced build identity, computed workspace build identity and the handoff identity matched. The bridge registry contained one BTI source and zero IM sources.

`acceptance-088.json` is refreshed by `node .run/bti-maintenance/summarize.mjs`; raw logs continue growing. The pipeline/resource monitors were restarted at about 22:36 to cover a full 24 hours after the final deployment, and the settled consumer monitor at about 22:42. They only read loopback endpoints. No freshness threshold, market mapping or settlement rule was relaxed. Longer uptime is still unverified, so the earlier restart failures must not be described as a completed 24-hour pass.
