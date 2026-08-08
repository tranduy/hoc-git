# Redacted protocol-capture contract

## Purpose and boundary

This is the input contract for a later, separately approved live-ingestion plan. It defines what an authorized capture must contain so SABA Socket.IO and IM REST adapters can be designed without guessing. This task performs no site access, authentication, live capture, CAPTCHA work, betting, or secret collection.

The later capture phase is observation-only. It must not access trader-only or staff-only domains, bypass CAPTCHA or anti-bot controls, alter provider state, submit a wager, or probe undocumented endpoints. Authenticated sessions and all live adapters are deferred to that plan. PAPER, ASSISTED, AUTO, bet submission, preflight, receipts, and reconciliation are deferred to an execution plan.

## Mandatory capture envelope

Every message is one strict object. Unknown keys are rejected. Required envelope fields are:

| Field | Requirement |
| --- | --- |
| `captureSchemaVersion` | Integer version, initially `1`. |
| `captureId` | New random capture identifier containing no provider/user identity. |
| `provider` / `category` | Exactly `SABA` or `IM`; exactly `FOOTBALL` or `LOL`. |
| `transport` | `SABA_SOCKET_IO` or `IM_REST`. |
| `messageFamily` | One of the families listed below. |
| `direction` | `SERVER_TO_CLIENT`, `CLIENT_TO_SERVER`, or `REQUEST_RESPONSE_PAIR`. |
| `source` | Redacted stable source label, HTTP method and path template or Socket.IO namespace/event; never a full host, credential query, or raw header. |
| `captureStartedAtUtc` / `receivedAtUtc` | ISO-8601 UTC timestamps with millisecond precision. |
| `receivedMonotonicMs` | Nonnegative monotonic arrival time relative to capture start. |
| `sessionOrdinal` / `connectionOrdinal` | Positive local counters; no session identifier. |
| `providerSequence` | Exact provider sequence as string or number, or `null` when absent. |
| `arrivalSequence` | Positive local counter assigned before parsing; never represented as a provider sequence. |
| `sourceTimestampRaw` / `sourceTimestampMs` | Original provider value plus normalized Unix milliseconds, or both `null` when absent. |
| `fullSnapshotId` / `baseSequence` | Baseline identifier and referenced sequence for deltas; `null` only when the family cannot supply them. |
| `payload` | The redacted, family-specific body below. |

Preserve message order exactly. Do not sort, merge, deduplicate, repair gaps, or replace provider time with receipt time. Record duplicates, out-of-order messages, sequence gaps, resets, and reconnect boundaries as observed. If the provider has no sequence, `providerSequence` stays `null`; `arrivalSequence` provides ordering and must be labelled synthetic. Record timestamp units, timezone assumptions, clock domain, and any normalization rule in capture metadata.

## SABA Socket.IO families

For both categories, capture the Engine.IO frame type and Socket.IO namespace/event name in addition to the envelope.

### Common SABA payloads

- `BOOTSTRAP_METADATA`: protocol/app version, server time, sport/category IDs and names, competition/league IDs and names, market/type dictionaries, status dictionaries, and initial namespace/channel descriptors.
- `CONNECT`: Engine.IO open parameters (`pingInterval`, `pingTimeout`, allowed upgrades) with `sid` redacted; Socket.IO namespace connect/ack; local connection ordinal; negotiated transport; first provider sequence/time if supplied.
- `SUBSCRIBE`: namespace, event name, redacted/stable channel label, category and competition filters, subscription action, client arrival sequence, acknowledgement outcome/sequence/time. Never retain the raw session-bearing subscription token.
- `FULL_EVENT_SNAPSHOT`: provider event ID, competition/season/stage, start time, participant IDs/names and provider side order, live flag/state, event scope, full market array, market IDs/types/scopes/lines/settlement/status, and selection IDs/names/status/raw odds/format.
- `ODDS_PATCH`: event, market and selection IDs; changed fields; raw odds and format; line; market/selection status; live state; provider sequence; source time; referenced full snapshot/base sequence.
- `MARKET_SUSPEND`: event/market/selection IDs as applicable, prior and new status, provider reason code, sequence, source time, and baseline reference.
- `HEARTBEAT`: Engine.IO ping/pong or application heartbeat type, direction, provider sequence/time if present, arrival sequence/time, and referenced connection ordinal. Payload data that is only a session value is replaced by `REDACTED`.
- `RECONNECT`: observed close code and non-sensitive reason, last sequence before close, first sequence after reconnect, gap/reset indicator, previous/new connection ordinal, namespace reconnect, resubscribe acknowledgement, and whether a new full snapshot replaced the baseline.

### SABA Football additions

The full snapshot and every affected patch must carry Football sport variant, home/away orientation, regulation/event scope, competition/stage, kickoff, match clock/period/score when live, and supported market identity (`FT_1X2`, `FT_AH`, `FT_TOTAL`, `FH_1X2`, `FH_AH`, `FH_TOTAL`) with exact line and settlement semantics.

### SABA LoL additions

The same families must additionally carry game variant, tournament/stage, series ID, best-of, provider team-side orientation, series score, current map index, map number/scope (`MAP_1` through `MAP_5`), map score, game clock, pause/live state, and market identity (`SERIES_WINNER`, `MAP_WINNER`, `MAP_TOTAL_KILLS`, `MAP_KILL_HANDICAP`, `MAP_DURATION`). A map patch must identify both the series and map; an unscoped map market is invalid.

## IM REST families

Capture request and response as one pair. Retain only HTTP method, path template, non-secret paging/filter values, status code, timing, response revision/ETag if non-secret, and the redacted body. Never retain raw request/response headers, cookies, authorization values, or full URLs.

### IM Football

- `FULL_LIVE_EVENT_LIST`: category/sport ID, list revision, server time, event ID, competition/season/stage, kickoff, home/away IDs/names and order, event scope, live state/period/clock/score, complete market and selection arrays, raw odds/format/status, and page index/size/has-more boundary.
- `EVENT_SELECTION_DELTA`: list revision, base revision/sequence, upsert/remove operation, event/market/selection IDs, every changed field, raw odds/format/status, line, source time, and poll ordinal.
- `MARKET_SUSPEND`: event/market/selection IDs, prior/new status, reason code, revision/sequence, source time, and poll ordinal.
- `PAGINATION_LAZY_LOAD_BOUNDARY`: request page/index/size or redacted cursor-present flag, response item count, has-more flag, first/last event IDs, duplicate/overlap IDs, list revision, and whether scrolling or expansion triggered the request. Cursor values themselves are secret-like opaque state and must be `REDACTED`.
- `SESSION_REFRESH`: trigger (`EXPIRY`, `HTTP_401`, `HTTP_403`, or scheduled), request start/end time, HTTP outcome, previous/new local session ordinal, retry relationship, and whether a full-list reset followed. No refresh payload, header, cookie, token, account, or member value is permitted.

### IM LoL

- `INDEX_MATCH_LIST`: game variant, tournament/stage, series/match ID, team IDs/names and provider side order, best-of, scheduled/live state, series score, current map index, list revision/server time, and pagination boundary.
- `MATCH_DETAILS`: series/match ID, best-of, team orientation, series/map scores, current map index, map scopes, live/pause state, complete market/selection arrays, raw odds/format/status, exact lines/settlement fields, detail revision and source time.
- `REPEAT_POLL`: request start/end, poll ordinal, prior/current revision, not-modified indicator, changed event/market/selection IDs, source time, response status, and next-poll hint. Preserve unchanged responses; do not infer a delta from silence.
- `MARKET_SUSPEND`: series/match, map, market and selection IDs as applicable; prior/new status; reason; revision/sequence; source time; poll ordinal.
- `SESSION_REFRESH`: the same metadata-only contract as IM Football, including the new local session ordinal and post-refresh full-details reset indicator.

## Redaction and admission pipeline

Raw protocol data must never be written to the repository or to a temporary capture file. The capture process handles one message in memory and applies this exact order:

1. Pass the complete message through `redactCapture` from `@tool-chenh/adapters`.
2. Strict-parse the redacted result with the family-specific Zod schema (`z.strictObject` at every object boundary). Quarantine schema failures; do not coerce or silently drop unknown critical fields.
3. Serialize the parsed result and run the no-secret scan. The scan must be case-insensitive and reject unredacted secret-key assignments (`authorization`, `auth`, `cookie`, `set-cookie`, any `*token`, `password`/`passwd`, `secret`/`clientSecret`, API key, account/account ID, member/member code, session/session ID, and `sid`), `Bearer` or `Basic` authorization material, JWT-shaped strings, and cookie-shaped session values. The literal `REDACTED` is allowed only as a replacement value.
4. Only after all three gates pass may the file be written under `fixtures/captured/<provider>/<category>/`. Record the schema version and a SHA-256 checksum in a sidecar manifest.

`redactCapture` recursively replaces the listed secret keys (including punctuation/case variants and suffix forms), redacts matching URL query parameters, and replaces circular references. The no-secret scan is a separate mandatory defense; passing either gate alone is insufficient.

Forbidden content includes usernames, account IDs, member codes, email/phone identifiers, passwords, OTP/MFA values, recovery codes, cookies, `Set-Cookie`, session IDs, Socket.IO/Engine.IO `sid`, access/refresh/ID tokens, JWTs, authorization headers, API/client secrets, browser storage, device fingerprints, proxy credentials, full authenticated URLs, raw request/response headers, payment data, balances tied to an account, and bet slips/receipts. If safe redaction would remove identity needed for mapping, replace it with a stable capture-local pseudonym and document the mapping semantics; never store the original.

Any failure means quarantine outside `fixtures/captured`, emit only a secret-free diagnostic, and stop that capture family until reviewed. No captured fixture is evidence that live ingestion or execution is approved.
