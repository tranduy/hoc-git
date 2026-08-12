# I-Sports · IM Football JIT catalog report

Date: 2026-08-13
Mode: OBSERVE / read-only

## Outcome

The IM Football catalog is no longer replayed from a stored one-time launch URL. The API uses the active
Fabet browser session, opens the Live Sports lobby, clicks the exact `I-SPORTS` card and reads the
Sunflower 2.0 EventV6 feed inside that authenticated page.

Logical source: `catalog-source:IM:FOOTBALL`.

Accepted scope is deliberately narrow:

- Football only;
- full-time Asian handicap (`FT_AH`);
- exactly `HOME` and `AWAY`;
- half-goal lines only (`x.5`);
- non-virtual events with exact provider event, market and selection IDs.

Three-way 1X2, totals, quarter lines, virtual football, malformed envelopes and incomplete identities are
rejected. No slip or betting endpoint was opened.

## Primary-source protocol evidence

- snapshot: `POST /api/EventV6/GetSE`;
- delta: `POST /api/EventV6/GetSEDelta`;
- successful envelope marker: `StatusCode: 100`;
- event identity: `eid`, `htn`, `atn`, `cn`, `edt`;
- market identity: `mi`, `bti`, `gp`;
- selection identity and price: `wsi`, `si`, `hdp`, `dih`, `o`.

## Live smoke

The production API returned:

- provider/category: `IM / FOOTBALL`;
- 17 events;
- 20 markets;
- 40 quotes.

One sample was `Monterrey Rayados vs Nashville SC`, provider event `112516390`, market `2498219109`,
line `0.5`, selections `32336976657` and `32336976658` at Malay `0.67` and `-0.79` during the sample.
Eight warm reads completed in approximately 0.22–0.78 seconds each. No price change happened during that
short sample window, so no movement claim or synthetic alert was produced.

## Verification

- focused IM/Fabet/source suite: 48/48;
- full API suite: 474/474;
- full adapters suite: 65/65;
- API and adapters typecheck: pass;
- API and adapters production build: pass;
- `git diff --check`: pass (line-ending warnings only).

## Remaining lounge coverage

Of the six original lounges in `sảnh.md`, CMD Football remains without a verified fresh catalog adapter.
BTI LoL is an additional expansion target outside that original list. Real-money execution remains locked
behind a separate explicit confirmation.
