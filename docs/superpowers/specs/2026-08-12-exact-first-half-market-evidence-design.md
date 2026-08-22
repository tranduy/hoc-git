# Exact First-Half Market Evidence Design

## Goal

Determine whether SABA and SBOBET expose the same exact two-outcome first-half Football markets, then enable only the shapes proven by both live feeds.

## Evidence boundary

SABA live metadata already proves `bettype=7` is `1H Handicap` and `bettype=8` is `1H Over/Under`. SBOBET must be inspected through its authenticated read-only `getEvent` response. The diagnostic output may contain only numeric market-group keys and structural token shapes; it must not output launch URLs, headers, cookies, tokens, account identifiers, participant names, prices, selection IDs, or raw payloads.

No production market is enabled from a guessed numeric key. A SBOBET group is accepted only after its live structural shape and page semantics prove first-half scope, exact outcome orientation, line representation, and provider market/selection IDs.

## Exact eligibility

If both feeds prove the shape, the comparison layer may add:

- `FH_AH / FIRST_HALF / x.5 / HOME|AWAY`;
- `FH_TOTAL / FIRST_HALF / x.5 / OVER|UNDER`.

The semantic key remains category, event identity, market type, scope, canonical line, outcome domain, and settlement profile. Integer and quarter lines, missing lines, three-way markets, duplicate provider markets, reversed orientation ambiguity, mismatched settlement, stale quotes, suspended quotes, and incomplete outcome domains remain fail-closed.

## Delivery

First add a private inspection mode and collect live evidence. Only evidenced groups receive decoder tests and implementation. The existing horizontal comparison, fixed-stake calculation, top-five ranking, green verified gate, toast, and sound consume the normalized rows without a separate execution path. OBSERVE mode remains unchanged and no bet slip or wager action is allowed.

