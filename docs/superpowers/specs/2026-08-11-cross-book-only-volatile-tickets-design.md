# Cross-book-only volatile ticket design

## Outcome

The main Football and LoL monitor shows only a ticket that is independently present at two or more selected, connected providers. A visible row is therefore a real comparison, never a single-provider observation. The system remains read-only.

## Exact identity rules

- An event may join only when category, real/virtual identity, event scope, participants after explicit verified aliases, live state, score/period evidence, and start-time/rematch evidence agree.
- Fuzzy name similarity may suggest a Mapping Review item, but it may not create a comparison row.
- A ticket may join only when market type, scope, canonical line, settlement profile, and the complete outcome domain agree.
- Football focus is full-time Asian handicap on half-goal lines with exactly `HOME|AWAY`. LoL focus is exact two-team series winner. Draw, push, quarter-line, incomplete, and three-way markets are excluded.
- Multiple provider markets with the same semantic key are not merged blindly. A provider contributes one cell only when the market identity is unambiguous; otherwise that provider/row is rejected with a diagnostic.

## Display and ranking

- Hide single-provider events and tickets from the main list. Show their counts and a link in Mapping Review so missing coverage remains diagnosable.
- A visible row contains at least two unique provider columns with current real odds for the exact same ticket.
- Show neutral rows even when the current prices do not produce profit.
- Rank executable rows first by rounded worst-case profit from the configured stake plan, then by the largest immediate accepted quote change, then by start time.
- Rank neutral rows after executable rows by the largest immediate accepted quote change and then by start time.
- “Immediate change” means the difference from the immediately preceding accepted provider snapshot. There is no five-minute wait or aggregation window.

## Profit signal

- Use `100000 VND` on the lower-decimal-odds leg and calculate the opposing stake on the other provider using its limits and stake step.
- A row becomes green only after an accepted price movement and only when two different providers supply the chosen opposing legs, both markets and quotes are `OPEN`, both quotes are at most `5000 ms` old, and rounded worst-case profit is at least `20000 VND`.
- Show both providers, selections, odds, stakes, outcome profits, worst-case profit, ROI, quote age, and the triggering movement.
- Emit a ten-second toast once per new qualifying movement fingerprint. Remove green state immediately when the edge, freshness, openness, or exact mapping disappears.

## Provider/category diagnostics

- Loading a provider for Football must use that provider's Football catalog; LoL must use its LoL/esports catalog. A provider selected but unavailable in the requested category is not treated as an empty matching book.
- The status bar distinguishes connected/category-ready, category-unavailable, no exact event match, no exact market match, ambiguous duplicate market, and schema/session failure.
- Provider selection means “include this feed in intersection,” not “pretend every event exists on this book.”

## Verification

- One-provider events never appear in the main list.
- Two provider events with verified aliases and identical exact tickets appear side by side even without an edge.
- Different line, scope, settlement, outcome domain, category, live evidence, or ambiguous same-provider duplicates never align.
- A quote move is processed on the next accepted poll; no five-minute delay exists.
- Profit is the primary ranking signal; movement magnitude is secondary evidence.
- A qualifying movement turns the exact row green and raises a ten-second toast; `19999 VND`, stale, suspended, one-sided, or unmapped cases remain neutral or absent.

