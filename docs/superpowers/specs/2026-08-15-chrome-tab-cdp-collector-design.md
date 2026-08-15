# Chrome Tab Traffic Collector Design

## Goal

Replace the browser-per-provider football collectors with one lightweight, read-only pipeline that observes the already authenticated Chrome tabs listed in `F:\0. PROJECT\tool-chenh\sảnh.md`, decodes their WebSocket/XHR traffic, and feeds fresh normalized odds into the existing mapping, ROI, ranking, and toast pipeline.

The supported lobby labels are IM, BTI, T-SPORT, K-SPORT, SABA, CMD, and SBO. URLs, tokens, cookies, session identifiers, and query strings from `sảnh.md` are runtime secrets and must never be copied into source code, test fixtures, logs, or durable captures.

## Selected approach

Use a local Manifest V3 Chrome extension with the `debugger`, `tabs`, and narrowly scoped localhost permissions. The extension attaches to selected, already-open sportsbook tabs and subscribes to Chrome DevTools Protocol Network events. It sends redacted network envelopes to the local API through one authenticated localhost WebSocket.

This replaces the guide's `--remote-debugging-port=9222` bootstrap because the user's current Chrome 151 process was not started with that port and Chrome 136+ rejects remote debugging against the default profile. A dedicated CDP profile would require a new login and would not preserve the current tabs. The extension observes the same CDP Network domain while preserving the active user profile and sessions.

## Scope and safety boundaries

- Read-only observation: no odds click, bet-slip interaction, wager submission, login automation, CAPTCHA handling, or provider mutation.
- Football only. LoL collection remains disabled during this phase.
- Target markets are two-outcome football Asian Handicap tickets with quarter/half lines required by the current product scope. Exact-score and three-way draw markets are excluded.
- Stale data may be displayed only with an explicit stale label. It cannot create a positive signal, green state, toast, or ranked executable candidate.
- The collector never invents events to meet a display count. The dashboard shows up to 25 real mapped candidates; if fewer than 7 exist, it reports the exact source/mapping shortfall.
- Existing headless collectors are disabled once the Chrome-tab source has demonstrated a fresh catalog for the same source. There is no simultaneous last-writer competition between old and new collectors.

## Architecture

### 1. Chrome extension

The extension has four focused modules:

- `tab-registry`: discovers matching open tabs, exposes their attachment state, and prevents duplicate attachment.
- `network-observer`: enables `Network`, consumes `Network.webSocketFrameReceived`, `Network.responseReceived`, `Network.loadingFinished`, and retrieves eligible response bodies.
- `redactor`: removes URL queries, cookies, authorization headers, token-like fields, and session identifiers before data leaves the extension.
- `local-bridge`: maintains one bounded, reconnecting WebSocket to the local API and applies backpressure instead of buffering without limit.

Attaching a tab is an explicit user action in the extension popup. The popup lists the seven configured lobby labels and shows `FOUND`, `ATTACHED`, `LIVE`, `STALE`, or `ERROR`. Reloading or navigating a tab triggers reattachment without requiring the dashboard to restart.

### 2. Local ingestion API

The API exposes a loopback-only WebSocket endpoint for extension traffic. A random installation key generated locally authenticates the connection; it is never included in browser payload logs. Each envelope contains:

- source/tab identity;
- sanitized hostname and pathname class;
- transport type (`WEBSOCKET` or `HTTP`);
- monotonic receive sequence and timestamps;
- response metadata required for routing;
- redacted payload bytes or text.

The server validates envelope size, source identity, ordering, and schema before dispatch. Invalid or oversized data is dropped per source and cannot quarantine healthy sources.

### 3. Adapter routing

Domain matching is only a hint because provider domains change. Each adapter also owns a traffic fingerprint based on protocol shape, endpoint path class, message framing, and stable schema markers. A tab becomes trusted for a lobby only after both its configured hint and an adapter fingerprint agree.

Adapters are separate for IM, BTI, T-SPORT, K-SPORT, SABA, CMD, and SBO. Where two lobby labels resolve to the same bookmaker family, they retain distinct source IDs but are never paired against one another as independent books unless their account and settlement identities are proven distinct.

Adapters output the existing normalized event, market, and quote contracts. Provider event IDs, market IDs, selection IDs, raw display lines, source timestamps, live status, score, and clock are retained as evidence.

### 4. Quote lifecycle and mapping

The in-memory quote book replaces a source's full market set on authoritative snapshots and applies ordered deltas only after a baseline. Quotes older than 20 seconds cannot signal; quotes not refreshed for 45 seconds are removed.

Cross-source event matching requires normalized participant names, compatible competition, start time within tolerance, equal live/prematch state, and non-contradictory score/clock evidence. A market match additionally requires the same period, Asian Handicap type, signed line semantics, and exact opposing selection domain. Ambiguous events remain in mapping review and never enter the profit list.

### 5. Profit output

Every accepted fresh update recomputes affected candidates immediately. Candidates are sorted by worst-case ROI descending. The UI displays the best opposing leg from each source, both decimal odds, source age, balanced stakes, outcome profit, and worst-case ROI. A right-side toast lives for 10 seconds only when the configured ROI threshold is exceeded by fresh, exactly mapped data.

## Operational behavior

- The web/API stack can start without Chrome; the dashboard then reports `Chrome bridge disconnected` rather than `no matches`.
- Opening a recognized tab makes it appear in the source list automatically.
- The user attaches it once through the extension popup. The extension remembers only the lobby-to-tab preference, not provider secrets.
- Closing a tab immediately marks that source unavailable and withdraws its signals.
- Provider pages remain responsible for their own authenticated sessions. If a page logs out, redirects, or stops producing traffic, the source becomes stale/error with a specific diagnostic.
- The extension and API expose counters for frames received, decoded quotes, rejected messages, latest source timestamp, source age, and adapter reason.

## Testing and acceptance

Implementation is test-driven and uses sanitized captures only.

1. Unit tests prove redaction, domain/fingerprint routing, framing, ordering, TTL, and bounded buffering.
2. Each adapter must pass replay tests containing initial snapshots, deltas, suspended markets, removed markets, and a schema mismatch.
3. Mapping tests reject reversed signs, quarter-line settlement mismatches, live/prematch mixing, score contradictions, generic-team-name collisions, and same-family source pairing.
4. Integration tests stream interleaved traffic from at least two sources and prove that only exact fresh pairs reach ranking and toast output.
5. Live acceptance for a lobby requires at least 10 consecutive minutes without reader timeout, an observed odds update appearing on the dashboard, zero secret leakage, and bounded Chrome/API memory growth.
6. The legacy collector is disabled for a source only after that source passes live acceptance.

## Delivery order

1. Extension shell, explicit tab attachment, redaction, and authenticated localhost bridge.
2. API ingestion, diagnostics, quote lifecycle, and dashboard source state.
3. Capture/replay tooling that produces sanitized fixtures.
4. Adapter delivery one lobby at a time: SABA first using the currently visible football tab, then IM, BTI, K-SPORT, T-SPORT, CMD, and SBO according to live traffic availability.
5. Cross-source exact mapping and ROI verification against captured simultaneous markets.
6. Disable the corresponding legacy headless source after each adapter passes live acceptance.

## Non-goals

- Automated wagering or execution preflight.
- Credential extraction from Chrome.
- Bypassing authentication, anti-bot controls, CAPTCHA, or browser security restrictions.
- Scraping closed tabs or obtaining provider data when the user's session is no longer valid.
