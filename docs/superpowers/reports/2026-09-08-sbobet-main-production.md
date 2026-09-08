# SBOBET main deployment and bounded live evidence

The reviewed More collector is integrated into MAIN `feat/realtime-hardening`, commit `31ef4eb82c7ee5c2d266bbc8d4481fa9df8f417a`, and deployed with extension 0.2.68. The user explicitly transferred MAIN and runtime ownership to this SBOBET thread; earlier SABA ownership restrictions are historical.

API build: `sha256:6592ca5c4a5205a352af60071a72c2ccac389f56024d4e3e476fdb266432d52a`. Extension disk build: `sha256:778ae7726cdd5c93e4a2992909399f6a35cbfaaa51fbe494864c52269fca445d`. Deployment used the existing exact-v2 stack handoff and released its coordinator lease. Actual hidden collection and a direct worker manifest readback confirmed running version 0.2.68.

MAIN validation before deployment: 180 API and 110 extension/manifest tests passed. Contracts, adapters, core, API and extension production builds passed. The current observer package had also passed 604 extension and shared-provider regression tests in the isolated current-MAIN staging tree before integration.

## Actual window: 13:17:24–13:27:25 UTC+7

The read-only sampler used the existing catalog, pipeline diagnostics and `/api/realtime`; it made no source requests or page changes. It collected 200 samples over 601,418 ms from `chrome:KSPORT:2105829034`.

- 171 actual hidden quote price changes across 158 selections and 8 events; every change's sampled catalog revision was observed on WebSocket.
- 616 main quote changes. Peak publication: 106 events, 2,367 markets, 4,734 quotes, including 2,604 Decimal More quotes from 63 events.
- Zero native observations marked NORMALIZED while absent from the corresponding published market inventory.
- First segment, source epoch ending `:2`: 134/134 FRESH samples over approximately 6 minutes 43 seconds.
- Source epoch changed to `:7` at 13:24:07. Nine samples were STALE, between 13:24:31 and 13:24:55; the source recovered and refilled More. The whole window therefore does **not** pass uninterrupted stability acceptance.
- Sampled hidden receipt intervals: minimum 191 seconds, median 262 seconds, p95 327 seconds. These are source refresh intervals, separate from the existing 3-second application publication mechanism. Queue throughput remains an open performance issue.

Evidence: ignored local directory `.run/parallel-hidden-markets-2026-09-07/sbobet/production068/`, files `LIVE-MORE-600S.json` and `LIVE-MORE-600S-SUMMARY.json`. Raw file SHA256: `332a2d06fb89e9cdd1a890a58126e09d00808d800282e0ef409bc3570bd128d4`.

## Remaining work

Integrate the current Early roster, prove the complete owner denominator including successful empty More responses, correct the observed refresh/recovery problems, and verify the resulting deployed changes. Retain unsupported native domains in diagnostics. Rendered UI latency and 24-hour operation have not been established. Deployment and actual hidden price updates are proven; full provider acceptance remains open.

## Follow-up fixes and actual Early mechanism

The finite More batch stopped after a fast response because its next permitted request time was still in the future. It now waits within the existing caller's bounded batch, maintaining 250 ms minimum spacing, two physical callbacks and four starts per tick. Regression verifies fast and slow responses, roster cancellation, 429 backoff and callbacks ignoring cancellation. The caller remains the existing two-second provider maintenance path; no new recurring publication timer was added.

Main refresh now retains a successful observed GET URL with its matching headers. Historical performance resources, failed/pending/redirected requests, older responses and explicitly conflicting sport/style requests cannot replace it. These code defects were reproduced; attribution of the earlier live epoch change remains unproven. Four additional publicly proven binary mappings are included for native groups 139, 148, 149 and 154; their fixtures explicitly use synthetic prices, and these groups have not been observed live.

Follow-up verification: 439 observer/integration tests, 38 scheduler tests, 93 direct-catalog tests and 4 manifest tests passed. API production build and extension typecheck/build passed. Candidate extension 0.2.69 disk identity is `sha256:943122e4e6c2282a4b642a04d49da01a9e235823a403986d9d5a75f3385ea0f3`; activation is recorded separately after the source observation ends.

Actual Early navigation calls **GET `/api/v2/getEventByDate`**, not the previously investigated `getEvent?timeRange=early`. A native HTTP 200 response contained 11 owners and 11 rendered rows for one future date; this is not the full Early denominator. Sanitized evidence `CORE-EARLY-BROAD-068-20260908.json` is in the SBOBET exchange directory, SHA256 `ac5d49ff7888bc9ff7be6bb81a56e503c960bbf08f5b720f967c33086d695c3e`. Current request/date enumeration still needs integration; Today was restored after the observation.
