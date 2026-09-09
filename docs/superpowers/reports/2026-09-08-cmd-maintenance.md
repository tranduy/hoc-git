# CMD continuous maintenance — 2026-09-08

Extension **0.2.89** is deployed on MAIN `feat/realtime-hardening`. This phase keeps the existing CMD acquisition running without periodic navigation of a healthy document. Prior full Early/More coverage remains documented in [the acquisition report](2026-09-08-cmd-early-more-production.md). IM remains suspended. New hard-reload/replacement escalation was deferred by the user; the existing failure recovery remains, with additional cooldown guards.

## Changes

- Scheduled CMD keepalive defers while a complete observed baseline is less than 30 seconds old. It checks again after 30 seconds without changing quote clocks or declaring stale data fresh. An overdue persisted schedule gets 90 seconds to observe the retained page after an extension-worker restart.
- HTTP/native-request callback failures pause both owned roster and More work for 30 seconds, doubling on repeated failed attempts up to five minutes. Concurrent failures share one backoff window. Longer numeric/date `Retry-After` values are honored. HTTP 401/403 receives a 15-minute quiet window; no login, new account or session is manufactured.
- Backoff stays in the current page across observer/source-generation changes. Already-running native requests finish in their existing physical slots under the provider helper's 7.5-second timeout. A sibling success cannot erase an active cooldown. This is not a promise that the tool cancels or suppresses the provider page's independent requests.
- More keeps two physical requests at most. After a completion it waits at least 500 ms before starting queued replacements; maintenance ticks cannot bypass that pause. A silent maintenance caller stops queue draining after the existing 15-second ownership window. No source/API receipt timestamp is refreshed by replay or by a failed attempt.
- The legacy full-baseline action checks page cooldown before invoking the native loader. Existing recovery reads cooldown from the owned current CMD frame before bootstrap/navigation/replacement. `CMD_REQUEST_BACKOFF` is propagated instead of being mistaken for renderer failure. Final tab identity checks still follow every awaited bootstrap/probe and precede navigation.

## Verification

Initial behavior tests reproduced the old periodic reload (72 scheduled reloads in a simulated day), unpaced callback draining, and missing shared backoff. New tests verify retained clocks, generation retirement, Retry-After seconds/date, 401/403 quiet windows, and queue resumption.

- 74 tests passed across native collector, page keepalive, poller, recovery state and native request metadata.
- 31 CMD observer/integration tests passed; 340 other observer tests were not selected for this scoped run.
- Extension TypeScript check and build passed. Final exact-tab/keepalive rerun: 24 passed (already counted above).
- Independent review identified and verified fixes for a cooldown sampling race and an overdue schedule racing the first post-restart baseline. A further check kept the final navigation identity fence after the awaited cooldown probe. Final review reported no remaining high/medium findings.

## Deployment and measurement boundary

- Extension build: `sha256:9bb778bac65c380eb3866df7cfdda32d9f1f8d3382c0872bc8286199f3699540`.
- Managed stack: `sha256:946d3a6118e13ac3e6e0b46478f017755eaec246ede71bf9ea8ca2d80ae9a692`.
- Stack instance: `eb70a915-fdf4-4d06-8996-d33af0fb1f7c`.
- Handoff completed at `1788886150866` (23:49:10 UTC+7).
- API source registry after handoff: one CMD, BTI, KSPORT, TSPORT and SABA source, zero IM sources.
- The API memory fixes from BTI maintenance remain deployed; this task rebuilt the extension only. Provider tabs were not manually refreshed as a deployment step.

The read-only monitor in `.run/cmd-maintenance/` runs for 24 hours. It records pipeline counts/ages, original-clock More updates, and consumer revision counts; raw prices are compared in memory and never written by this monitor. `monitor.json` records its PID/start/duration. Startup and failed samples remain in `samples.jsonl`; settled acceptance excludes the first ten minutes after handoff. A simulated day is a scheduling regression test, not actual 24-hour acceptance.

Monitor version 2 corrected two scratch-helper assumptions before settled measurement: realtime messages use `type`, and API quotes expose `receivedMonotonicMs` plus `sequence`, not quote-level `observedAtMs`. The original startup rows remain labeled by the absence of `monitorVersion: 2`; their zero revision/clock counts are not acceptance evidence. Clock advancement compares original receipt ordering and does not translate a source monotonic clock into an invented wall-clock age.

The CMD deployment lease has been released. Monitoring runs in hidden processes and makes read-only loopback calls. The preceding BTI watch spans multiple runtime builds; its old 0.2.88 checkpoint must not be relabeled as a new 24-hour acceptance. BTI had a later observed stale/recovery sample before this CMD deployment, already disclosed to the user.

## Final live checkpoint

At 23:59:56 UTC+7, 10 minutes 45 seconds after handoff, the three samples after the required ten-minute cutoff were all LIVE/FRESH with price changes, one source epoch and zero recovery/diagnostic errors. Maximum catalog/evidence age in those samples was 1,222 ms. Latest counts were 738 events and 3,980 markets. This is a short post-startup window, not a long-duration pass.

The first settled More comparison had 1,112 retained quotes and 138 advancing original receipt-clock/sequence pairs, with no changed price lacking an advancing receipt. Two actual More price changes were observed during startup; those remain functional evidence only, separate from settled acceptance. The monitor recorded 377 consumer revisions, one connection, zero disconnects/errors and maximum revision gap 7.8 seconds since monitor version 2 started.

The persisted CMD catalog independently loaded and validated (745 events, 3,694 markets, 7,388 quotes, 556 More quotes and 21,855 native observations in the earlier disk sample). Final API PID remained 17332 with about 651 seconds uptime; monitor PID17224 remained running for its configured 24-hour window. Announced, computed and handoff build identities matched. Source registry still had one CMD and zero IM sources.

Full hidden-price refresh latency and 24-hour uptime remain unverified; neither is inferred from a fresh aggregate baseline. Final numbers and the growing raw counts-only timeline are in `.run/cmd-maintenance/acceptance.json` and `samples.jsonl`.
