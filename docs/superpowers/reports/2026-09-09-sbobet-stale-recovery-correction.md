# SBOBET stale recovery correction — 2026-09-09

The user reported SBOBET remaining outdated for over 23 minutes. The earlier short maintenance acceptance did not establish recovery from this failure. This correction addresses the observed recovery path; it does not establish 24-hour availability or complete market coverage.

## Failure and correction

The runtime showed a shared `MAIN_HTTP` 404 cooldown, two attached worker targets, no attributed catalog WebSocket, and no accepted new catalog. The refresh expression invented `/api/v2/getEvent` on an execution context's origin when no observed endpoint existed. An auxiliary worker on the lobby origin could therefore generate a 404 before the real page context was tried, pausing the shared SBO lanes. The old expired-template reacquisition path recognized 400 but not 404.

The observer now requires an observed request or resource endpoint, excluding resource entries with an explicit HTTP error status. This also prevents a failed request made by an older build from being rediscovered after the extension updates. A context without a usable endpoint is skipped without a speculative request. After an existing 400 or 404 quiet window expires, it performs the bounded native Live/Today reacquisition. Completion still requires a validated, published pair belonging to the current source, document and bridge. Failure retains escalation; no saved cooldown was erased or shortened.

The actual sportsbook page was on `Bóng đá GS`. Discovery and period selection accepted that label as ordinary football. Both now accept the ordinary football header, optional LIVE/Trực tiếp and a count, excluding GS, virtual and electronic football. The existing Football 2 exclusion remains.

The 0.2.105 follow-up exposed another failure: the API process restarted after ten FRESH samples. The same extension continued sending Main/More HTTP responses, but the replacement API had no All Dates baseline and admitted none. SBO was missing from bridge-open bootstrap, while old bridge completion and collection state survived. Version 0.2.106 adds SBO to bootstrap and advances its bridge epoch before requesting current data, retiring old Main/All Dates completion and pending publications. Provider request backoff is retained. Version 0.2.107 additionally excludes explicitly failed resource-timing URLs.

The controlled API restart on 0.2.107 still failed: the bridge epoch advanced but Main refresh deliberately excluded its own actual Network requests from template capture. All Dates therefore could not acquire new-bridge provenance. Version 0.2.108 observes the first successful actual Main request when the retained template belongs to an older bridge (or no template exists), including an extension-initiated refresh. Normal same-bridge capture suppression is retained. The candidate must still be a current, nonredirected HTTP 200 from the allowed football endpoint. All Dates is published only from its own actual Network receipt, never from the Runtime result alone.

The 0.2.108 API-restart run still failed with the actual attached workers. Extending the functional regression to include a worker reproduced the missing All Dates publication: workers were preferred over a valid document, so a successful worker-only Main pair could not establish an independent More/All Dates document owner. Version 0.2.109 tries known current document contexts first, keeping workers as fallback. An actual page server refusal still pauses the provider; a page without a usable template can fall back to the worker. The worker-present and worker-absent reconnect regressions both pass after this correction.

No provider page reload, close/reopen, account rotation, new socket admission rule, freshness relaxation or artificial timestamp advancement was added. A Windows UI Automation tab selection was used to inspect the existing source, then return to the dashboard. Extension/managed-stack reload applied the build without reloading provider pages. A later controlled API-only restart tests reconnection with the same extension worker and provider page.

## Verification

- VM regression reproduced a fetch to the guessed auxiliary-worker endpoint before the fix; it now makes zero requests without an observed template.
- Four period-selector regressions reproduced the GS/virtual misclassification; a discovery regression checks that an already active GS group does not hide regular football.
- Expired-404 regression requires both native partitions before completion and preserves retirement and refusal guards.
- Final scoped run: 63 passed across Main refresh, recovery, HTTP recovery guard and shared backoff suites; 87 KSPORT observer cases passed, 288 unrelated cases unselected.
- Extension typecheck/build and scoped whitespace checks passed. The entire repository test suite was not rerun.
- Bridge-open regression failed before wiring the SBO epoch/bootstrap and now passes for two consecutive connections. Main/bootstrap final suites: 26 passed; Early/recovery/backoff/bootstrap: 63 passed. Final extension typecheck/build passed.
- An exploratory whole background-memory test run also exposed three older unrelated assertions/mocks (missing SBO pause and SABA bootstrap methods; BTI periodic-navigation expectation). They were not changed to make this task appear globally green. The final new bridge-open case passed in isolation; five other background cases were unselected.
- Final 0.2.108 functional regression: with the same observer/page and a new bridge epoch, a newly received Main pair must also lead to a newly received All Dates roster before its ordinary 120-second cadence. Removing the capture fix reproduced Main success with All Dates stuck; restoring it passed. Final Main/Early/recovery/backoff suites: 82 passed. KSPORT observer subset: 87 passed, 288 unselected. Typecheck/build passed after narrowing the retained request map to its actual captured-request type.
- Final 0.2.109: Main/Early/recovery/backoff suites 83 passed; KSPORT observer subset 88 passed, 288 unselected; extension typecheck/build passed. The former worker-first fixture was replaced with explicit missing-template fallback and HTTP-500 pause cases; it no longer expects a worker to bypass a real page refusal.

## Deployment

- Extension: `0.2.109`.
- Extension artifact: `sha256:716f905a38ae567349d37e67d3e9726da1fe637486700b7d6e64687ff3e1c101`.
- Stack: `sha256:30babf5345849f849079234a73eedf40c611f5b42f14b4a8673dd4d426379e96`.
- Instance: `84e3a7c0-3956-405c-8950-ffb14dd5bd48`.
- Existing dev tunnel serves this same stack.

On 0.2.105, after the inherited 404 cooldown expired, the source produced a fresh catalog with 516 events, 5,701 markets and 11,402 quotes. The feed controller changed to LIVE, recovery stage NONE, attempt zero and no last failure. Semantic diagnostics recorded actual quote changes. Public catalog HTTP 200 subsequently returned FRESH with 516 events, 6,914 markets and 13,828 quotes. The finite follow-up later failed after the API restart, so those ten fresh samples are not final acceptance. `live-105.json` preserves both phases. `live-106.json` also includes the intentional handoff to 0.2.107 and is not a single-build acceptance run.

Public `/football-live` and `/api/health` returned HTTP 200; public and local HTML hashes and stack identities matched. Public `/api/realtime` connected and returned a SNAPSHOT. Health remains `degraded`, OBSERVE and executionReady=false; transport reachability is not full-system health.

The catalog is currently supplied by accepted HTTP baselines/detail updates. WebSocket frames remain unattributed, and HOP3's WS_FRAME requirement still reports failure; no claim is made that the WebSocket was repaired. IM and whole-machine CPU remain unresolved from prior work.

## Final running-system check (0.2.109)

The source recovered at startup, then the API process alone was deliberately stopped after verifying its workspace command, listening port, build identity and fresh SBO baseline. The managed supervisor replaced PID 28012 with PID 7352. The extension worker identity remained `956c53f0-69f1-408c-98d2-65462f0bc307`; its SBO bridge epoch advanced from `:3` to `:6`. The same sportsbook tab remained open throughout.

The first sampled fresh catalog arrived **30,309 ms after the pre-stop record**, at ten-second sampling resolution. Of 16 post-restart samples, the first two were stale and the remaining **14 were consecutively FRESH**, spanning **138,278 ms**. Maximum catalog age among fresh samples was **4,571 ms**. The last finite-observer sample had **528 events, 7,542 markets and 15,084 quotes**, with **387 quote changes in the preceding 60 seconds**. Recovery stage was NONE, attempt zero, and the feed was LIVE. The controller still retains an older `BROWSER_REFRESH_DISABLED` failure field; this was not presented as an entirely green diagnostic pipeline.

The final public catalog check returned HTTP 200/FRESH with **528 events, 7,734 markets and 15,468 quotes**. The public page/health returned the 0.2.109 stack identity, and the public realtime connection returned a SNAPSHOT. The dashboard showed SBO participating in matched comparisons. The finite observer has exited and the deployment lease has been released. Evidence: `live-109.json`, `api-restart-before.json`, `reconnect-result.json`, `public-catalog.json` in the task artifact directory. Earlier failed restart records remain in `api-restart-before-107.json` and `api-restart-before-108.json`.

This verifies recovery from the reproduced API restart with the current provider page and attached worker configuration, plus the short subsequent updating window. It does not establish long-duration availability, full market coverage, native WebSocket repair, IM recovery or a whole-machine CPU fix.

Artifacts: `.run/sbo-recovery-2026-09-09/` (live samples, public catalog checks, deployment receipt, local screenshots); `.run/dev-tunnel-2026-09-09/` (HTTP and WebSocket checks). `live-104.json` records the failed intermediate run; it is not final acceptance evidence.
