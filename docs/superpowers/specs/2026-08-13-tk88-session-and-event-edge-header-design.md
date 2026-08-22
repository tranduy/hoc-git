# TK88 Chrome session and event edge header design

## Goal

Use the operator's already-authenticated TK88 Chrome session as a first-class catalog source where applicable, without routing those lounges through Fabet. Make every Football/LoL event card expose its best current cross-book price gap and estimated balanced profit at the top, matching the fast scanning workflow shown in the supplied reference UI.

The system remains read-only. This change must not open a bet slip, enter a stake, submit a wager, or expose cookies, tokens, credentials, or launch URLs.

## Session ownership

Add `TK88_CHROME` as a distinct session source. It must never be relabelled as `FABET_LOGIN` or inferred from a hostname alone.

TK88 uses a dedicated persistent Chromium profile managed by the application. The operator signs in once using the visible browser. The application then reuses that same profile and its authenticated tabs. This is preferred over attaching to the operator's general personal Chrome because it gives deterministic profile ownership and avoids requiring a remote-debugging port on the personal browser.

Each catalog lounge has an explicit launch strategy:

- `TK88_CHROME`: reuse or navigate inside the authenticated TK88 profile;
- `FABET_LOGIN`: click the exact verified Fabet lobby card in the Fabet profile;
- `MANUAL_PROVIDER_SESSION`: use an explicitly registered provider session;
- direct token/session: use only an explicitly configured, validated provider session.

There is no fallback from one strategy to another unless that fallback is configured for the exact provider and category. A TK88 failure cannot silently trigger a Fabet login or bind a different lounge.

## Source identity and safety

The source key remains `provider + category + authenticated session identity`. Provider/category identity must be proven from the launched page and observed protocol before a catalog is accepted.

Session state and catalog-read state are separate:

- authenticated session available;
- catalog currently reading;
- last successful snapshot and age;
- retry/backoff state;
- authentication required;
- schema changed;
- unavailable.

An authenticated page that visibly works but whose parser fails is reported as a reader/schema failure, never as “no matches.” “No matches” is allowed only after a successful fresh read with `eventCount = 0`.

Secrets are stored only through the existing encrypted local vault/browser profile. API responses, logs, UI, docs and source code expose no cookie, token, password or complete launch URL.

## Catalog lifecycle

Each provider/category source keeps an independent page, in-flight read, timeout and circuit breaker. A slow TK88 lounge cannot block another TK88 lounge, a Fabet lounge, `/api/health`, profiles, or another catalog.

The application prefers protocol responses or provider push streams over DOM scraping. DOM is used only for verified navigation and as a fail-closed fallback when the exact semantic identity is available.

Last-success data may remain visible for its bounded display lifetime, labelled with its age and stale state. Stale data cannot participate in event mapping, price signals, green state, toast, preflight or later execution.

## Exact comparison

Single-provider events may appear only in Mapping Review/source diagnostics as observation evidence. The primary arbitrage list and every cross-book calculation require at least two fresh selected providers.

An exact row requires one unique match for all applicable evidence:

- category and real/virtual/game variant;
- competition and oriented participant identities;
- start-time/live lifecycle compatibility and rematch discriminator;
- market type and scope;
- canonical line;
- complete two-outcome domain;
- settlement profile;
- OPEN and fresh quotes.

Ambiguous or contradictory candidates remain excluded and are sent to Mapping Review. Values are never copied, guessed or synthesized between providers.

## Full-width arbitrage workspace

The Football and LoL comparison pages use the full available viewport width after the navigation rail. They must not retain the current narrow centered content column or leave a large unused area on the right.

The desktop workspace has two resizable visual regions:

- the left/main region contains the dense ranked event list and exact two-book prices;
- the right region contains the selected ticket's balancing panel with the two chosen providers, opposing outcomes, current decimal odds, stake inputs, calculated payouts, both outcome profits, worst-case profit and ROI.

The right region is informational/read-only in this phase. It may expose editable base-stake configuration and recalculation, but it has no submit-bet control and never opens or touches a provider bet slip. On narrow screens it stacks below the list instead of overflowing off-screen.

## Main list inclusion rule

The primary arbitrage list contains only events that currently have at least one exact two-outcome row shared by at least two fresh selected providers. A card with prices from only one provider must never appear in this main list, because it cannot describe a cross-book edge.

Single-provider, stale, ambiguous and unmatched events remain counted in a compact diagnostic strip and Mapping Review. They do not consume rows in the arbitrage list and cannot display a profit percentage.

When no exact two-book event exists, the main area explicitly says `No exact two-book comparison is currently available` and shows per-source freshness/error diagnostics above it.

## Event-card header

Every visible event card has a compact scan header containing:

- real competition and participant names;
- live clock or start countdown;
- provider badges and per-source freshness state;
- a prominent colored `X.XX%` value at the far left/top, where `X.XX%` is the balanced two-book worst-case ROI for the best exact row;
- `Estimated balanced profit Y VND` for the configured base stake;
- the two providers used by that best row;
- exact market/line label.

The headline percentage is not the raw odds difference. It is the balanced two-book worst-case ROI: `minimum profit across both outcomes / total stake × 100`. This is the percentage the operator could retain across either outcome under the displayed assumptions. It is labelled `ESTIMATE` until preflight verifies provider constraints, fees and current availability. Raw per-selection odds gaps remain available as secondary evidence in the expanded detail.

Estimated balanced profit uses the configured base stake on the lower-odds leg and the existing discrete hedge calculation. It is labelled `ESTIMATE` until both provider constraints/fees/freshness pass preflight. Negative or unavailable estimates remain visible with neutral styling.

An event without an exact two-provider row is excluded from the main arbitrage list; it must not show a fabricated percentage or profit.

## Ordering and detail

Events are ordered by:

1. verified guaranteed profit descending;
2. positive estimated worst-case profit descending;
3. positive estimated balanced ROI descending;
4. immediate movement magnitude descending;
5. live/near-start priority and scheduled time.

The compact list row shows both provider names, the exact opposing outcomes, both current odds and movement age without requiring a click. Selecting the row fills the right-side balancing panel. The expanded detail continues to show at most five exact two-outcome rows, provider prices side by side, selected opposing legs, stakes, both outcome profits, worst-case profit and ROI.

Green styling, sound and five-second toast require two fresh exact providers, both OPEN legs, successful provider preflight and at least 20,000 VND verified worst-case profit. Clicking the toast opens the exact event and ticket.

## Tests and acceptance

Tests must first fail, then pass, for:

- TK88 session source remains distinct from Fabet and manual sessions;
- a TK88-backed lounge uses only the TK88 profile/strategy;
- an authenticated page plus parser failure is not reported as zero events;
- one slow TK88 lounge does not block any other source;
- event header shows best gap, estimated profit, providers and exact market/line;
- the main list excludes every event backed by only one fresh provider;
- the page uses all available width and keeps the balancing calculation visible on the right;
- the headline percentage equals balanced worst-case ROI, not a raw odds-gap percentage;
- no exact pair produces an explicit empty main-list state rather than invented values;
- ranking follows verified profit, estimate, gap, movement and time;
- stale/suspended/ambiguous/three-outcome rows cannot turn green or alert;
- secrets never appear in responses, UI, logs or fixtures.

Live acceptance is read-only: use the existing TK88 login, confirm catalog counts and repeated price refreshes for each configured lounge, and verify the Football and LoL screens render the header fields. No bet slip or real-money action is permitted by this work.
