# IM full native prematch collection — 2026-09-08

Implemented and deployed on the shared `feat/realtime-hardening` branch. The user's accepted scope is acquisition of native hidden markets; semantic matching and continuous/session maintenance are deferred.

## Result

The deployed collector retrieved unfiltered event detail for **659/659 regular football prematch events**. The source cache contains **66,318 GetEBI markets / 291,154 native selections**, covering **85 bet types / 130 type-period combinations**. **47,740 market IDs are additional to the GetSE roster.**

The aligned API retained exactly **87,604/87,604 combined native market IDs and 386,903/386,903 selections**, including the existing roster inventory. There were **zero missing markets, missing selections, or raw price/line differences**. All 659 comparable prematch events were published. Existing normalization yielded 16,161 canonical markets / 32,322 quotes; this is distinct from full native acquisition.

## Source proof and change

- The old collector requested 40 fixed bet types through GetMEI, ten owners per refresh. A real event (`113077626`) had only 56 markets / 15 types in that request but **157 markets / 68 types** in the page's unfiltered GetEBI endpoint. Its `abtp` field was also only a tab subset, so expanding that field alone would remain incomplete.
- The public page bundle `main-9992f20.js` proves the authenticated, signed, read-only `POST /api/EventV6/GetEBI/1/{eventId}/false/2/false` route with no request body or bet-type filter. The collector now uses that route for every prematch owner, with two physical requests and a fair queue. No duplicate GetMEI lane or source navigation was added.
- Both Early/Today GetSE partitions must complete before replacing roster membership. Cached pairs are not republished as fresh responses. Source, bridge and document generations fence the queue; unsuccessful or mismatched detail responses preserve the prior detail. Successful full EBI replaces only its own detail domain.
- Each retained market keeps its original receipt. Newer main prices win over older cached detail, and unrelated deltas do not refresh hidden quote clocks. Unmapped selections retain original IDs, outcome IDs, lines and prices in the API's optional `nativeSelections` inventory. Existing publication/realtime settings are unchanged.

## Deployed evidence

- Extension **0.2.79**: `sha256:9af80c4fc699823c1b170002bfb82b4feb02005aed0d599d827bdfdba0d30a15`.
- Managed stack: `sha256:7653215b0ce66cf9b7892ddfc6a11dc53bcac16f23c91cd7385493f8675c046d`; instance `8f2acb45-fba5-47a5-8cdd-22a3f740f482`.
- Source `chrome:IM:2105832145`; aligned pre/post API epoch `17b33054-1b0b-44e9-8fb1-e02763d2b36b:2`.
- Source snapshot `1788866601585`; API snapshot `1788866620844`. Source cache: 659 completed, zero pending, zero detail failures, zero unidentified market rows. One failed roster refresh was recorded while the last complete roster remained retained.
- Local evidence directory: `.run/parallel-hidden-markets-2026-09-08/im/`. `native-cache-1788866601585.json` SHA-256 `4c0ae5a55c76242d47d3bd81b788688636e8cab5e2d60cf19d4f9ec64892993b`; `catalog-aligned-1788866620844.json` SHA-256 `b988b6af1c71bb1e36defadd2d38fe23ac83afee6a8e0ae56e5c6efbe11a5c17`.
- `COVERAGE079-1788866601585.json` and `COVERAGE079-FINDINGS-1788866601585.json` contain exact ID/selection comparisons. `EBI-VS-MEI-SCOPE.json`, `PUBLIC-NATIVE-SCOPE-PROOF.json` and `EBI-REPLACEMENT-PROOF.json` retain discovery evidence. Raw source artifacts remain local and ignored; the credential-free native event fixture is committed with the collector regression.

## Verification and remaining work

Focused verification passed: 77 API decoder/receipt tests; 7 collector tests including the actual 157-market response; 29 observer/manifest tests; 3 native-observation contract tests. Contracts/API builds and extension typecheck/build passed. All **87,604 actual API native observations** also passed the updated strict schema, including 36-selection markets. No full monorepo suite or extended maintenance run was performed.

The retained inventory includes **32,737 unmapped observations**, 13,198 nonbinary, 1,561 three-way, 1,244 refund/push, 840 invalid two-way shapes, and 21,286 event-not-comparable observations. These are acquisition dispositions, not missing raw data. Separate boosted/PAP offers returned by GetESI are outside ordinary unfiltered event-market coverage and were not collected in this phase.

After the successful aligned comparison, IM stopped publishing new paired baselines and its API catalog became **STALE / ACTION_REQUIRED**. Diagnostics at `1788866786197` recorded 161 seconds without a decoded update and the fallback label `IM_MANUAL_TOKEN_REQUIRED`; that label alone does not establish actual token expiry. The successful source/API coverage result above remains valid, but continuous refresh is **not accepted**. Preserve `POST-COVERAGE-DIAG.json` for the deferred maintenance step.

A single subsequent read of the unchanged source document at `1788866846804` confirmed that the collector retained 659 owners but was no longer advancing: 22 roster failures, 68 detail failures, no active requests, and the latest detail receipt 219 seconds old. The generation remained current and no public login/token error was visible. No refresh, login or extra source request was attempted; the cause remains unverified for the maintenance step.

The same final point check kept SBOBET, BTI and CMD LIVE/FRESH, with respectively 280, 10 and 174 quote changes in the preceding 60 seconds. This was preservation checking, not a renewed coverage audit. Deployment lease was released; inspection helpers/listeners/export buffers were removed.

## Short notes for later steps

- IM: map retained native types when requested; resolve the post-coverage refresh/session gap during maintenance.
- CMD: 10,635 unmapped More arrays remain from its accepted capture; one live AH row's later absence was not explained. Prematch acquisition was verified separately.
- BTI: retained unmapped native detail remains for later semantic matching; continuous operation is deferred.
- SBOBET: previously accepted collection with one or two transient markets tolerated; continuous operation is deferred.
- SABA: deferred by the user; no work performed here.
