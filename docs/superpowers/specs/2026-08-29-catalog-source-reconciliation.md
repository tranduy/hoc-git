# Catalog Source Reconciliation Design

## Goal

The live catalog must represent the bookmaker's current state. Removed events and markets must disappear, changed lines must replace their old market identity, and changed odds must publish a new catalog revision so comparison and ranking run again.

## Source authority

- A complete provider baseline replaces the prior provider catalog.
- A delta may remove identities only when its adapter supplies explicit authoritative removal evidence.
- A partial viewport or transport-only message cannot remove unseen identities.
- A SABA DOM fallback delta replaces the currently observed market families for visible events, while preserving socket-only events and unrelated hidden market families.

## Direct observation feedback

Automatic exact-selection checks are a second authoritative observation path:

- An exact selection found at a different price updates that quote immediately.
- A selection that is not found, ambiguous, closed, or times out is removed fail-closed from the visible catalog.
- A correction uses compare-and-swap against the displayed catalog timestamp and quote identity, so a late check cannot overwrite a newer source snapshot.
- Any applied correction requests a targeted provider baseline. The refreshed baseline supplies replacement identities such as a changed handicap line and converges adapter state with the corrected catalog.

## Publication

Every accepted source delta or direct correction replaces the feed controller's current catalog, publishes through `CatalogRevisionStore`, and therefore causes the web comparison worker to recompute tickets and ROI. No UI-only tombstone is the source of truth.

## Safety

- Large or partial baselines remain protected by the existing coverage-collapse guard.
- Unproven ordinary deltas still cannot delete events.
- Direct corrections never add guessed line or selection identities; new identities enter only through a fresh provider snapshot.
- Source-unavailable and generic server errors do not mutate the catalog. Exact misses, market closure, ambiguity, and probe timeout fail closed.
