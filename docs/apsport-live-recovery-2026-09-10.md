# AP live ingress investigation — 2026-09-10

The earlier normalization replay did not prove that the live AP source worked.
At 05:38 local, AP still had zero HTTP responses and WebSocket frames; its
653-event, 18,802-market persisted catalog was stale. The live acceptance gate
is new provider ingress, a fresh accepted catalog, and actual AP comparisons.

## Confirmed failure

The deployed bootstrap diagnostic reported
`APSPORT_BOOTSTRAP_CONTEXT_UNAVAILABLE contexts=0 frames=0 worlds=0 failures[FRAME_TREE:TIMEOUT]`.
Chrome timed out while reading the AP document, before the collector could build
an API request. This is distinct from unsupported market normalization.

Both existing-tab recovery paths required `attachBootstrap` before navigating.
That helper waits for `observer.start`, including renderer-side Runtime commands.
When the existing AP renderer times out, recovery threw before Chrome could
reload or navigate the tab. The API subsequently timed out waiting for a fresh
baseline. A request being delivered did not mean the provider recovered.

The repair permits the requested browser navigation after exactly
`frame-command-timeout`, only for the already-owned AP tab after checking its
identity and unchanged trusted URL. It then requires attachment to the replacement
document. Healthy pages retain observation before navigation; other errors keep
their existing failure behavior. Source freshness and market-matching rules are
unchanged.

Bounded diagnostics distinguish browser target response, renderer response, and
discarded/frozen/loading tab state. They record only enumerated labels and flags,
run at most once per minute per AP tab, and retain no source URLs or credentials.

## Separate startup failure

During the diagnostic deployment, API startup exhausted its 2,048 MiB heap while
reading a 536,558,877-byte persisted BTI catalog with one full `JSON.parse` call.
The loader now reads the existing JSON format one array entry at a time, with
the same schema validation and complete retained catalog.

The all-six-source stress replay with a larger 566,680,857-byte BTI cache passed
under a 2,048 MiB heap in 16.46 seconds, peaking at 1,044.76 MiB RSS. It restored
all 291,411 BTI markets, 590,279 quotes, and 140,100 native observations. Each
provider retained its original clocks and was restored as stale. This proves
startup behavior; it does not establish steady-state memory usage.

The running API was temporarily started with a 4,096 MiB child-process heap to
restore access while fixing the loader. At 06:03 local, the local `.env` heap
setting was aligned to 4,096 MiB because ongoing full ingestion had already
exceeded 2 GiB; a later launch must not silently revert to the smaller budget.

## Deployment mechanism

The API previously captured the extension build identity once at startup.
Subsequent extension-only builds could repeatedly ask the new worker to reload
using that old identity. The sweep now reads the current validated identity on
each interval and skips intervals while the identity file is absent during a
build. A fake-timer regression covers old identity, temporary absence, and new
identity.

## Verification so far

- API startup/deployment tests: 45 passed.
- AP bootstrap/probe and source recovery tests: 119 passed; after the final
  ownership-while-waiting guard, all 17 renderer recovery tests passed again.
- Existing network observer suite plus AP diagnostics: 408 passed.
- Extension recovery build deployed at 05:44:54 local:
  `sha256:8a91664d02e5c86378185166b6ffe5a2641c61e7ed3c1be81a20968875110be6`.
- At 05:45:41 local, AP had 1,241 HTTP responses and 5,966 WebSocket frames,
  no failing pipeline hop, and a fresh accepted catalog with 599 events,
  52,557 markets, and 73,299 quotes. No second manual restore was issued.
- The immutable fresh capture contains 53,592 native rows: 52,557 normalized,
  1,035 unmapped, no excluded rows, and no duplicate native identities. Remaining
  rows are 1,012 other-score outcomes, 22 time-window contracts, and one next
  player goalscorer contract. Every remaining row is retained, not discarded.
- Full fresh capture SHA256:
  `6bebf1eae1b9fa51e2f74fdf774befffdd92b39b8218c96b726886daa961490d`.
- At 06:00:14 local, the browser with only AP and BTI selected displayed 7,308
  groups, 6,862 native market pairs, and 12,619 participating source markets.
- At 06:09:49 local, the released UI again had only AP and BTI selected and
  displayed 7,494 groups, 7,164 native market pairs, and 13,181 source markets.
  AP showed 602 events, 52,587 normalized markets, and 1,064 remaining unmapped
  rows. Both books were fresh. There were no browser JavaScript errors.
  These are structural pair counts, not confirmed profitable tickets.
- At 06:12:47 local, with only AP and BTI checked, the UI displayed 13,519
  groups, 15,331 native market pairs and 26,790 participating source markets.
  AP had 54,147 normalized and 1,041 unmapped rows. BTI detail ingestion was
  still enlarging its catalog, so this increase is not a code-only benchmark.

## Exact prices and remaining limits

The AP in-page price reader compared native offer IDs directly with newly
normalized `tsport:<group>:<offer>` IDs. It now checks the full native group and
offer identity as well as event, selection, type, scope and line. Event, group
and offer pause flags also refuse the price read.

One real read-only check of Palmeiras SP versus LDU Quito, Under 2.5, found AP's
current price **0.65 Malay** through `IN_PAGE_FETCH`; the retained price was 0.77.
The result correctly reported `ODDS_CHANGED`. Its CMD counterpart failed exact
selection identity, so this does not prove a verified two-book profit or stake
limit. The request used zero stake and placed no bet.

The released browser later sent an actual AP/BTI Torino–Roma first-half total 1
check. Both exact reads returned `MATCH` via `IN_PAGE_FETCH`: AP Under -0.93 Malay,
BTI Over 0.91 Malay. The recorded check is `a81bdf89-ae54-4bd5-bdc2-4ae1b3f62fe3`.
The client captured it at 23:30:54.479 UTC; the API started its display journal
append at 23:31:08.126 and only started both price reads at 23:31:37.640.
That first append blocked reads for 29.514 seconds, repeating the earlier
Palmeiras delay. AP/BTI reads then completed in 7.703/7.732 seconds. The browser's
45-second timeout occurred before those results; it was a real HTTP wait this
time, unlike the earlier client validation rejection. Matching prices do not
establish positive ROI or usable stake limits.

The follow-up read-only route enqueues display evidence before launching both
provider reads, preserves display/completion write order in the background, and
waits at most 100 ms for storage acknowledgements after prices finish. `persisted`
is true only when both writes have succeeded; pending or failed writes return
false. The UI says "Chưa xác nhận lưu kết quả" for that state. Neither fresh-price
deadlines nor identity checks changed. Tests with stalled first and final writes
prove that both reads and the response complete while storage remains pending;
later writes retain their order. All 14 route/journal and 41 web client/table
tests passed after this repair. Timing evidence:
`.run/ap-context-2026-09-10/torino-audit-latency-evidence.json`.

Post-deployment browser acceptance at 06:36:40 local succeeded on Angers–Troyes,
full-time total 2.25: AP Over 0.9 Malay and BTI Under 0.93 Malay both returned
`MATCH` via `IN_PAGE_FETCH`, HTTP 200, no browser JavaScript errors. AP read took
4,772 ms; BTI 3,879 ms; capture to completed result was 10,282 ms, including time
before the handler. `persisted:false` correctly reported that storage was still
unacknowledged while the usable read-only comparison returned. Check ID:
`64e199be-0ef5-4b3f-9b9e-c966cb63d183`; evidence:
`.run/ap-context-2026-09-10/price-latency-ui.json`.

That sample had only AP and BTI selected: 7,064 groups, 6,372 native market pairs,
12,051 participating source markets. AP showed 51,989 normalized and 1,045
unmapped rows. BTI was still hydrating after the managed restart. These counts
must not be treated as a same-input comparison with the earlier 15,331-pair
sample. Neither this price check nor a structural pair count establishes profit.

Fresh AP source status is still different from fresh individual prices. In the
05:45 immutable capture, 72,607 of 73,299 quotes were already 12.3 seconds older
than the latest catalog receipt. AP's roster cadence is 60 seconds; the detail
walk is serial, whereas live and prematch quote deadlines remain 5 and 15 seconds.
No deadline or quote clock was relaxed to create ROI. Current partial WebSocket
diagnostic counters alone do not prove which missing-identity deltas may safely
be merged. Continuous price renewal remains a separate unresolved issue.

The UI now preserves explicitly unchecked books across recovery. The new button
for read-only checks on waiting tickets retains native quote identities and
keeps ROI, executable stake plans and open-ticket controls unavailable. However,
the 06:12 browser acceptance check exposed a client validation failure before
any HTTP request was sent. A timeout waiting for that nonexistent response is
not API latency. The earlier Palmeiras journal delay is a separate observation.

## BTI processing and final deployment

Two redundant BTI operations were removed without dropping data: resolving the
same event identities twice, and regrouping every unchanged immutable event part
on each detail update. The latter benchmark used all 291,411 markets, 590,279
quotes and 140,100 native observations: mean merge time 1,358 ms to 114.5 ms, with
identical output hashes in all three rounds. This measures merge cost, not total
application latency.

A further cold HTTP load duplicates that startup work: the catalog route awaits
its own durable restore before looking for an already published revision. The
server has already restored and published all six sources. For a published BTI
revision, that route order reads the large file again and retains another graph
in `recentReads`. The repair checks for the published revision first while
preserving the existing refresh scheduling and the disk fallback when absent.

The price audit also has a separate reproducible schema mismatch. BTI's retained
detail receipt translator preserves age across a collector clock restart and
can produce negative relative monotonic values; existing adapter fixtures expect
`-10080` and `-180`. Provider quotes accept these values, but displayed audit
legs rejected them. Only the displayed audit clock is changed to finite signed;
direct price checks keep their nonnegative clock and freshness guards. This
proves a real boundary defect, but the exact rejected field in the earlier
Atlanta browser request was not captured. Safe client diagnostics now identify
validation paths without including values, credentials or native identifiers.

These two follow-up repairs passed 43 current-workspace API catalog/preflight/
journal tests, 90 contract schema tests, 41 web client/table tests, and the 71-test
BTI adapter suite. Contracts, API and web typechecks passed. Commits are
`a6784c4` (published catalog before restore) and `ae8c32c` (signed audit receipts).

Current managed API instance: `0f81a0dc-855a-47be-8a3e-33cfbfcd83cc`, runtime build
`sha256:08b337dd16710a8e2f7c90f0e9d5d340d54e36b3171f5badc8851013801bd2cf`.
Final extension identity:
`sha256:c4b68e359100889ecb6fe992de4eb16bfa2e2cbd16ac94e4ef6706eb1fbb269c`.
Web asset: `index-DD7xKG6J.js`; worker: `comparison.worker-DKv8vAOC.js`.
The API reads the current extension identity dynamically; extension/web-only
deployment does not change the API's startup build identity.

Final relevant checks: 72 BTI adapter/collector tests, 45 API startup/deployment
tests, 418 extension observer/refresh tests, and 154 web tests passed (four
existing web skips). API, extension and web typechecks passed. Parent reran the
58 ranking/table tests after the waiting-price UI change. Local HTML returns
200 with the new web asset. After the storage latency fix, the public IPv4 GET
also returned the HTML referencing `index-DD7xKG6J.js`. IM/SABA/SBO were not all healthy in the final UI sample;
this report does not claim that all six feeds are fixed.

Ignored local evidence is under `.run/ap-context-2026-09-10/`,
`.run/ap-ingress-2026-09-10/`, and
`.run/ap-remaining-2026-09-10/durable-stress-proof.json`.
