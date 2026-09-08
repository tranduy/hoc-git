# Complete Binary Prematch Market Coverage Design

## Goal

Collect every football prematch market exposed by each of the six configured providers, preserve the native evidence needed to classify it, and compare every market that is proven to have exactly two mutually exhaustive opposing outcomes with no draw or push/refund result.

The system must never trade coverage for guessed equivalence. Unknown markets are retained as unmapped evidence and reported; they are not silently discarded and cannot enter ROI ranking until their identity is proven.

## Verified current gap

The 2026-09-06 local catalogs contradict the older completion report. SABA, IM, and BTI expose no corner/card markets in the normalized catalog. APSPORT exposes corner markets but no prematch card markets. SBOBET and CMD expose only partial corner/card coverage. Existing contracts and normalizers recognize some corner/card identities, but the provider collection paths do not hydrate the complete prematch detail catalog.

## Safety and completeness invariants

A cross-book pair is eligible only when both legs have the same:

1. Canonical fixture identity and participant orientation.
2. Statistic family: goals, corners, cards, or another explicitly mapped statistic.
3. Regulation segment: full time, first half, second half, or another explicit segment.
4. Market family and outcome domain: handicap `HOME/AWAY`, total `OVER/UNDER`, or another explicit two-outcome domain.
5. Canonical line and line orientation.
6. Settlement profile and ordinary settlement behavior.
7. Open status and current provider generation.

For the requested no-refund behavior, Asian handicap and total markets are comparison-eligible only on half-unit lines (`n + 0.5`, including signed handicap lines). Integer lines can push and quarter lines can partially push, so both remain collected but are comparison-ineligible. Three-way, draw-no-bet, exact-score, double-chance, non-exhaustive props, ambiguous labels, and incomplete outcome domains never enter comparison.

## Canonical market registry

The market registry is the single source of truth for statistic, period, outcome domain, line policy, and settlement profile. The first supported families are:

- Goals: full-time, first-half, and second-half handicap/total.
- Corners: full-time and first-half handicap/total; further periods only after provider settlement evidence is proven.
- Cards/bookings: full-time and first-half handicap/total; further periods only after provider settlement evidence is proven.
- Line-free binary markets such as odd/even or both-teams-to-score only after at least two providers expose exact native identifiers and identical settlement rules.

Native markets outside the registry are stored as unmapped observations with provider market ID, label/code, period evidence, outcome labels, event ID, and observation time. A coverage report must show their count and most frequent signatures so missing mappings cannot be mistaken for complete coverage.

## Collection architecture

The existing main feed remains the low-latency price source and refreshes on the current three-second cadence. A separate prematch detail hydrator discovers every event and retrieves its complete market list.

- Detail work is prematch-only.
- Near-start events are refreshed more frequently; distant events use a longer TTL.
- Each provider has a bounded single-flight queue, provider-specific minimum delay, `429`/timeout backoff, generation cancellation, and retained-event cap.
- A detail response replaces that event's detail partition authoritatively, removing closed or changed markets instead of appending stale rows.
- Main-feed price deltas update matching detail identities without deleting detail-only markets.
- A source can report online only when the latest authoritative catalog generation contains usable current data, not merely because its tab is open.

Provider adapters must use structural native identifiers first. Localized labels are supporting evidence only and cannot establish equivalence by themselves.

## Provider rollout

1. APSPORT: audit every detail group ID, retain unknown groups, and prove prematch card/corner hydration.
2. SABA: enumerate prematch pseudo-events and detail bet types, map base fixture identity, and retain unsupported derivative signatures.
3. BTI: enumerate all detail market codes and localized labels, including corner/card families, without limiting traversal to the six main codes.
4. SBOBET: merge the complete direct/detail catalog with socket prices; remove the socket path's blanket corner/booking exclusion from authoritative coverage.
5. CMD: sweep all prematch rows and hidden controls, preserving pseudo-event corner/card identity and authoritative deletion.
6. IM: inspect all GetSE market groups and any separate category/detail endpoints; retain unknown `bti/gp` signatures and map only proven binary families.

## Data flow and matching

Raw provider response -> complete native market observation -> provider evidence mapper -> canonical market registry -> authoritative event partition -> exact cross-book matcher -> ROI ranking/UI.

The exact matcher is fail-closed. Unmapped observations remain visible in diagnostics but cannot affect tickets, notifications, or profit calculations. A market whose line or native type changes is a new identity; the old identity is removed by the next authoritative event detail generation.

## UI and observability

Each provider card displays separate event and market counts. Coverage diagnostics display normalized counts by family/period plus unmapped native signature counts. Ticket labels remain English and include statistic, period, family, and line so card totals cannot be confused with goal totals.

## Verification

- Fixture tests for every accepted and rejected provider shape.
- Contract tests for the canonical registry and no-push line policy.
- Cross-book tests proving correct pairs and rejecting near misses in fixture, statistic, period, family, line, orientation, settlement, or generation.
- Authoritative deletion tests when a market disappears or changes.
- Collector tests for pagination, detail completeness, single-flight limits, backoff, cancellation, and distant-event TTL.
- Live coverage audit for all six providers. Completion requires zero silently dropped native markets: every observed market is normalized, explicitly excluded with a reason, or retained as an unmapped signature.
