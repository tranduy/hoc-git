# Six-provider page lease design

## Goal

Keep the six football catalog sources alive without depending on externally supplied URL tokens, while treating a newly completed provider catalog baseline—not a loaded page or HTTP 200—as recovery success.

## Provider session model

- CMD uses the existing Chrome cookie/header session. Its exact-tab 20-minute reload remains the renewal path.
- BTI starts from its public anonymous football URL. The provider may mint internal browser tokens, but the extension does not persist or supply an operator token.
- IM starts from its public Vietnamese root. Each navigation invalidates the captured `GetSE` request template; the observer must capture a new two-part baseline from the replacement document.
- APSPORT/TSPORT starts from `pacific.agenate.com`; `token` is optional and `t` is a per-navigation cache/session nonce. Renewal preserves the selected sport/period and replaces `t`.
- KSPORT starts from `zenandfe.com`; a non-empty URL token is not a prerequisite. Renewal selects football, Vietnamese locale, and replaces `t`; a complete source still requires Live and Today baselines.
- SABA starts from `/NewIndex` without manufacturing the cookieless `/(S(...))/` path. The server redirect owns the new session identifier; a complete Socket.IO `reset`/football/`done` generation owns the catalog.

## Architecture

Add one `ProviderPageLeaseCoordinator` for BTI, IM, TSPORT, KSPORT, and SABA. It owns one persisted schedule per lobby, a single global in-flight renewal, a 20-minute lease, a 30-second loading deferral, and a five-minute failure cooldown. It never creates, removes, substitutes, or focuses a tab.

Every renewal calls a provider URL policy, validates the current tab and derived URL against the expected lobby, attaches the observer before navigation, starts a new source epoch, and then updates the exact tab. Periodic renewals and API hard-recovery commands use this same boundary so provider-specific URL renewal cannot be bypassed by a generic reload.

CMD stays on `CmdPageKeepalive`, but its tick is serialized with the new coordinator so only one provider page is renewed at a time.

## Catalog correctness

Starting a source epoch prevents the previous document from publishing additional quotes after navigation. The API feed registry remains the authority for recovery completion: it accepts only a fresh complete baseline after the action. Disappeared events are removed by the replacement baseline, while changed lines and prices enter as the new generation.

The extension schedule records only navigation completion. It does not label a source recovered. Existing automatic source recovery waits up to 90 seconds for a fresh baseline and enforces the five-minute hard-action interval.

## URL policies

- BTI: `https://prod20091.fxf774.com/vi/asian-view/today/B%C3%B3ng-%C4%91%C3%A1?operatorToken=logout`.
- IM: `https://imsports.directsb.net/?languageCode=vi`.
- TSPORT: preserve the exact trusted Pacific origin and current `agentId`, `lng`, `sportType`, `sportId`, and `periodId`; remove `token`; replace `t`.
- KSPORT: trusted `https://zenandfe.com/`; preserve `agentId` when present, default it to `4`, force `sportId=1` and `lng=vi`, remove `token`, replace `t`.
- SABA: preserve the trusted SABA origin and public display parameters (`lang`, `webskintype`, `scmt`, `ssmt`), replace the path with `/NewIndex`, and remove event-detail parameters and any token.

## Safety and acceptance

- A periodic or hard renewal must keep the same tab ID and must not call `chrome.tabs.create`.
- A URL derived for another provider, an error/detail page, a missing tab, or a replaced attachment fails closed.
- Persisted schedule data is parsed strictly and malformed state is ignored.
- Unit tests cover every URL transformation, exact-tab identity checks, staggering, loading deferral, failure cooldown, manual/scheduled coalescing, and no-token KSPORT recovery.
- Focused extension tests, extension typecheck/build, repository diff checks, and a live catalog status observation are required before completion is claimed.

