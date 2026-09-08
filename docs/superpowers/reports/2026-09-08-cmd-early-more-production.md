# CMD Early and hidden-market acquisition — 2026-09-08

CMD now retrieves the complete unfiltered Early roster and native More groups through the existing authenticated page and HTTP bridge. The final source/API comparison covers **691/691 prematch fixtures and 897/897 native More groups**. Session maintenance and continuous/24-hour acceptance remain deferred by the user.

## Production evidence

- MAIN: `feat/realtime-hardening`, main checkout `F:\0. PROJECT\tool-chenh`.
- Extension: **0.2.78**, bundle `sha256:a8780e7741de9656b107d3d03dbc992d20cf65d64e7ddc06da62cef3d1c69177`.
- Managed stack: `sha256:26b3fc3570dcde6e53ff088acf7a89abc2661b183d22a171a7c817e8ce59bb66`.
- CMD source: `chrome:CMD:2105831911`, epoch `b04c1c50-a282-4562-a57e-5ad563b2fc02:4`.
- Native capture at **17:50:00.068 UTC+7**: 897/897 groups, zero pending/failed, Today 437 rows, Early 961 rows, Running 30 rows. Rows include alternative and special groups; they are not fixture counts.
- Aligned API capture at 17:50:24: **701 total fixtures, including 691 prematch; 3,878 markets; 7,756 quotes; 29,886 native observations**. All 691 prematch owners are present.
- Every More group has all 19 captured native arrays in the API: **17,043/17,043 arrays**. Dispositions: 697 normalized, 1,418 three-way exclusions, 10,635 unmapped, 3,584 event exclusions, and 709 closed markets.
- **697 More markets / 1,394 quotes** are normalized. Remaining published More quotes have zero price or semantic differences against the capture. The source capture had one additional pair for owner `25412013`; a newer actual More response explicitly closed it with `[-999,-999]`.
- The 91 differing roster quotes and eight line differences all have API receipts after the native freeze. One alternative AH row remains unverified in the **live** partition; it does not affect the prematch denominator.
- Final CMD feed is LIVE/FRESH, no failing hop, evidence age 692 ms. This is a point observation, not a source refresh SLA. The short 40-second observation did not capture a More price change; no continuous-operation acceptance is claimed.

Evidence remains in the ignored directory `.run/parallel-hidden-markets-2026-09-08/cmd/`:

- `native-cache-1788864600068.json`, 1,542,427 bytes, SHA-256 `d34170fd438eee5afb5fbab2e3fb8318296c51be3dfca4e75f3060618bf7ca26`.
- `catalog-aligned-1788864624078.json`.
- `COVERAGE078-1788864600068.json` and `COVERAGE078-FINDINGS-1788864600068.json`.
- `SBO-BTI078-PRESERVATION.json`: both providers LIVE/FRESH; SBOBET 521 fixtures/5,966 markets, BTI 1,486 fixtures/37,079 markets. This is a preservation check, not a new full-provider acceptance.

## Change and native contract

Previously CMD actively fetched only Running/Today. Its adapter rejected native Early `fc=6` and did not admit `DataOdds.asmx/GetAllOdds`; healthy HTTP authority also suppressed DOM enrichment.

The collector now calls the page's own `callWebService` with `GetOddsParams` and private native getters. It uses its own callbacks, so it does not reset the visible table. Unfiltered football scope is proven from the request. Early returns `{t,a,today,f}` without `data`; More returns `[group UUID, primary event ID, FT arrays, FH arrays]`. Raw row column 34 supplies the group UUID, column 51 identifies football, and native non-parlay mode is numeric zero.

Two physical More requests drain the queue through their native callbacks. The existing CMD poller drives roster refresh and queue maintenance. Source/document generations, owner membership, response order and request cutoffs fence publication. Main and Early retain separate membership; shallow refreshes preserve More and newer prices. Unknown arrays remain in native inventory rather than being guessed into comparison semantics.

Full-catalog reconstruction per More response caused measurable backlog on initial deployment. The final implementation caches normalized rows/More parts and coalesces More catalog publication within one second while retaining every incoming response and its original clock. Ordinary main/Early updates flush the final retained state. No additional publication timer or realtime pipeline was introduced; the existing three-second UI publication remains unchanged.

## Verification and handoff

Focused checks passed: API 40 tests; extension native collector 10 tests; CMD observer/request integration 30 tests; contracts 22 tests. API/contracts TypeScript builds and extension build passed; extension typecheck passed. Actual full native bodies also passed the offline collector check. Reviews caught and corrected late Early/Today overwrite and numeric non-parlay handling before final acceptance.

The deployment lease was released against the final stack identity. Temporary export helpers and page/worker export buffers were cleaned. No bets were placed. Do not equate complete native acquisition with complete semantic mapping: unmapped arrays are retained, and only proven binary markets enter comparison. Further maintenance or another provider requires the user's next task.
