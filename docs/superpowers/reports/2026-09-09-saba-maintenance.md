# SABA continuous maintenance — 2026-09-09

Extension **0.2.96** bounds SABA recovery work and preserves healthy live observation. The user requested SABA maintenance after BTI, CMD and SBO; IM remains paused. New hard reload/replacement work remains deferred, and no provider page is reloaded as a deployment step.

## Resulting behavior

- Heavy SABA socket recovery shares one budget across refresh, orphan detection and silence recovery: at most three admitted rounds, at least 30 seconds apart, then a five-minute pause. The deadline and attempt count are saved before work begins in `chrome.storage.local`; worker/source/API changes cannot erase the stored pause. Failed storage admission does not start provider work.
- Each admitted round runs at most three physical heap queries. A cursor continues through later attached contexts and socket strategies on the next round, and resets after success or exhausting the candidates. This limits bursts without permanently skipping an owner in a later frame.
- Page/iframe heap discovery is deferred while a usable DOM catalog receipt is 0–30 seconds old. Attached worker candidates remain eligible. The guard checks before prototype discovery, after its response, after admission, and before reconnecting a socket whose heap result arrived later. Skipped candidates consume no heavy-recovery admission; a round reserves its persisted deadline just before its first eligible heap query. Existing lightweight prototype discovery retains its separate five-second throttle.
- Only one physical SABA heap query may remain outstanding in the worker. A ten-second logical timeout does not release that ownership; source retirement does not permit an overlapping query. A result that arrives after timeout cannot close sockets, and its remote object group is released. Unique group names keep late cleanup separate from later recovery.
- A structurally complete socket catalog protects the healthy document only while its observed frame is at most 30 seconds old. Recovery checks this again after asynchronous work, so a fresh baseline arriving while a scan runs prevents an unnecessary socket close. The existing 150-second DOM page-preservation lease and API freshness requirements are unchanged.
- Concurrent startup callers share one bootstrap operation for the same source/tab generation. It tries at approximately 0, 15 and 45 seconds, plus operation duration, and stops when a complete baseline arrives or the generation changes. No extra initial refresh runs alongside that chain.
- Existing silence recovery can detect an old complete buffer. This change adds no new hard-recovery stage, navigation mechanism, session rotation or account rotation. Passive incoming data remains observable during a recovery pause.

The physical-query ownership guarantee is within one running worker; the persisted deadline, rather than an in-memory promise, carries admission across worker restarts. The budget limits heavy recovery, not ordinary passive provider messages or every existing page-health check.

## Verification

- **343 passed** across SABA filename matches, source-tab recovery and provider page lease tests, including ten focused maintenance regressions.
- **81 passed** in the SABA subset of the shared observer suite.
- **83 passed** in the KSPORT subset of the shared observer suite.
- **218 passed** across API SABA tests.
- Extension TypeScript check, full workspace build and whitespace checks passed. The web build retains its existing warning about a bundle larger than 500 kB.
- New focused tests cover shared three-round admission, persisted restart state, concurrent callers, storage failures, healthy and expired socket evidence, bootstrap cancellation, bounded scans with continuation to a later owner, and an unresolved heap query across a logical timeout/source change.
- Independent review reproduced an initially unbounded scan burst across attached contexts. The regression failed before adding the three-query cap and continuation cursor, then passed. Final review approved the bounded scan, continuation/reset, timeout ownership and cleanup with no remaining important findings.
- Live startup exposed page heap queries still coinciding with long data gaps despite the physical overlap limit. Fresh-DOM deferral was reproduced and tested for root pages, iframe sessions and workers. Review also reproduced a fresh DOM receipt arriving while a page query was pending; the final mutation guard stops that late socket close, preserves the spent budget and releases its object group. These regressions passed, and final bounded review reported no remaining findings.

These are scoped passing suites, not a claim that every repository test was run. An initial API command did not start tests because the package script already supplied `--maxWorkers`; the successful 218-test run invoked Vitest directly with one worker.

## Deployment and observation

Extension build: `sha256:159613b91a0a0ffd407a3e3329419518624f827967998881b5e9657b81f19f9d`.

Managed stack: `sha256:5679fdc8a567da7c45f373858105a6faee3e27738c69d8adae88e6bd3644bce5`, instance `29f222b9-7f69-4203-bf59-14d6bbb6cddd`. Handoff completed at `1788895682016` (02:28:02 UTC+7); the new worker's SABA source epoch is `a602e961-1b5e-49c4-8946-52809d2db7c7:4`.

The initial 0.2.95 run is preserved under `.run/saba-maintenance/startup-0.2.95/`. Its startup contained seven catalog-age samples over 30 seconds and a 91.47-second consumer revision gap, alongside timed-out page heap queries. Its seven post-startup samples were LIVE/FRESH and under 30 seconds, but the initial gap motivated the additional page protection in 0.2.96. This is observed correlation, not a renderer CPU profile proving sole causation. SABA's existing DOM feed evidence policy can label ages beyond 30 seconds fresh; this change does not alter that policy, the 150-second page-preservation lease or the underlying timestamps.

The managed deployment also includes the previously verified web CPU fixes in its production build. The finite observer in `.run/saba-maintenance/` read loopback diagnostics every 15 seconds and compared SABA receipts once a minute, retaining price values only in memory. Artifacts contain counts, ages, epochs and clock-progress counters. The first ten minutes after deployment were excluded from operational acceptance. No 24-hour availability claim is made.

A 28.054-second CPU sample after the ten-minute cutoff measured **33.3% total CPU on average, 62% peak, 10.5% Chrome average and 9.6% API average**, normalized to 16 logical processors. API PID `27956` remained unchanged. These are short observed loads, not a controlled browser performance comparison; overall machine lag is not proven eliminated. The sample is saved in `.run/saba-maintenance/cpu-settled.json`.

Final observation completed at `1788896445092` (02:40:45 UTC+7). After the cutoff at `1788896282016`, **8/8 samples were LIVE/FRESH and changing**, with maximum catalog/evidence age **7,219 ms**, one source epoch, zero feed recovery attempts and zero diagnostic-read errors. The last sampled catalog contained **51 events, 272 markets and 544 quotes**. These are the currently published fallback catalog counts, not proof of complete hidden-market or all-period coverage.

Two quote comparisons collected after the cutoff recorded **548 changed prices and 1,048 advancing clocks/sequences**, with no changed price whose clock failed to advance. Socket recovery reached three admitted worker rounds and stayed there through the remaining samples; outcome labels confirm page/iframe scans were deferred for fresh DOM, with no page query timeout observed on the new worker. The consumer connection had no disconnects/errors and received 91 revision notifications over the full run. The maximum revision gap, including startup, was 45,739 ms.

The 36 startup samples remain separate: 34 were LIVE/FRESH and two sampled a stream-gap episode. It recovered automatically on the same source before the cutoff, without manual provider-page intervention. Startup counters initially also include the retiring 0.2.95 worker, so their maximum reconnect count must not be attributed entirely to 0.2.96.

`.run/saba-maintenance/acceptance.json` confirms matching deployed/build identities and exactly one source each for CMD/SABA/KSPORT/TSPORT/BTI, with no IM source. The finite observer exited successfully; normal application and extension maintenance remain running.
