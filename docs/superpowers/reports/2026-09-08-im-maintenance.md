# IM maintenance — 2026-09-08

Status: **NOT ACCEPTED — IM still returns native 501 and publishes no fresh baseline.** Prior full-market acquisition evidence remains in `2026-09-08-im-full-native-production.md`; this change concerns continuous collection and recovery.

## Observed failure

- The production collector stopped advancing after the accepted full capture. A later request returned HTTP 200 / native StatusCode 501. This is not proof of token expiry.
- The user demonstrated that IM still displayed current matches and prices in another browser. Isolate the current browser/session/collector before blaming general provider availability.
- With active collection paused in managed Chrome, the existing document had SiteProfile.StatusCode 100, member flag true, and its profile token matched session storage. No token value was exported. The collector had zero active requests.

## Changes

- Resume the retained detail queue on maintenance ticks, including after a failed roster request.
- Follow native GetSP bootstrap: require this document's successful member SiteProfile and matching current session token before signing or fetching. Recheck before each request and after signing. Read the current token, never a consumed launch URL fallback.
- Match native authenticated signing mode 2. Retire/abort owned requests when auth is no longer ready.
- Pause the whole queue for 30 seconds after native errors or HTTP 429, preventing per-event retries from hammering all other owners. Keep receipt clocks and avoid publishing cached pairs as fresh.
- Add an origin-scoped diagnostic pause which leaves native requests and passive capture running; it expires automatically after 30 seconds so inaccessible inspection UI cannot leave collection disabled.
- Preserve the native language, odds-preference and visitor headers. Surface bounded native status numbers in API diagnostics without exporting tokens, headers or provider bodies.
- Recover only IM via the authenticated portal's exact football card; never synthesize/reuse launch tokens. Serialize recovery and retain old tabs until a fresh paired GetSE baseline is accepted for the new document. Limit portal relaunches to one per five minutes.

## Acceptance

Focused checks passed: collector 21; observer IM 24; document readiness 6; source recovery 48; API recovery 57. The actual duplicated portal-card regression passed. API build and extension typecheck/build passed. A broader observer-file run also exposed six unrelated BTI/KSPORT failures; those were not investigated or changed in this IM task.

Native portal recovery actually created managed IM tabs, including `2105832228`. The collector was paused during the initial native launch. However, no new native GetSE response was captured during that pause, so it did **not** establish whether the provider's own requests were healthy without the collector. After collection resumed, the new source still returned native 501. The prior signing mode 127 was also tried in a bounded diagnostic deployment and returned 501; the final source restores native mode 2.

Evidence: `.run/parallel-hidden-markets-2026-09-08/im/maintenance083.jsonl` records repeated zero decoded updates / zero price changes. `maintenance085-native-501.json` records the fresh source's native-status-501 outcome. Do not infer token expiry or a general provider outage from these results. Whether the user's working browser uses the same Fabet account is still unconfirmed.

The final recovery path removes a newly created, failed IM candidate only after rechecking that its tab still belongs to IM; previous tabs are retained. A successful replacement must have a fresh paired baseline before removing prior IM sources. No 24-hour acceptance is claimed.

Final deployment: extension **0.2.86**, `sha256:72f762040fb9e13baf2dd586f6f1c6604620d96230a32516aa7b96ff92824a21`; stack `sha256:0e33b17d5929f32c986031e92929d2c4d97c104edff7cfe077c7288c8d88f85c`. Final runtime evidence: `maintenance086-final.json`.
