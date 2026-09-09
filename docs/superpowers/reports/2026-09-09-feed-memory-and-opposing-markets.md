# Feed memory and opposing market settlement — 2026-09-09

Chrome UI inspection confirmed that the user’s existing Fieldline tab was annotated with 11.4 GB high memory usage. The crash itself has not been reproduced or attributed to a single allocation path at that exact size. There are two independently measured problems: extension forwarding can retain an unbounded backlog outside its bounded bridge queue, and the dashboard transfers and processes a large native inventory on every revision. This report keeps reproduction, frozen-data matching, and live verification separate.

## Memory evidence

- `NetworkObserver` chained asynchronous work per source before admission to the bounded `LocalBridge` queue. A blocked first forward retained all 128 subsequent synthetic frames; changing the source epoch did not release their payloads until that first forward settled. SABA also had a separate raw WebSocket event promise chain.
- Cancellable queues now cap queued estimated payload bytes and entry counts per source/lane. The same epoch-reset reproduction retains only its one active head and settles the other 127 calls immediately. Overflow fences the old stream and requests recovery through the existing source resync path. These queue limits do not bound all extension caches or concurrently materialized HTTP bodies.
- Large HTTP snapshots submit their chunks sequentially at all five producer sites, so a valid baseline larger than the queue budget is delivered completely. Held HTTP/WebSocket receipts are fenced across source, bridge and tab epoch changes. The finite 500 KB snapshot / 300 KB queue regression verifies exact ordered reassembly without overflow.
- SABA durable snapshot writes now keep an active writer plus a latest-generation marker. Eight baselines submitted behind a blocked writer previously produced eight writes; the fixed path writes the active `r0` and latest `r7` only. Pending historical payload copies are not retained.
- The dashboard's `nativeDetail=summary` still transferred every native observation and its labels. In the saved BTI catalog, 37,832 observations contributed 17,321,826 bytes. Replacing this inventory with per-event disposition counts reduces the same response from 41,557,608 to 24,359,225 bytes (41.4%). SHA-256 of canonical events, markets and quotes is unchanged.
- A bounded replay with the current comparison engine over 12 revisions of that same BTI input measured steady heap 384.8 → 289.9 MiB. With a blocked worker and 24 replacements, heap was 252.0 → 157.1 MiB. Both variants retained two display generations, released them on cleanup, and posted only one command while the worker was blocked. This proves allocation reduction, not a six-book browser memory bound.
- A separate public dashboard observation at 14:26–14:29 used a larger, changing live feed. Its dedicated browser reached 3,824.7 MiB private memory and 1,615.7 MiB page JS heap by the last sample. It displayed source metadata timeouts. The finite check stopped at its 3 GiB process budget; no browser crash occurred. This is not a controlled before/after comparison with the frozen BTI replay.

Evidence: `.run/extension-memory-audit-2026-09-09/pending-frames-proof.json`, `bounded-pending-frames-proof.json`, `saba-storage-coalescing-proof.json`, `dashboard-memory-before.json`, and `.run/memory-growth-2026-09-09/web/replay-{summary,counts}-current.json`.

At deployment preparation, the six durable source files total about 407 MB, including a 235 MB BTI file. API startup now restores them sequentially to avoid reading six large JSON buffers/strings concurrently alongside parsed catalogs.

## Opposing markets

The comparison gate rejected integer and quarter Asian lines even after normalization. The stake calculator contained unreachable quarter-settlement code and misclassified team totals as handicaps. The changed comparison path admits supported TOTAL/HANDICAP lines in quarter steps, keeps market/scope/line/settlement and opposing outcome identity checks, and evaluates full wins, full refunds and split settlements. Compound YES/NO threshold propositions do not inherit Asian refund rules.

Worst-case profit includes the refund/split outcome. An integer line that refunds both legs cannot be reported as guaranteed positive. The UI displays these additional outcomes. American odds are also converted in the actual stake calculation. Core execution/preflight support for push-capable markets is unchanged; these new rows are comparisons and estimates.

Same frozen 13:40 input, keeping its original freshness flags:

| Metric | Previous no-push gate | Asian opposing settlement |
| --- | ---: | ---: |
| Fresh-five canonical markets | 54,714 | 54,714 |
| Compared contract groups | 3,389 | 8,489 |
| Unordered cross-book market pairs | 7,423 | 21,655 |
| Positive worst-case estimated plans | 0 | 0 |

Including the originally stale SBO catalog for structural analysis gives 12,271 → 38,420 pairs. Those stale prices are not live opportunities. A group with `n` distinct books contributes `n × (n − 1) / 2` unordered book pairs; opposite assignments are separate betting directions, not additional source markets.

The uncached expanded ranking pass initially measured 4.46 seconds versus 1.44 seconds for the previous gate. A bounded cache now keeps only the latest calculation signature and plan per event/row, capped at 20,000 rows, with no catalog or event references. Quote freshness is evaluated before lookup; price, format, identity, status, provider selection and stake policy changes invalidate the calculation. Verified evidence bypasses it.

Twelve structurally cloned revisions of the same 8,489 rows now rank in 417–522 ms with identical top 20. One changed price took 442 ms and one changed status 436 ms. Cold calculation still takes 4.50 seconds, and changing the stake policy across all rows takes 4.19 seconds. Peak process RSS in this bounded replay was 458 MiB, retained heap 255 MiB. The comparison stage itself was about 1.36 seconds in either mode.

Evidence: `.run/native-normalization-2026-09-09/asian-settlement-audit/same-snapshot-before-after.json` and `ranking-cache-benchmark.json`.

## Remaining coverage

This change does not claim every native market has been normalized. The prior snapshot had 12,447 UNMAPPED observations, and additional EXCLUDED observations whose canonical equivalence was unproven. Neither label means there is necessarily a valid opposing quote at another book. Examples still requiring cross-family support include double chance versus the complementary 1X2 outcome; first-half clean sheet versus opponent first-half team total 0.5 is another concrete candidate. Those relations must preserve native selection identity and settlement meaning.

For QA4273 specifically, 154 native observations include 50 with accepted IM opponent-total counterparts, but all 50 BTI fixtures already contain the equivalent canonical team-total market. Counting these as 50 new semantic pairs would be wrong. The double-chance candidate scan is also only a candidate count until selection order and cross-family normalization are implemented.

The current live inventory is larger than the frozen snapshot, so current source totals must not be used as the denominator for that replay's pair gain.

## Deployment verification

Initial deployment0.2.111 completed at14:40. API/web identity was sha256:db26f63809710ea05bec4487a2e7332b06525bacde4aeb407639f0b892eec2a6, extension sha256:3d8aab11f93f975812ac34bfcb70ecde24e6ddd9670bdaa4045ea3adcc235553, worker0bb0453f-4d25-46f5-a54f-11fe55172dda. Local/public HTTP200 and public WebSocket SNAPSHOT passed. The legacy health endpoint remains OBSERVE/degraded; this is not proof that every source is fresh.

The first120-second public run received59/59 catalog transfers with counts projection, with no page errors, crash, or visible metadata timeout. Dedicated browser private memory peaked at2.83GiB; post-GC page heap was860MiB. Feeds were still filling, so this is not a controlled before/after memory comparison. A subsequent mature-feed run at14:56–14:58 crossed its3GiB budget at90seconds, with page heap1.35GB before GC and910MB after GC, and intermittent source metadata timeouts. It stopped and closed its browser. This failed the finite memory budget and must not be reported as a fully solved browser memory issue.

The user’s existing loopback dashboard was reloaded through its exact visible reload control at14:54; only that dashboard was reloaded. A subsequent UI read showed41,574 cross-book pairs and estimated positive totals2.5(+0.58%),2.25(+0.38%), and2.75(+0.15%). These were time-specific observations, not a closing guarantee or executed bets.

CMD and SABA became stale after the worker reload. A single targeted CMD restore at14:47 returned500 PROVIDER_FEED_BASELINE_TIMEOUT after90seconds. Their envelopes still arrive, ruling out a total forwarding stall. CMD mainly publishes unproven More/DOM records without a renewed atomic main baseline; SABA reports an unconfirmed collector More restore and admission/coverage failures. Their stale prices remain excluded. Unchanged CMD epoch does not prove no reload occurred, because its existing reload path does not explicitly advance that epoch.

A separate offline reproduction proved an unbounded resync recovery lane: a held resync callback blocked later snapshot requests even while ambient replacement traffic continued. It now uses the existing90-second recovery bound, preserves retired-epoch admission fences, and permits retry after failure without an old failure unlocking a newer attempt. Three regressions were RED before the fix;65 related tests and extension typecheck pass. This conditional bug has not been proven as the live CMD/SABA cause.

Follow-up fixes now preserve original immutable market/quote objects when orientation changes no values. Same frozen BTI worker output serialization falls40,243,899→23,548,813bytes (41.5%); browser-output allocation above catalog baseline falls69,219,624→43,076,384bytes (37.8%). Complete output and canonical hashes are unchanged. Sources remain copied for changed line/type/settlement/selection, including swapped teams.

A30.59-second main-renderer CPU profile found Decimal construction/parsing25.2% self time; rankTicketsForEvent10.35s inclusive and topRankedTicketItems5.67s inclusive (overlapping, do not add). The executable plan builder now rejects missing/invalid provider constraints before enumerating all quote pairs. Global top-ticket sorting builds exact Decimal keys once per eligible ticket instead of during every sort comparison, preserving sub-floating-point precision and all tie rules.

The earlier whole-six2GiB clone stress failure intentionally retained both display/fresh graphs for current and previous generations. That is an amplification upper bound, not a faithful proof of the actual page retaining every graph; the actual selected merge replay is documented separately.

The public page was confirmed to serve Vite development modules with React StrictMode. Optional FIELDLINE_WEB_MODE=preview now requires a built dist/index.html and serves compiled assets under the managed supervisor; only the web child uses NODE_ENV=production. Development remains the default when unset. The local deployment configuration selects preview; future web changes require a build and dashboard reload. API proxy and WebSocket handling use the same Vite configuration.

Final follow-up checks:254web tests passed (4existing skips),65bridge/queue tests,26launcher/handoff tests; web and extension typecheck/build pass. Web artifactindex-CbUUPwRB.js/workercomparison.worker-B694T89k.js; extension0.2.112 identitysha256:8625bbaf528b634eae03ed309d52d7cf7cf3f7f22c075ecf85e2ff90f16a64a7. Final managed deployment completed at15:12: instancebf6d81ea-0095-4235-99fa-8f1e68fbef00, APIPID30580/webPID15792, unifiedbuildsha256:47bb96b6835547558f5a980ca0428b5d8a83006ec8d1a8b3004b801050d9fe30. New workerf1d51356-e9b6-4eee-b001-4c7fc1f4d543 observed on all six sources. Public HTML serves the compiled asset and has no Vite development client; local/publicHTTP200 andpublicWebSocketSNAPSHOT pass. Userloopbackdashboard was reloaded again to apply the compiled bundle. Final finite public observation is recorded below.

The corrected actual selected-merge callback replay runs four revisions with retained heap397→534→534→534MiB and peakRSS1192MiB. Sameinput, same20rankedidentities; signal phase1.29–1.53s→0.17–0.24s, global sorting0.24–0.34s→0.06–0.08s. Full-six worker computation plus cloning still takes5.9–6.9seconds in that replay.

### Closing observation

Final public observation 2026-09-09T08:13:02.976Z–2026-09-09T08:16:06.670Z: 7 samples, peak dedicated-browser private memory 1.94 GiB, peak page JS heap 530.6 MiB, post-GC page heap 351.5 MiB. Page crash: false; errors: []; visible metadata errors across samples: []. Completed catalog transfers: 93. Last visible summary: Kèo hai cửa đối ứng: 8.506 nhóm kèo · 18.011 cặp market giữa hai sàn · 21.617 market nguồn. Danh sách hiển thị tối đa 20 vé theo ROI. Positive estimated cards at the final sample: 1. These live catalogs were filling during the run; only the frozen replays provide controlled memory/matching comparisons. This three-minute check is not a long-duration memory guarantee.

Closing pipeline: CMD FRESH (4,213 markets); IM FRESH (12,439 markets); SABA FRESH (778 markets); SBOBET FRESH (7,806 markets); APSPORT FRESH (15,950 markets); BTI FRESH (45,067 markets). Runtime and current source build identities agree: true. Public web/health HTTP status 200/200; WebSocket SNAPSHOT.


Deployment lease released; coordinator deployment is null and edit/acceptance leases are empty. Dedicated verification browsers and the temporary preview server on port4312 are closed. The managed API/web and the user dashboard remain running.

The live BTI inventory expanded after the original frozen audit: a15:02 durable snapshot has about45,000 UNMAPPED observations. Its largest missing families include double chance (QA61/QA145/QA4261), exact score (QA60/QA144/QA3580), goal-count buckets (QA119/QA120), and compound outcomes. This is not solely team-name matching. Some need complementary cross-family predicates, while multi-outcome selections cannot all form an exhaustive two-leg opposition. Current counts are saved in current-bti-unmapped.json and must not replace the denominator of the13:40 replay.
