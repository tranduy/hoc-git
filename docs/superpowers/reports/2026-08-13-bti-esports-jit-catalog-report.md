# BTI Esports LoL JIT catalog report — 2026-08-13

## Outcome

- Disambiguated the two Fabet cards labelled BTI by bounded asset identity and category.
- Verified BTI sport ID 64 and LoL league code from the authenticated primary source.
- Added a JIT catalog reader that clicks the current BTI Esports launcher in the persistent Fabet context.
- Added fail-closed positional decoding and exact LoL series-winner normalization.
- Registered `catalog-source:BTI:LOL` anchored to the active Fabet session.

## Exact accepted scope

- Sport ID: `64`
- League sport code: `LOL`
- Market: `ML39` when live, `ML0` when prematch
- Domain: provider sides `1/3` mapped to `TEAM_A/TEAM_B`
- Settlement: `lol-series-winner`
- Line: null

Every other esport, total, handicap, malformed market, mismatched participant, duplicate identity,
invalid decimal or non-exact outcome pair is rejected.

## Real-source smoke

- 4 events
- 4 markets
- 8 quotes
- 34 out-of-scope markets rejected
- Sample: Ole Miss Esports vs Cupid eSports
- Provider event ID: `874545943830458368`
- Provider market ID: `0ML874545945319329862`
- Snapshot prices: decimal `4.18 / 1.21`

No bet slip, preflight or real-money operation was performed.
