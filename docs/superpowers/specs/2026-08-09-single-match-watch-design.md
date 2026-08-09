# Single-match live watcher design

## Outcome

Add a read-only screen that lets the operator select one accepted provider event and observe every supported market and quote change without placing a wager. The screen must make price movement, market suspension/reopening, polling health, and any *candidate* two-book balance window easy to understand. It must never describe a single-provider price change as an arbitrage opportunity.

The first live proof uses an event that is genuinely present in a connected provider feed. G2 vs TH may be selected only if a verified LoL adapter returns that event. The current CMD integration is Football-only, so the UI must state that limitation instead of fabricating a G2 vs TH feed.

## Interaction

The Live Catalog page adds a `View & watch` action to each event. One event can be watched at a time. Selecting it replaces the list with a dedicated match-detail view inspired by a compact bookmaker comparison card: match header at the top, one provider column per source, market rows below, and the movement timeline beside or below them. A `Back to matches` action returns to the list. The selected account and event ID are represented in the URL query so the same detail can be reopened without exposing credentials. The detail view contains:

- provider, competition, participants, live/upcoming state, and last successful observation time;
- watcher state: `STARTING`, `WATCHING`, `STALE`, `STOPPED`, or `ERROR`;
- the current market table with line, selection, odds, and `OPEN`/`SUSPENDED` status;
- an append-only, newest-first change log capped at 200 entries;
- `Stop watching` and `Clear log` controls.

Each market row aligns equivalent provider selections horizontally only after exact mapping. An unavailable second provider renders an explicit empty column rather than copying the first provider's values. On narrow screens the provider columns scroll horizontally and the change log moves below the current prices.

The log persists in browser `localStorage` by account and provider-event ID so a refresh does not erase the observations. It contains provider sports data only; account IDs, tokens, cookies, launch URLs, authorization data, and credentials are never stored in watcher logs.

## Sampling and change detection

The watcher performs sequential catalog reads. The next read starts one second after the prior read settles, so slow provider reads never overlap. Each accepted response is filtered to the selected event before comparison.

Stable identities are:

- event: provider plus `providerEventId`;
- market: provider plus `providerEventId` plus `providerMarketId`;
- quote: market identity plus `providerSelectionId`.

The pure diff engine emits only real transitions:

- `ODDS_CHANGED`: old odds and format to new odds and format;
- `MARKET_SUSPENDED`: `OPEN` to `SUSPENDED`;
- `MARKET_REOPENED`: `SUSPENDED` to `OPEN`;
- `QUOTE_SUSPENDED` or `QUOTE_REOPENED` where the provider exposes selection status;
- `EVENT_MISSING`: the selected event disappears from an otherwise valid response;
- `POLL_FAILED` or `STALE`: the provider read fails or no accepted update arrives within the configured freshness boundary.

Every row records local detection time, provider observation time, elapsed time since the previous successful sample, match, market type/scope/line, selection, old/new values, and current availability. Unchanged samples do not create noisy log rows but do update watcher health and sample counters.

## Candidate balance-window logging

`CANDIDATE_WINDOW_OPENED` is emitted only when two distinct verified providers are connected and the existing exact mapping and opportunity engine confirms the same canonical event, market, line, settlement rules, and complete outcome domain. It records both provider quotes, quote ages, native stakes, base-currency stakes, fees, FX assumptions, worst-case profit, realized ROI, and all eligibility checks.

`CANDIDATE_WINDOW_CLOSED` is emitted when that verified opportunity disappears or becomes ineligible. A market suspension, stale quote, sequence gap, schema error, insufficient balance, or incomplete mapping closes the window immediately.

With only CMD connected, the panel shows `Single-provider observation — cross-book timing unavailable`. It may report CMD detection intervals and price movement but must not emit a balance-window event or estimate cross-provider delay. The system observes latency; it cannot alter a bookmaker's update latency.

## Safety and execution boundary

This feature has no wager endpoint and no bet button. A line saying “candidate window” is evidence for later review, not permission or a guarantee. Any future execution flow remains subject to fresh two-account validation, balance checks, exact market revalidation, odds tolerance, stake constraints, and explicit user confirmation immediately before both non-atomic legs.

## Verification

Unit tests lock exact behavior for odds changes, suspension/reopening, no-change samples, unrelated events, disappearance, stale/failure events, stable identities, log bounds, and secret-free persistence. Component tests use deferred promises to prove catalog reads never overlap and verify start/stop/clear/reload behavior. A live smoke test monitors one genuinely returned event for a bounded interval and records safe metadata only. If no price changes occur during the interval, the result reports unchanged samples honestly rather than manufacturing movement.
