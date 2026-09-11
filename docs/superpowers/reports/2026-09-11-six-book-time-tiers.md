# Six-book time tiers — implementation and runtime verification

Implemented on 2026-09-11 on `feat/realtime-hardening`.

## Policy

| Fixture | Detail refresh target | Observation lifetime |
| --- | --- | --- |
| Live | 5 seconds | 5 seconds |
| Up to five globally matched fixtures starting within 3 hours | 10 seconds | 15 seconds |
| Other fixtures within 3 hours | 30 seconds | 60 seconds |
| 3–6 hours | 60 seconds | 120 seconds |
| 6–13 hours | 120 seconds | 5 minutes |
| 13–24 hours | 10 minutes | 15 minutes |
| 24–72 hours | 60 minutes | 75 minutes |
| Beyond 72 hours | Passive roster; manual request can enqueue detail | Historical observations retained |

These are scheduling targets, not guaranteed provider response times. Provider refusal/backoff and physical request limits remain authoritative. Non-live fixtures with positive kickoff already in the past do not generate new scheduled detail work. Unknown kickoff receives bounded reconciliation rather than a guessed date.

The production fixture matcher selects five unique fixtures globally, before dashboard filters. Native IDs shared across market families count once. The same policy is installed in AP, SBOBET, BTI, CMD and SABA collectors; IM retains its supported native bulk acquisition path and receives the common observation/planning policy.

## Changes

- A bounded exact-source collection-plan protocol carries up to 10,000 native event IDs. Its route has an explicit payload limit; stale revisions are rejected. Manual refresh uses a coalesced nonce and data queue, without tab navigation.
- AP stops admitting legacy all-event detail when a plan arrives, including arrival during an existing sweep. Accepted in-flight data is retained. Cancelled queued work becomes idle rather than a provider failure. Full Retry-After values survive non-JSON refusals and source replacement cannot renew old backoff.
- SBOBET, BTI and CMD detail queues check tiers at admission and execution; SABA publishes scoped partial owner captures without deleting omitted owners or claiming complete hidden coverage.
- Correctly paired receipt clocks are preserved across all providers, catalog caches and subset hydration. Reading cached data or moving a fixture between tiers never renews its prices. Verified-ticket/preflight lifetimes remain unchanged.
- Background hydration reads due matched fixtures. An unpaired fixture cannot keep triggering whole-source roster reads. Event subset reads obtain current native receipt bodies even when semantic prices/ETags are unchanged.
- Historical ROI is displayed separately from current eligible observations. Source counts use `matches` and `markets`, full numbers and icon-only reload buttons.

## Validation

- Final AP/observer integration run: 438 tests passed, including plan arrival during a sweep and preservation of an actual in-flight receipt.
- Other final collector/control-plane selection: 296 tests passed before the last AP additions. Extension typecheck and minified build passed.
- Full web suite: 1,129 passed, zero failed, four existing skips. Subsequent timer regression and related planning/hydration checks: 11 passed. Final web typecheck/build passed; existing large-chunk warning remains.
- Contracts policy/control-message selection: 27 passed.
- API bridge plus revision-store suite: 1,221 passed, eight failed. Three SBOBET fixture failures were reproduced against HEAD; five replay cases require missing local capture files. The new receipt-anchor semantic-revision regression was fixed and its regression tests passed. API typecheck/build passed.
- Maximum valid escaped collection plan measured 8,220,069 bytes, below its 10 MiB route limit. The application-wide limit remains unchanged.

## Runtime checks and remaining limits

API/dashboard were replaced using recorded process identities. Chrome PID 23212 and its original creation time were preserved. No CGNEW/jackpot tab was restarted or closed. The deployed extension identity is `sha256:58a4ff0ed0eccae0b5c188af5f42bf4869a6f2c2ee126ca9ae405dd813ae03c8`; dashboard asset is `index-ABj5qzw5.js`.

At 13:38 UTC+7, SABA, IM, SBOBET, AP and BTI accepted collection plans with HTTP 202. Actual quote samples contained paired clocks. AP queue diagnostics showed zero stale queued flags and zero failed detail events, rather than the former hundreds of cancelled entries reported as queued.

An isolated dashboard check showed 9,962 comparison groups, populated ROI rows, no JavaScript page errors and no overflowing provider cards. This establishes that the new dashboard loads and compares actual data; it does not establish continuously fresh odds or profitable executable tickets.

Outstanding constraints:

1. CMD's native football frame was missing before deployment; its catalog was already over an hour old. CMD remained a candidate source and rejected plans with `SOURCE_NOT_ATTACHED`. Existing hard recovery can reload/replace the entire attached CGNEW tab, so it was not invoked under the user's restriction. The CMD scheduler code is implemented but cannot run against an absent native frame.
2. IM's supported GetSE acquisition remains bulk, with existing admission/backoff. No verified DateTo filter was available. Its actual data still occasionally exceeds the urgent 15-second observation lifetime; this work does not promise a 10-second upstream IM cycle.
3. The realtime revision protocol does not identify changed event IDs. Realtime updates therefore still hydrate all paired events to apply incoming suspensions promptly. Only background hydration is fully tiered; some large-catalog copying remains.
4. Provider disconnections and missing native frames are separate from detail workload. The time-tier policy is not evidence that all prior recovery problems are eliminated.

Local verification artifacts: `.run/time-tiers-20260911/runtime-audit.json`, `dashboard-final.json`, `dashboard-final.png`; `.run/bridge-tier-review-results.json`, `.run/bridge-tier-baseline-proof.txt`; `artifacts/time-tier-verified-final.json`.
