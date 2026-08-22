# Provider-Coherent Realtime Odds Design

## Goal

Make football odds reach comparison with the lowest practical latency while
never presenting retained or replayed provider data as newly observed. Keep the
existing revision WebSocket, changed-account HTTP read, ETag cache, and Web
Worker comparison pipeline.

Correctness has priority over coverage: a market without a valid current source
generation or an authoritative observation is display-only or absent from
comparison. The system must not call a source or quote realtime merely because
some other partition in the same catalog was updated.

## Confirmed root causes

- The API-to-browser pipeline is event-driven, but provider adapters currently
  conflate content change, source liveness, and observation time.
- CMD retains viewport records for 180 seconds and normalizes the entire cache
  with the newest snapshot clock.
- IM merges baselines additively, loses the `Market` request partition, and
  normalizes all retained records with the newest response clock.
- SABA correctly decodes atomic `reset ... done` snapshots and ordered deltas,
  but socket partitions are not scoped to a connection generation.
- SBOBET retains event/market data for two hours without proven reset/delete
  lifecycle and normalizes the retained union with the newest frame clock.
- APSPORT lets partial DOM data and WS event data overwrite one another and
  normalizes two-hour retained state with the newest frame clock.
- BTI mixes current list snapshots with event-detail snapshots retained for 60
  seconds; any current list response makes the aggregate catalog look fresh.
- Catalog revisions hash observation clocks and quote transport sequence data,
  so unchanged data creates a changed revision, an HTTP read, and Worker work.
- Replayed extension snapshots use replay time instead of original receipt time.

## Chosen architecture

### Transport identity and lifecycle

Every new extension envelope carries a credential-free `sourceEpoch`. HTTP
responses may additionally carry a bounded provider partition identifier; WS
frames and WS lifecycle messages carry a local stream identifier. These fields
contain no URL query, header, cookie, token, or provider payload.

The extension emits `WS_STATE` open/close lifecycle messages. A source epoch
changes after a tab/document generation changes. A local socket identifier
changes each time CDP observes a new WebSocket. Replayed data retains its
original observation clocks and is rejected by the existing maximum-envelope
age gate when no longer current.

The data plane resets adapter and coverage state on a source epoch change. A
disconnect, gap, schema error after an accepted generation, or explicit adapter
invalidation marks the affected account stale immediately. A fresh catalog is
published again only after the provider-specific readiness rule succeeds.

### Provider-specific materialized state

- **CMD:** a DOM snapshot is a partial observation. Cache entries preserve
  their own clocks. Records are eligible only inside a bounded observation
  window; a completed sweep replaces the sweep set. Hidden expansion remains
  serialized and read-only. A partial viewport may discover a record but cannot
  renew unrelated records.
- **IM:** `GetSE` responses replace their exact `Market` partition. Deltas patch
  materialized state and explicit deletes remove records. An unknown-event
  delta requests a baseline rather than silently becoming current. Publication
  requires a current baseline generation.
- **SABA:** state is scoped to source epoch, socket stream, and `bridgeId`. A
  stream partition becomes eligible only after an atomic `reset ... done`
  baseline. Ordered deltas update it afterward. Gap or socket close invalidates
  that stream without allowing DOM heartbeats to renew hidden WS data.
- **SBOBET:** state is scoped to socket stream and STOMP destination. Individual
  events retain their own clocks. Until authoritative reset/delete semantics
  are proven from sanitized live traffic, old untouched events expire from
  executable comparison instead of remaining current for two hours.
- **APSPORT:** WS event state and DOM discovery state stay separate. A current
  WS event wins over DOM for the same identity; DOM never erases richer WS
  markets. Each event retains its own clock. Socket close invalidates WS state.
- **BTI:** list and detail partitions retain independent clocks. Hidden detail
  markets are executable only inside the configured detail SLA. The extension
  first observes and classifies any native BTI push traffic. Without a proven
  push or batch endpoint, a bounded hot-set scheduler refreshes selected,
  watched, opportunity, and next-cold events; cold expired details do not enter
  comparison. Exact event-detail refresh is required before BTI execution can
  be enabled.

### Freshness and semantic revisions

Push sources use generation health, completed baseline, and ordered deltas as
freshness evidence. An unchanged price on a healthy continuous push stream does
not expire merely because it did not change.

Partial DOM and per-event HTTP sources use observation windows because absence
from a partial read is not proof of continued validity. They never borrow the
aggregate catalog timestamp from another event or partition.

Catalog publication keeps two concepts separate:

1. a semantic revision derived from provider, event, market, selection, line,
   price, and status content; and
2. a freshness deadline renewed by an accepted authoritative observation.

An unchanged authoritative observation renews the deadline and replaces the
internal observation metadata, but does not increment the broadcast sequence or
notify the browser. A stale/fresh state transition always creates a revision.

### Downstream data flow

```text
provider WS / HTTP / DOM
        -> CDP observer with source/stream identity
        -> provider state machine and readiness gate
        -> coherent current catalog
        -> semantic revision only when content/state changes
        -> existing revision WebSocket
        -> GET only the changed selected account with ETag
        -> existing comparison Web Worker
```

No full catalog is sent over WebSocket. No full page reload occurs during
healthy steady state. Reload/resubscribe is recovery-only after a gap, schema
failure, or missing baseline.

## Performance constraints

- Connected push feeds add zero provider polling in steady state.
- Connected unchanged catalogs cause zero catalog GETs and zero Worker updates.
- One changed provider causes at most one coalesced changed-account read, plus a
  single follow-up when a newer revision arrives during that read.
- CMD capture remains single-flight at the existing two-second cadence.
- IM baseline reconciliation is single-flight and bounded; native deltas remain
  the low-latency path.
- BTI request concurrency is bounded and measured. The system must not claim
  all-hidden two-second freshness unless live evidence proves a push/batch feed
  or the measured request budget can cover every event inside that SLA.

## Failure behavior

- New epoch, closed socket, sequence gap, incomplete baseline, stale detail,
  unknown schema, or ambiguous market status fails closed for comparison.
- Last-known data may remain available for diagnostics but cannot generate ROI,
  alerts, or execution preflight.
- Coverage protection is update-kind aware: an authoritative full replacement
  may remove absent events immediately; a partial view cannot erase unseen
  events or renew them.
- Recovery is bounded and source-specific. Repeated reload loops are prohibited.

## Acceptance criteria

- Provider WS receipt to API semantic revision: p95 at or below 500 ms under
  normal local load.
- API revision to rendered selected-source update: p95 at or below 500 ms.
- CMD visible odds capture to rendered update: p95 at or below 3 seconds.
- A source epoch or stream generation that has closed cannot contribute a quote
  to fresh comparison.
- A retained CMD, SBOBET, APSPORT, or BTI record keeps its own observation clock;
  updating another event cannot make it appear newly received.
- IM baseline absence removes data from that partition, and delta gaps cannot
  mutate accepted state.
- An unchanged semantic catalog renews freshness without a revision broadcast.
- Stale or unproven prices participating in executable comparison: zero in the
  deterministic adapter/data-plane tests.
- Full typecheck, unit tests, integration tests, build, and a six-source local
  smoke measurement pass before completion is claimed.

## Rollout

Changes are delivered as focused commits: semantic publication, transport
lifecycle, provider state machines, pull-source scheduling, then live
measurement. The current UI revision/ETag/Worker pipeline remains the rollback
boundary. Temporary screenshots and existing user files are not committed.
