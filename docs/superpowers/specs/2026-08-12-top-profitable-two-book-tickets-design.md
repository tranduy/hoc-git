# Top Profitable Two-Book Tickets Design

Date: 2026-08-12
Status: Approved conversational design; awaiting written-spec review

## Goal

For each live or near-start Football/LoL event, show at most five exact two-outcome tickets shared by at least two selected providers. Rank the tickets by the highest guaranteed profit after balancing both legs. Notify the operator immediately when a newly executable ticket reaches at least 20,000 VND guaranteed profit.

The screen remains read-only. This feature prepares the comparison and notification surface; it does not submit a wager.

## Fail-closed event and ticket identity

An event is cross-book comparable only when the existing mapper proves one unique match using category, real/virtual or game variant, event scope, normalized participant identity and orientation, scheduled time or compatible live score/period evidence, and rematch discriminator when required. Ambiguous or contradictory candidates are excluded and remain available for Mapping Review.

A ticket row is cross-book comparable only when all of the following match after applying the event orientation:

- category;
- market type;
- scope;
- signed line;
- settlement profile;
- exact two-selection outcome domain;
- OPEN market and OPEN quotes;
- distinct providers for the two selected best-price legs.

Football focus remains full-time Asian handicap (`FT_AH`) on half-goal lines, with exactly `HOME` and `AWAY`. LoL focus remains series winner (`SERIES_WINNER`) with exactly `TEAM_A` and `TEAM_B`. Three-way markets, totals, quarter lines, duplicate provider markets, incomplete outcome domains and single-provider rows cannot enter the ranked list.

“Exact” means fail-closed precision: uncertain tickets are hidden rather than guessed. It does not promise that every true real-world match will be recognized.

## Profit calculation and ranking

For every exact row, normalize provider odds to decimal and evaluate every valid pair of opposing selections from distinct selected providers. Apply the configured 100,000 VND base stake to the lower-decimal-odds leg, then calculate the other leg on its provider's native minimum, maximum and stake step.

For each candidate pair calculate:

- stake on each provider;
- total stake;
- net payout and profit when outcome A wins;
- net payout and profit when outcome B wins;
- guaranteed profit: `min(profitA, profitB)`;
- ROI: `guaranteedProfit / totalStake`;
- raw odds gap per outcome for operator context.

Fees, FX spread and provider constraints must be applied when verified evidence exists. A row without complete executable assumptions may display a clearly labelled observation estimate, but it cannot turn green or create a profit toast.

Rows are ordered by:

1. verified guaranteed profit descending;
2. verified ROI descending;
3. most recent immediate price-movement magnitude descending;
4. stable ticket identity ascending.

Only the first five rows are rendered for each event. Events with the best verified guaranteed profit appear first. An exact two-book row may remain visible with zero or negative guaranteed profit so the operator can watch current prices; it stays neutral, never green.

## Horizontal event table

Each event card contains one compact horizontal table. The header shows the real participant names, competition, live/countdown clock, connected provider tags and the event's best guaranteed profit.

Each ticket occupies one row with these columns:

1. ticket type and signed line;
2. one price cell for each selected provider, showing both named outcomes, raw format, decimal equivalent and OPEN/SUSPENDED state;
3. chosen opposing legs and provider names;
4. stake on each leg;
5. profit if participant A wins;
6. profit if participant B wins;
7. guaranteed profit and ROI.

The best quote for each outcome is visually emphasized. A verified row with guaranteed profit of at least 20,000 VND receives a green border/background. Observation-only, incomplete, stale or non-profitable rows use neutral/warning styling and an explicit reason. The layout scrolls horizontally on narrow screens without collapsing provider identities or prices.

## Toast notifications and sound

When a row transitions into an executable state with verified guaranteed profit of at least 20,000 VND, enqueue a toast at the right side of the screen. Toasts stack vertically, newest at the bottom, move upward as older entries expire, and remain visible for five seconds.

Each toast shows:

- event participant names;
- ticket type and line;
- both selected providers and decimal odds;
- both stakes;
- guaranteed profit and ROI.

Clicking a toast navigates to the exact event detail route and highlights/scrolls to the ticket row. The identity in the URL/state must contain the canonical event key and ticket key, never a guessed display label.

The client plays one short local notification sound for a newly enqueued toast after the browser has received a user interaction. Before audio is unlocked, visual notification continues normally. Audio failure cannot affect monitoring.

## Deduplication and lifecycle

Polling must not generate the same toast repeatedly. The toast identity is the exact event key plus ticket key plus chosen provider/selection legs. A toast may fire again only when:

- the opportunity first disappeared below the executable threshold and later re-entered it; or
- its guaranteed profit increased by at least 5,000 VND after the previous alert.

Stale, suspended, schema-invalid, unmapped or single-provider updates immediately remove executable styling and reset eligibility for a future re-entry alert. A maximum of five visible toasts is retained; expired entries are removed without affecting the underlying opportunity.

## Components and data flow

1. `buildComparisonEvents` continues to own fail-closed event and market identity.
2. A pure ticket-ranking function converts only exact `ComparisonRow` values into display candidates, evaluates balanced plans, sorts them and limits each event to five.
3. The event table renders ranked candidates and provider columns without performing identity or financial calculations itself.
4. A notification tracker compares consecutive ranked snapshots and emits deduplicated alert events.
5. A toast stack renders alerts, handles five-second expiry/navigation and requests audio playback through an isolated notifier.

No component may infer missing provider prices, copy odds between providers, or promote an observation estimate into an executable alert.

## Verification

Automated tests must cover:

- exact same event/type/scope/line/settlement/two-outcome matching;
- participant orientation reversal;
- rejection of ambiguous rematches, different lines, different settlement, three-way, duplicate and single-provider tickets;
- all provider-pair permutations and exact stake/profit arithmetic;
- descending guaranteed-profit ranking and five-row limit per event;
- neutral rendering for non-profitable and observation-only rows;
- green rendering only at verified guaranteed profit >= 20,000 VND;
- five-second stacked toast lifecycle;
- deduplication, threshold re-entry and 5,000 VND profit-increase re-alert;
- click-to-detail with exact event/ticket identity;
- audio unlock, one sound per new alert and harmless playback failure;
- full web typecheck/build and relevant comparison/watch regression suites.

Live verification must remain read-only and record source/provider/category, event/market counts and alert calculations without tokens, cookies, credentials or wager submission.
