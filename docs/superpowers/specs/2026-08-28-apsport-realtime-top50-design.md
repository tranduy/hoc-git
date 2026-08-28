# APSPORT Realtime and Global Top-50 Ticket Design

Date: 2026-08-28

## Goal

Make APSPORT contribute complete, current, read-only football prices without
using its virtualized DOM as catalog authority, while keeping the production
catalog small enough for frequent realtime updates. Show at most the 50
highest-ROI exact opposing tickets across every selected bookmaker pair.

## Scope

- APSPORT account: `catalog-source:APSPORT:FOOTBALL`
- APSPORT Chrome lobby: `TSPORT`
- Include every active live football event.
- Include prematch football events whose kickoff is in the closed interval
  `[now, now + prematchWindowHours]`.
- Configure `prematchWindowHours` with
  `APSPORT_PREMATCH_WINDOW_HOURS`; default `24`, accepted range `1..48`.
- Keep only supported two-outcome football products: full-time, first-half and
  second-half Asian handicap/total, plus supported corner and card
  handicap/total markets.
- Keep execution and bet placement out of scope. Collection and preflight
  remain read-only.

The large `.run/apsport-all-football.json` artifact is diagnostic evidence,
not a production payload. It walked up to fifteen future days and used
pretty-printed JSON. Production must never reproduce that unbounded sweep.

## Verified Provider Protocol

The authenticated provider document exposes:

1. `/be-ui/pac/api/v3/events` for top leagues.
2. `/be-ui/pac/api/v3/other-leagues` for lazy league metadata.
3. `/be-ui/pac/api/v3/leagues/tops` for lazy league events. Its `in` cursor is
   provider field `"17"`, not field `"7"`.
4. `/be-ui/pac/api/v3/events/{eventId}` for the complete event, including
   markets hidden behind client-side category and accordion controls.
5. WebSocket `eu` frames on `spws.(agenate|racern).com`. A valid football
   outer frame has `s === 1`, `t === "eu"`, and a stringified event in `d`.

The DOM renders only a virtualized subset and therefore cannot define the
expected event set, prove completeness, or prune API/WebSocket records.

## Architecture

### Authenticated API baseline

The Chrome extension runs a bounded, read-only APSPORT catalog refresh in the
already authenticated provider document. It reuses an observed native request
template in memory and does not persist or forward its credential-bearing
headers, request URL query, or token.

The refresh first obtains the live and scheduled league/event rosters. It
filters event IDs before detail collection:

- keep an event when the provider marks it live; or
- keep an event when its parsed kickoff is between `now` and
  `now + prematchWindowHours`;
- reject missing/invalid kickoff for non-live events;
- reject virtual or non-football identities.

Only retained event IDs enter the rate-limited `/events/{eventId}` detail
queue. The queue is single-flight, retries HTTP 429 with provider `Retry-After`
or bounded backoff, and can be replaced by a newer refresh generation. Events
outside the window never receive a detail request.

The first complete roster response may establish a fast baseline with the
supported markets already present in list data. Detail records replace their
same-event list records and are emitted in bounded batches. Completing the
eligible detail queue establishes a new authoritative baseline. A failed or
superseded detail does not erase the previous verified record and cannot turn
the source into an authoritative empty catalog.

The API server resolves `APSPORT_PREMATCH_WINDOW_HOURS` once and includes the
validated value in APSPORT snapshot-control requests. The extension and API
adapter apply the same cutoff so configuration changes cannot create fetched
but publishable out-of-window records or omit newly eligible records.

### Realtime merge

APSPORT opens several simultaneous football sockets, including general
`mg/0`, `mg/1`, and event-detail `/e/{eventId}` streams. Socket state is keyed
by source epoch and stream ID; opening one stream must not retire another.

All accepted frames merge into source-level state by:

`eventId -> providerMarketId -> providerSelectionId`

For one identity, the higher bridge sequence wins. A full `eu` event replaces
the prior representation of that event, so provider removals and suspensions
inside that event are respected without deleting unrelated events.

The adapter applies the live/24-hour cutoff before retaining or publishing a
record. It immediately drops unsupported group IDs and does not keep the raw
provider event after normalization. A stable semantic fingerprint over event,
market, selection, line, price and status suppresses repeated identical `eu`
frames. Changed realtime frames are coalesced for at most 250 milliseconds;
detail enrichment is emitted at most once per five seconds or when its
generation completes, whichever happens first, so the web app does not reload
one full catalog for every detail request.

Closing one socket removes only that stream. APSPORT is invalidated only when
no eligible football socket remains and its latest API authority has also
exceeded the source freshness policy. Retained replay recognizes general and
event-detail football paths, not only the legacy `mg/0` path.

## Market and Event Identity

Provider event, market and selection IDs remain unchanged. Main football,
corner and card products stay separate through their existing taxonomy and
settlement profile. `isLive` on every quote must equal `isLive` on its event.
Hidden client-side UI categories do not imply locked odds; provider status
fields decide whether a market or selection is open.

## Global Top 50

Keep the existing comparison, bookmaker-pair selection, ticket identity,
detail and preflight behavior unchanged. This requirement controls only the
number of cards rendered in the left `Exact two-book matches` list.

Flatten the cards already produced for all visible events, then sort globally
by:

1. ROI descending;
2. worst-case profit descending;
3. immediate movement magnitude descending;
4. kickoff, event identity and ticket identity for deterministic ties.

Deduplicate only the same existing card identity. Apply `slice(0, 50)` once,
after the global sort. The current page must not pass the total ticket count as
the limit because doing so renders the entire list. Do not enumerate additional
bookmaker combinations or change match pairing as part of this limit.

## Failure and Security Behavior

- Malformed API payloads, invalid timestamps, non-football records, unknown
  market groups and invalid odds fail closed.
- A partial refresh is enrichment, not authoritative deletion.
- Replacing the cutoff removes newly out-of-window prematch events only at the
  next complete authoritative baseline.
- No credential, launch URL, header value, provider body or WebSocket payload
  is written to diagnostics. Diagnostics contain counts, endpoint classes,
  status codes, latency and rejection reasons only.
- No collector interaction clicks odds, opens a bet slip or submits a wager.

## Verification

Automated tests must prove:

- every live event survives regardless of kickoff;
- prematch at the 24-hour boundary survives and prematch beyond it is rejected;
- an invalid environment value fails startup rather than silently widening the
  collection window;
- only eligible event IDs enter the detail queue;
- detail data adds hidden supported markets without DOM interaction;
- simultaneous `mg/0`, `mg/1` and detail sockets update one source without
  retiring one another;
- one socket close does not invalidate a source with other live streams;
- an identical repeated `eu` event produces no catalog revision;
- main, corner and card identities remain separate;
- with 51 existing cards, exactly the 50 highest-ROI cards render and the
  lowest-ROI card is excluded after the global sort;
- the existing card, match-pairing, detail and preflight identities do not
  change.

Run targeted API, extension and web tests first, followed by workspace
typecheck, build and the relevant integration suite. Live verification measures
eligible APSPORT events, supported markets, semantic revision rate and
cross-book ticket count without exposing provider data.
