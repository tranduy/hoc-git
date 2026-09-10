# Dashboard memory investigation, 2026-09-10

The user's screenshot shows Chrome's **Out of Memory** renderer failure. Short startup checks did not establish sustained memory safety with a fully loaded catalog.

## Changes

1. Network decoding previously retained a complete response body and raw JSON graph before schema validation cloned its arrays. A BTI fixture alone is 386,803,114 bytes. The reader now decodes catalog arrays one record at a time and immediately applies the same strict row schemas. It retains validated records without constructing the full response string or a second raw array. Envelope, provider/category and aggregate checks remain mandatory; failures cancel the reader and never cache a partial revision. The synchronous parser remains non-mutating by default; an explicit owned-input option replaces raw rows individually.
2. Intermediate worker validation previously indexed and serialized every old/new native offer, including hundreds of thousands absent from the projection. It now indexes only referenced native IDs, shares indexes for identical snapshots and validates price terms lazily once per referenced market. Roster, phase, duplicate identity, sequence and receipt guards remain. A 5,000-unprojected-market regression reduces unnecessary term reads from 20,000 to zero.
3. Identical display/fresh projections now share their hydrated output instead of producing two UI graphs.
4. Display fallback now identifies actual candidates before building prior-catalog indexes and replacement arrays. No candidates returns the original catalog. Quote grouping appends rather than repeatedly copying arrays. The regression measures two prior-array reads reduced to zero; ordering, withdrawal and player/line/domain guards remain covered.

No canonical source market is filtered out to reduce memory. Odds, normalization semantics and freshness thresholds are unchanged.

## Fixed-data reproduction

Runners and artifacts: `.run/browser-oom-2026-09-10/`. `stress.mjs` serves fixed real catalogs through a local streaming HTTP server, loads all **394,321 markets / 819,809 quotes** from six providers, resets the real comparison worker and submits 12 AP revisions while previous work is in flight. Both variants use the same 1,536 MiB V8 budget in a separate headless Chrome. The before variant reads source from commit `abaa68c`. This constrained test does not describe production Chrome's heap limit.

| Count-mode run | Result | Sampled main-thread heap peak |
| --- | --- | --- |
| Before: `before-counts-stress.json` | First output at about 28 seconds, then unresponsive through the 150-second deadline; final page probe unavailable | 1,355,130,294 bytes |
| Final: `after-stream-stress.json` | Finished at 74 seconds, generation 13 current; 22,654 comparison rows across 2,882 event groups; no recorded page error/crash | 1,334,819,501 bytes |

All 394,321 markets and 819,809 quotes were retained in the final run. Intermediate outputs occurred at generations 1, 7 and 11 before generation 13. Coalescing revisions is existing worker behavior.

This demonstrates completion under the reproduced load, not a large measured peak reduction or a guarantee against future OOMs. Main-thread samples exclude worker memory and can miss allocation peaks. Allocation-only intermediate versions produced both a completed run and stalled runs; streaming was added because one stalled while reading BTI's entire JSON body. Those artifacts remain available. Host memory pressure and live source populations vary.

## Verification and deployment

**180 tests passed** across incremental JSON parsing, strict API/schema/cache behavior, worker client/engine/receipts/player binding and UI intermediate results. The 44 streaming tests cover chunk boundaries, UTF-8, nested/escaped values, malformed/truncated JSON, duplicate/prototype keys, cancellation and 5,000 retained records. Web typecheck and production build passed after the test stream's buffer type was corrected.

Final web assets were published at **10:47:06 local**: `index-CfQtDz9Z.js`, worker `comparison.worker-BA5tMEYg.js`. Hashed assets were copied before replacing `index.html`, and previous assets were retained. Local HTTP and `https://live.babiesbo.uk/football-live` both serve the new main asset; public HTTP status was 200.

The user reported Claude is editing IM. Only `apps/web` and this report belong to this change. IM/extension edits and the other agent's reports are not modified or staged. API instance `862475c7-a851-4992-ad26-bc83eee8ddc8` and recorded PID 20392 were unchanged across publication. No API/provider/extension restart; the integration lease was released.

The final deployed live observation (`final-profile.json`) lasted 122 seconds, recorded no page error/crash and continued receiving worker outputs through generation 29. Sampled main-thread heap peaked at 851 MiB, fell to 349 MiB after collection and ended at 462 MiB. The UI ended with 18,192 cross-provider market pairs and 114,341 BTI markets. This shorter live run is smaller than the fixed-data test and does not establish overnight stability. IM remained unavailable during this sample; it is being handled separately by Claude.
