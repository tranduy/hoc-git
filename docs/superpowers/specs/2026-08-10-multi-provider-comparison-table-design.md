# Multi-provider comparison table design

## Outcome

Replace the single-provider Live Catalog presentation with a real multi-provider comparison surface for Football and LoL. Operators select connected providers, see equivalent markets side by side, and can immediately identify the best executable prices and verified positive-margin combinations.

## Provider selection

- Show checkboxes for `SABA`, `SBOBET`, `CMD`, `APSPORT`, `BTI`, and any later supported provider.
- Select every connected provider by default.
- Disable providers without a validated live catalog adapter and show the exact status: disconnected, session invalid, schema error, or stale.
- Require at least two selected, connected providers before displaying a cross-provider comparison.
- Provider labels must come from validated runtime identity, never a FABet card label or hostname guess.

## Comparison hierarchy

The page is divided into `Football` and `LoL`. Within the selected category:

1. Group rows by a verified canonical event.
2. Within each event, group by exact market identity.
3. Render one row per market and line, with one provider column per selected provider.

Football rows initially include:

- `FT_1X2` with `HOME`, `DRAW`, and `AWAY` prices.
- `FT_TOTAL` with separate rows for every exact line and `OVER`/`UNDER` prices.

LoL rows initially include only normalized markets supported by both providers, such as series winner, map winner, and map total kills with an exact map scope and line.

## Verification gates

An event is comparable only when the canonical mapper verifies participant identity/order, category, live/prematch state, timing evidence, and event scope. A market is comparable only when market type, scope, settlement profile, outcome domain, and line match exactly.

The UI must not copy, estimate, or silently substitute values. An unverified provider cell shows a reason instead of an odd. A row cannot be ranked as an opportunity when any required quote is stale, suspended, closed, malformed, missing, or from an unvalidated provider identity.

## Table behavior

- Provider columns remain in a stable order matching the checkbox list.
- Show the same provider checkbox selector on the catalog and event-detail views; both surfaces share one persisted selection.
- Each event card shows provider hashtag badges only for verified providers that currently expose that event.
- Upcoming events show a live `Starts in DD:HH:MM:SS` countdown derived from the canonical start time. At zero, the client requests a fresh snapshot instead of assuming that the event is live.
- Each cell shows raw odds, normalized decimal odds, quote status, and quote age.
- Highlight the best eligible price for each selection in green.
- Render suspended/stale/missing cells in gray with a short reason.
- Sort events with live opportunities first, then live events without opportunities, then upcoming prematch events by start time.
- Sort market rows within an event by realized net margin descending, then market type and numeric line.
- Preserve filters and selected providers in local storage.

## Opportunity panel

Above the full table, show a compact list of verified opportunities derived only from selected providers. Each item displays:

- Event, market, scope, and exact line.
- The selected outcome for each leg and its provider.
- Raw and decimal odds for every leg.
- Native stake, base-currency stake, fees, FX assumptions, total stake, worst-case profit, and realized ROI.
- Quote age and remaining eligibility time.
- A clear read-only status until both account preflights pass.

Positive margin is calculated after native stake rounding, fees, and FX conversion. The panel must never describe theoretical inverse-sum evidence as executable profit.

## Data flow

1. Each live adapter publishes independently timestamped normalized events, markets, and quotes.
2. Runtime identity validation binds the adapter to its real provider.
3. Event and market mappers produce only verified cross-provider identities.
4. The opportunity engine evaluates selected providers and emits realized results.
5. The API returns a comparison snapshot containing provider states, canonical events/markets, provider cells, and ranked opportunities.
6. The web client renders the snapshot without performing its own event mapping or financial calculations.

Provider selection is sent to the API so filtering and opportunity calculation use the same provider set. Concurrent provider reads are required; sequential polling must not manufacture a false timing lead.

## Failure handling

- A failed provider remains visible with its last status, but its cached quotes become ineligible immediately.
- A provider reconnect does not become usable until a fresh authoritative snapshot is accepted.
- If fewer than two selected providers are live, show `Need at least two verified live providers` and no opportunity cards.
- If no events map exactly, show per-provider event counts and a link to Mapping Review.
- If an event maps but markets do not, retain the event and show the market mismatch reason.

## Testing and acceptance

- Unit tests cover provider selection persistence, exact event/market/line grouping, best-price highlighting, sorting, and disabled/error states.
- Core/API tests prove different lines never merge, reversed outcomes map correctly, stale/suspended quotes cannot rank, and selected-provider filtering changes opportunities.
- Integration tests use two independent adapters and timestamps; fixtures remain visibly marked fixture-only.
- Browser tests verify checkbox behavior, provider column labels, opportunity ordering, reload persistence, and hiding cached opportunities during reconnect.
- Browser tests verify identical provider selection on list/detail pages, exact provider hashtags, deterministic countdown display, and refresh at the countdown boundary.
- Real acceptance requires two independently validated live providers showing the same event and at least one exact common market. Until then, the screen must state that comparison is unavailable.

## Explicit non-goals

- No automatic bet placement in this feature.
- No guarantee of profit or execution; displayed profit remains conditional on successful preflight and unchanged odds.
- No fuzzy market/line matching and no inferred provider identity.
