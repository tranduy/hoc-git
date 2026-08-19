# Realtime Catalog Revisions and Worker Comparison Design

## Goal

Keep the football comparison page realtime while removing the 250 ms loop that
downloads every selected provider catalog and repeats comparison work on the UI
thread.

The selected architecture is:

1. the existing WebSocket reports small per-account catalog revisions;
2. the browser fetches only accounts whose revision changed; and
3. a dedicated Web Worker owns catalog comparison work.

This phase must not change event matching, market eligibility, ranking, alert,
or bet-preflight semantics.

## Current problem

`LiveCatalogPage` currently calls every selected catalog endpoint every 250 ms.
ETag responses avoid parsing a body when a catalog is unchanged, but each poll
still crosses React, the API, the catalog route, and its read/coalescing state.
When one catalog does change, the page computes catalog revisions and invokes
`buildComparisonEvents` more than once on the main thread.

The current six-football-source response set is roughly 3.1 MB, with IM alone
around 1.9 MB. This makes the polling loop wasteful even though the upstream
Chrome sources themselves have different update cadences. It also makes the UI
compete with rendering, price tracking, and ticket preflight for the main
thread.

The API already has `/api/realtime`, strict `RealtimeMessageSchema` validation,
bounded WebSocket sends, reconnect backoff, and catalog ETags. The design
extends those facilities instead of adding a second socket or a parallel
realtime stack.

## Chosen design

### One authoritative catalog revision store

Add an in-memory `CatalogRevisionStore` owned by the API process. Each accepted
catalog is published with its requested account ID. The store retains:

- the latest accepted catalog for that account;
- an opaque revision string;
- the catalog observation time;
- its `FRESH` or `STALE` publication state and freshness deadline; and
- a monotonically increasing store sequence used only to order broadcasts.

The opaque revision is derived from the provider, category, observation time,
publication state, and a bounded content fingerprint. It is not a credential
and has no meaning to the browser other than equality. The store ignores an
identical publication and must never replace a newer observation with an older
one.

There are two publication paths:

- `ChromeCatalogDataPlane` publishes immediately after adapter, completeness,
  and coverage validation accepts a Chrome snapshot.
- The existing catalog route publishes a successful reader result, including a
  non-Chrome reader result, before making it available to callers.

The catalog GET route consults the same revision store before its legacy
coalesced read cache and emits the store revision in both `ETag` and
`x-catalog-revision`. Consequently, a revision broadcast and its corresponding
GET response refer to the same accepted snapshot. This prevents the race where
the client receives a new revision but a one-second route cache returns the old
catalog.

The existing durable catalog cache remains a restart fallback. A restored
snapshot is published as stale; it cannot produce executable signals until a
fresh provider observation replaces it.

Each fresh entry has a bounded freshness deadline matching the owning reader or
Chrome data plane. If no accepted observation extends that deadline, the store
changes the entry to `STALE`, assigns a new revision, and broadcasts that state
transition. Realtime delivery therefore does not accidentally keep a dead
source fresh merely because the 250 ms HTTP poll was removed.

### WebSocket contract

Extend the existing strict realtime discriminated union with two messages:

```ts
type CatalogRevisionEntry = {
  accountId: string;
  revision: string;
  observedAtMs: number;
  snapshotState: "FRESH" | "STALE";
};

type CatalogRevisionBaselineMessage = {
  type: "CATALOG_REVISION_BASELINE";
  sequence: number;
  entries: CatalogRevisionEntry[];
};

type CatalogRevisionMessage = {
  type: "CATALOG_REVISION";
  sequence: number;
  accountId: string;
  revision: string;
  observedAtMs: number;
  snapshotState: "FRESH" | "STALE";
};
```

The server sends one baseline after a client connects, alongside the existing
application snapshot baseline. Later accepted publications produce one
`CATALOG_REVISION` message. Per-client sequence tracking prevents duplicate or
out-of-order broadcasts.

The baseline closes the initial-load and reconnect gap: the client can compare
the complete server revision map with the revisions it currently holds instead
of assuming it saw every message while disconnected.

Revision messages contain no launch URL, token, cookie, provider payload, odds,
or other secret. Existing origin checks, message schema validation, send buffer
limits, heartbeat, and slow-client disconnect behavior remain authoritative.

### Single frontend realtime client

Refactor `SnapshotClient` into a shared realtime client rather than opening a
second WebSocket. It continues to deliver legacy application snapshots and also
exposes catalog baseline, catalog revision, and connection-state callbacks.

`App` owns this client for its full lifetime and passes a catalog revision feed
to `LiveCatalogPage`. An initial application snapshot may skip the initial
`/api/snapshot` request, but it must not disable the WebSocket.

The catalog coordinator maintains these values per account:

- server revision requested;
- revision currently held by `CatalogApi`;
- fetch in flight; and
- whether another revision arrived during that fetch.

On a revision for a selected account, the coordinator coalesces bursts for at
most 50 ms and fetches only that account. Revisions for unselected accounts are
remembered but not fetched until the account becomes selected.

If another revision arrives while the account is in flight, the coordinator
compares the returned `x-catalog-revision` with the latest requested revision.
It immediately performs one more read when they differ. An older response may
never roll back a newer accepted catalog.

On a baseline or reconnect, the coordinator reads only selected accounts whose
server revision differs from the local revision. It performs a full selected
source reconciliation only when local revision information is absent or the
sequence gap cannot be reconciled.

### Polling fallback

The 250 ms all-source polling loop is removed.

While the WebSocket is `LIVE`, unchanged catalogs cause zero catalog GETs.
While it is `CONNECTING` or `DISCONNECTED`, a one-second ETag-based fallback
poll keeps selected sources updating. The fallback stops as soon as a valid
revision baseline is accepted. The existing two-second source/account status
discovery may remain because it is small control-plane data rather than a full
catalog transfer.

The upstream collection cadence is not slowed in this phase. A provider update
can therefore reach the page as soon as the adapter accepts it. CMD remains
bounded by its approximately two-second DOM snapshot cadence; websocket-fed
providers remain bounded by their provider feed and adapter cadence.

### Web Worker comparison model

Add one module worker for the live catalog page. It owns a map of the latest
catalog by account and accepts generation-tagged commands:

```ts
type ComparisonWorkerCommand =
  | { type: "RESET"; generation: number; catalogs: LiveCatalogResponse[];
      staleAccountIds: string[] }
  | { type: "UPSERT"; generation: number; catalog: LiveCatalogResponse;
      stale: boolean }
  | { type: "SET_STALE"; generation: number; accountId: string;
      stale: boolean }
  | { type: "REMOVE"; generation: number; accountId: string };
```

The worker runs the existing pure comparison functions. It produces both:

- display comparisons, which retain the current last-verified/stale display
  behavior; and
- fresh comparisons, which exclude stale accounts and remain the only input to
  alerts, movement tracking, and ticket preflight.

Worker results carry the generation that produced them. The main thread ignores
results older than its most recently requested generation, so a slow large
catalog cannot overwrite a newer small update.

The worker result is a compact `ComparisonProjection`: it contains the derived
event, provider IDs, provider event IDs, observed rows, eligible rows, and best
margin, but not the original full `catalogs` arrays. The main thread reattaches
catalog references from its existing account map only where the UI or match
detail needs them. This avoids cloning the multi-megabyte raw catalogs back out
of the worker on every update.

The initial worker reset clones all selected catalogs once. Later updates clone
only the changed account catalog. The main thread no longer invokes
`buildComparisonEvents` in both the load callback and render memo.

If the worker crashes, the coordinator keeps the last verified display,
recreates the worker once, and sends a full reset from the latest local catalog
map. Until the reset result arrives, no new signal or executable preflight is
published. Repeated worker failure is surfaced as a diagnostic and the
one-second network fallback does not conceal it.

## Data flow

```text
Provider/Chrome adapter
        |
        v
validation + coverage guard
        |
        v
CatalogRevisionStore -----> /api/realtime revision message
        |                              |
        v                              v
catalog GET <----- changed account ---- browser coordinator
                                               |
                                               v
                                      comparison Web Worker
                                               |
                                               v
                              render + signals + movements + preflight
```

## Correctness rules

- A catalog is broadcast only after existing schema, completeness, and coverage
  checks accept it.
- A missed freshness deadline produces a state-only stale revision, so a source
  cannot remain executable after its accepted data expires.
- A revision and the catalog returned for that revision come from the same
  authoritative revision store.
- A client fetches only a selected changed account during a normal connected
  update.
- An older HTTP response or worker generation cannot replace newer state.
- Stale/restored catalogs remain display-only and cannot generate alerts or
  executable tickets.
- Reconnect and in-flight update races converge to the latest server baseline
  without losing the final revision.
- Existing comparison ordering and fail-closed market rules do not change.
- Source reset/recovery can republish a newer revision without requiring the UI
  to reload the page.

## Testing and acceptance

### API and contracts

- Contract tests accept both new strict message types and reject extra fields,
  malformed revisions, invalid account IDs, and invalid timestamps.
- Revision store tests cover deduplication, old-update rejection, per-account
  ordering, baseline snapshots, and subscribe/unsubscribe cleanup.
- WebSocket tests prove baseline-on-connect, changed-account-only broadcasts,
  reconnect baselines, bounded send behavior, and shutdown cleanup.
- Catalog route tests prove that a broadcast revision and GET response expose
  the same snapshot and ETag, including a Chrome update arriving inside the old
  coalescing window.

### Frontend coordinator

- A single revision causes one GET for that account and no GET for unchanged
  selected accounts.
- A burst is coalesced and converges to its latest revision.
- A revision arriving during a fetch schedules the required follow-up fetch.
- A reconnect baseline repairs a missed update.
- Connected idle time performs no catalog GETs; disconnected time uses the
  one-second ETag fallback and stops it after baseline recovery.

### Worker and behavior parity

- The worker output matches existing `buildComparisonEvents` fixtures for
  matching, row eligibility, margins, and ordering.
- Stale/display and fresh/executable projections preserve current behavior.
- Stale generations are ignored, and worker restart requires a full reset
  before new executable results appear.
- The live page no longer calls `buildComparisonEvents` on the main thread.

### Performance acceptance

- With a connected socket and unchanged catalogs, catalog GET rate is zero.
- One changed provider produces a request and worker update for only that
  provider.
- For a catalog already accepted by the API, local revision-to-render latency is
  targeted at 50-250 ms under normal load.
- CMD capture-to-render latency is not expected to be below its upstream DOM
  capture interval, but downstream handling uses the same 50-250 ms target.
- Comparison work no longer creates long main-thread tasks during a normal
  catalog update.
- Before/after measurements record catalog request rate, API CPU, web renderer
  CPU, and memory with the same six sources and observation window.

## Rollout

Implement behind a frontend feature flag for one verification cycle. During
that cycle, log only aggregate counters and timings: revision count, changed
account fetch count, reconnect reconciliation count, worker duration, and stale
generation count. Never log catalog bodies or provider credentials.

If the revision path is disabled, the safe fallback is the one-second ETag poll,
not the old 250 ms loop. After parity and performance checks pass, remove the
flag and the old polling code.

## Out of scope

- Changing provider capture or hidden/detail-market collection behavior.
- Reducing the number of provider Chrome tabs or Chrome renderer processes.
- List virtualization or changing which matches can enter the ranked list.
- Changing comparison, ROI, alert, movement, or bet execution semantics.
- Sending full catalogs through WebSocket.

This work should materially reduce API request load and web main-thread work,
but it does not by itself remove the six provider tabs. Chrome process count and
the memory owned by provider pages require a separate tab/capture lifecycle
optimization.
