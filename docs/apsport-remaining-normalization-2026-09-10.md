# APSPORT: remaining normalization and missed opposing predicates

The retained AP feed contains 62,161 native market rows from 653 events. Before
this change, the current decoder already produced 60,953 canonical markets and
86,047 quotes; 1,208 native rows remained unmapped. This is the current baseline,
not the historical 18,802-market decoder. AP's source timestamp is
2026-09-10 00:26:29 +07:00 and its captured state is STALE.

## Implemented

- Native 150/151 preserve home-no-bet and away-no-bet refund conditions.
- Native 146 retains the positive goal ordinal and HOME/AWAY/NO_GOAL outcomes.
- Native 147 retains the starting score of the remaining-result wager. `3.0`
  means an anchor of 3–0; it is not a decimal goal line or ordinary FT result.
- Native 23–28 use separate extra-time and first-half extra-time scopes for
  result, total and handicap. They cannot merge with regulation-time markets.
- Native 153 accepts a player only when original fields 15/16 provide the
  exact native player ID and name; the goal ordinal is retained. Unknown team
  orientation remains unknown and cannot produce a cross-book player match.
- Native inventory now retains bounded public player/time-range metadata.
  AOS stores the observed exact-score list, including suspended offers, while
  explicitly leaving settlement-domain completeness unproven. No credentials,
  page objects or request headers enter the retained context.
- A temporarily unpriced binary side no longer discards the priced native side.
  Its source observation remains partially UNMAPPED with the missing-price reason.
- AP98 `HOME_AWAY_NO` and BTI QA5200 `DRAW_YES_YES` now share opposite sides of
  the same predicate: draw OR both teams score. BTI's NO selection is the same
  side as AP's offer and cannot pair with it. Native market/selection IDs,
  source quotes, prices, receipt clocks and sequences remain attached.
- AP bootstrap recognizes registered alternate page hosts and the document's
  explicit language. API origin still requires allowlisted page/resource/hint
  evidence. Specific bootstrap failure reasons replace a generic missing-template
  message; freshness and source/document generation guards remain unchanged.

## Fixed-input evidence

Artifacts live in `.run/ap-remaining-2026-09-10/`. Original AP source SHA256:
`454a30280d770e491dc31026e24f174645886cf5a4c940598a9427b4137895e5`.
The after engine hash is
`9dd9535605385858726f8847cb96173213ca526fc096344bb26c36a8161b44c8`.
BTI is held at the latest normalized fixed peer on both sides; SABA/SBO/CMD
are identical fixed peers. IM is unavailable in this audit.

| Measurement | Before | After | Change |
|---|---:|---:|---:|
| AP native rows retained | 62,161 | 62,161 | 0 lost |
| AP canonical markets | 60,953 | 61,014 | +61 |
| AP canonical quotes | 86,047 | 86,208 | +161 |
| AP native rows unmapped | 1,208 | 1,147 | −61 |
| Unique opposing native market pairs involving AP | 40,039 | 40,143 | +104 |
| AP source markets participating in pairs | 22,469 | 22,573 | +104 |
| AP events participating in pairs | 540 | 540 | 0 |
| All-provider native market pairs | 64,500 | 64,604 | +104 |

There are **zero lost pairs**. All 104 new pairs come from the missing AP98/BTI5200
equivalence between previously canonical markets. The 61 newly normalized
markets have no opposing counterpart in these fixed peers. Existing canonical
markets, quotes and native selection values remain unchanged. Reconstructed
new quote receipt/sequence values are zero; replay does not establish fresh
availability, executable odds or profitable opportunities.

Remaining 1,147 rows:

| Native group | Rows | Missing proof |
|---|---:|---|
| 10/11 AOS | 1,054 | Exact settlement complement: 533 FT and 521 FH |
| 153 player next scorer | 69 | Player ID/name omitted from historical inventory |
| 161/167/168/169/170 fast markets | 12 | Native field 17 time-range index omitted |
| 140 first-half corner over/exact/under | 12 | Direct proof of native outcome-slot order |

Ten retained full raw AP captures contain no exact selection-ID matches that
could restore the missing historical metadata (`recover-context.json`). No
names/windows are borrowed from unrelated rows. AOS visible domains vary:
prematch FT has 25 exact scores; prematch FH has 15 (excluding 3–3); live FH
at 0–0 has nine. AP's static renderer creates placeholders for absent offers,
so it does not certify that all AOS wagers have the same complement.

AP's own public renderer and embedded settlement rules are retained in
`.run/double-chance-normalization-2026-09-09/four-provider/ap-public-0.js` and
`ap-public-app.js`. Key locations: 150/151 slots 432272; goal ordinal 436241,
480155; fast-window tables 137627; ET rules 896563–897888. AP card rules at
900758 use yellow=1/red=2/max=3 per player. The fixed AP input contains no
CARD markets; cross-book card-weight equivalence has not been established by
this audit and must not be inferred from generic labels alone.

## Validation

462 backend tests and all 457 catalog/web tests passed. Extension validation:
422 tests and typecheck passed. Contracts, adapters, core, API and web typechecks
passed. The replay asserts native conservation, unchanged old values and zero
lost pairs. Runtime deployment evidence is recorded separately in
`deployment.json` and `.run/ap-ingress-2026-09-10/`; successful replay does not
mean AP has resumed live ingestion.
