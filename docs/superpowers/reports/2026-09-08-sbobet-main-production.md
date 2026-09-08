# SBOBET main deployment and bounded live evidence

## Current status: 0.2.70 deployed; expanded coverage verification running

The completed 0.2.70 window (14:08:29-14:18:30 UTC+7) has 200 FRESH samples, one epoch, zero errors, 306 hidden changes and 753 main changes; raw evidence SHA256 `6c20a18d3c5dd66bd0d57122901ac6ac22e17f9772db76c2cb3529137b55dea0`. Passive native comparison matched **109/109 prematch IDs** and 3 eligible live IDs. More was captured for 108 owners (63 priced, 45 valid empty); 1,301 supported market IDs were additional to captured main. Existing line/price differences had newer API receipts. Native artifact `production070/coverage-native-1788851680548.json` SHA256 `6d1f945c6bb6ff43ae46c6ed062f1d3db8eff7d201a962b3e3c1c32c9f5e0351`; findings are in `production070/COVERAGE-FINDINGS-1788851680548.json`.

Actual Early startup failure is identified: successful native Live/Today HTTP requests originate in the site's worker session, without a frame ID or loader ID. The document-only Early template admission therefore never arms. Version 0.2.71 binds the verified worker request URL/headers to the independently verified current More document for execution, retaining both worker and document lifecycle fences. Early responses must also avoid replacing their own main-request provenance. This is a targeted activation correction; no API change or expanded audit is required.

Commit `f46e3ce` is deployed at approximately 14:07 UTC+7 with extension 0.2.70, actual worker confirmed at 14:09:51. API build `sha256:84ce9e33fae79b5fc0f1832b08115ed07da4a77173a9a67d1e288c26e1532bac`, extension build `sha256:4f0d4e0ca267d31b75fdba56643e8b03f6ad62723311bed71a5376ed2dfc5c6a`; exact handoff completed and lease released. Final validation: 249 API tests, 511 observer/discovery tests, 58 Early protocol tests, 55 More protocol/scheduler tests and four manifest tests passed, as did API/extension typechecks and production builds. Peer review found and verified fixes for Early-to-Today clock migration and old HTTP resurrecting withdrawn More markets. The current passive window starts at 14:08:29. More is updating, but Early has not appeared in the initial live catalog; this is being investigated and full coverage is not accepted.

MAIN is `feat/realtime-hardening`; More integration is committed in `31ef4eb82c7ee5c2d266bbc8d4481fa9df8f417a` and `7f9a8156437d2ebee09c4d52ea9ca1a286ff5c8c`. The exact-v2 handoff activated extension **0.2.69**, confirmed by actual worker manifest readback, and released its coordinator lease. API build: `sha256:bbda500b18a96ef82b6246599484a53bda5219fce245786ea511f1b300b33ca7`. Extension build: `sha256:943122e4e6c2282a4b642a04d49da01a9e235823a403986d9d5a75f3385ea0f3`.

The 13:52:21-14:02:23 UTC+7 read-only window on 2026-09-08 collected **200/200 FRESH samples over 602,113 ms**, one source epoch, zero errors and zero failing pipeline hops. It recorded **293 actual hidden quote price/status changes** across 285 selections and 15 owners, all associated revisions observed on WebSocket, plus 504 main changes and 199 revision messages. Peak: 2,388 markets and 4,776 quotes. Final: 109 events, including 2,618 Decimal More quotes from 63 owners. Zero native NORMALIZED observations were absent from market publication. Sampled hidden receipt intervals: minimum 72 seconds, median 164 seconds, p95 189 seconds; unchanged records were capped at 4,000, so these are bounded estimates, separate from the existing 3-second application publication cadence.

Evidence: `.run/parallel-hidden-markets-2026-09-07/sbobet/production069/LIVE-MORE-600S.json` and its summary; raw SHA256 `056c7222a367f9e0823e754a7e90fe6358109cad592ce328df6b0d1925766da1`. This proves bounded ongoing More updates and stability, not 24-hour operation.

Native Early defaults to one date, but **All Dates** uses unfiltered `getEvent?timeRange=early` with the current football/Malay scope and private agent parameter. Actual HTTP 200: **377 owners in 47 leagues, 7,707 native rows**, matching 377 rendered rows. Original response: 707,480 bytes, SHA256 `81f27a9f88772e9409ccec2267f22c470b1aa483616f9f7969bf0385d1509644`. Sanitized exchange evidence `CORE-ALL-EARLY-NATIVE-069-20260908.json`, SHA256 `efb4a2aacdd43c2372d9ffd9891a1cfc1053f4468b272ced5a7a5a47d1f43c8a`, retains all native rows and records metadata URL redactions. Today was restored afterwards.

Version 0.2.70 derives a bounded All Early refresh only from a successful current native main request, forwards actual correlated HTTP receipts through existing chunking/bridge/revision paths, and feeds the Today-plus-Early-minus-Live roster into More. Early membership stays separate from Today and preserves newer WebSocket clocks during migration.

More-view completeness is now supported by source evidence: the ordinary five-parameter `getEventBetMore` response replaces the native local More state; display tabs filter that returned map locally. Public bundle SHA256 `f8af91799b2562f12ba14c3c37b468173f46b45c597d5a3c37c4045071f2240a`, request builder around offset 136080; chunk SHA256 `c37303b372b886e0a1e55af3d934530570ad3ac579b8d4718b4391f35168a68c`, fetch/state replacement 1045040-1046240 and local filtering around 1039745. Group 0 is display metadata. Valid current HTTP 200, including empty, has authority over its More membership only; HTTP errors, wrong scope and legacy payloads cannot remove markets. Independent main/full-event domains and newer receipts must remain intact.

The expanded 0.2.70 build still requires activation and a current Today-plus-Early denominator comparison against actual More responses, including successful empty results. Full provider acceptance remains open. The following sections retain the preceding deployment history.

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
