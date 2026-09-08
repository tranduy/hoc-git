# SBOBET: actual hidden-market retrieval established

> Historical worker report, preserved during MAIN consolidation. Its pending integration and deployment status is superseded by [the current SBOBET production report](2026-09-08-sbobet-main-production.md). Use [the current branch handoff](2026-09-08-main-branch-handoff.md) for the next provider task.


2026-09-08, UTC+7. **SOURCE_RETRIEVAL_PROVEN / RAW_MORE_BATCH_CAPTURED / PRODUCTION_MAPPING_PENDING**.

The source returns hidden odds, and standalone Node fetch retrieves them. The worker observed the actual More request, matched newly displayed selection identities to its response, and fetched the observed Today owners twice. Full provider coverage and production ingestion remain incomplete.

## Source mechanism

On source `chrome:KSPORT:2105829034`, Lahti–IFK Mariehamn's More button (`+56`, event `5717357`, league `481`) issued:

```text
GET https://be.sb21.net/api/v2/getEventBetMore?eventId=5717357&oddsStyle=ma&leagueId=481&sportId=1&sportType=1_1
```

The saved HTTP200 response is a flat numeric-group map: **54 priced groups,138 priced rows,187 unique selection IDs**, plus unpriced metadata group0. One More click increased rendered selection IDs from60 to156. All96 newly rendered IDs occur in the saved response. The first DOM capture and saved HTTP body are243877ms apart: identity correspondence is established, simultaneous price equality is not.

More omits main groups1–6, whose46selection IDs remain in the expanded page. It complements the main feed and must not be treated as whole-event replacement authority.

The observed request worked through page fetch with `credentials:'omit'` and through plain Node fetch without explicit headers or copied credentials. One Node request returned HTTP200/9231bytes in806ms. This demonstrates currently observed access, without establishing ongoing availability.

## Actual batches

Both batches used the same34event/league pairs from a native Today roster received at11:40:04.483. Both returned **34HTTP200 responses:28priced responses and6exact `{}` bodies**.

| Execution | Time UTC+7 | Elapsed ms | Priced groups summed across events | Priced rows | Unique selection IDs |
|---|---|---:|---:|---:|---:|
| Browser | 11:50:53.525–11:51:02.892 | 9367 | 1177 | 3176 | 4255 |
| Standalone Node | 11:54:56.075–11:55:05.485 | 9410 | 1138 | 3067 | 4111 |

Empty owners:5728763,5728772,5731844,5731810,5731813,5731812. Empty responses do not establish absence of hidden markets. The roster was14minutes51.592seconds old at Node batch start; it is not an independently exhaustive current Today/Early/provider roster.

Independent audits reconcile all per-owner counters, unique IDs and event prefixes. These are raw source counts, not normalized comparable markets. The aggregate count difference belongs entirely to event5691695. Eight other owners retain counts/IDs but have724changed numeric price tokens across the two responses. This establishes changed source responses, without explaining reduced inventory or establishing continuous push delivery or production revisions.

## Reproducible defects in current code

1. `sbobet-detail-protocol.ts:29` and `sbobet-discovery.ts:43` admit `/api/v2/getEvent`; the observed More route is `/api/v2/getEventBetMore`. The parser expects an event container with fields8/7 instead of a flat group map. The saved More body produces zero records through the existing extractor.
2. `sbobet-direct-catalog.ts:210,243` stops at the fallback event count or overwrites another container with the same event ID. Actual main and corner containers share fixture metadata but have disjoint groups. Isolated extraction yields19goal markets plus4corner markets; wider-roster extraction retains only4corners for this event. Reversing container order changes the result.
3. Wrapping the untouched More map in verified fixture metadata still produces only4existing corner markets/8quotes. Other groups remain unmapped or explicitly excluded. Malay-only admission rejects observed group80prices1.88/1.83. Despite `oddsStyle=ma`, observed price ranges vary: establish per-group interpretation before conversion.

No speculative group union, global odds conversion or full-event authority has been applied. These saved samples make the defects reproducible for the next implementation step.

## Collector and evidence

[Reusable Node collector](../../../scripts/sbobet-fetch-observed-more.mjs), run from this worktree with Node22 and a new output filename:

```powershell
node scripts/sbobet-fetch-observed-more.mjs --input 'F:\0. PROJECT\tool-chenh\.run\parallel-hidden-markets-2026-09-07\sbobet\CORE-TODAY-MORE-BATCH-20260908.json' --output 'F:\0. PROJECT\tool-chenh\.run\parallel-hidden-markets-2026-09-07\sbobet\CORE-NODE-MORE-NEXT.json'
```

The collector retains raw groups:2workers,350ms pacing per worker,6.5second request timeout,60owner cap, redirects disabled and exclusive output creation. The60second scheduling budget is soft and size validation occurs after body receipt. It is a bounded collection tool, not a production refresh loop or roster discovery. The actual Node batch used its original scratch version; the published script retains that logic with readable formatting and passes `node --check`. Independent review accepted it for this scope.

Evidence directory: `F:\0. PROJECT\tool-chenh\.run\parallel-hidden-markets-2026-09-07\sbobet`.

| Artifact | SHA256 |
|---|---|
| CORE-OBSERVED-5717357-20260908.json | `602049c69e7fe9d6189b3f07697379550218a6b3827a75cb42bde7a9f7db4456` |
| CORE-MORE-5717357-20260908.json | `2ce5a74b1e136b93472d59df37be258d05199382d01cddf279325e14ec626316` |
| CORE-TODAY-MORE-BATCH-20260908.json | `a52eb436349657fb60572e3a03cf48cf883cb00550019cc5ef3dfb5cb92eb95e` |
| CORE-NODE-MORE-BATCH-20260908.json | `8625881039f4d7d469698e0431d9d8a00f36c17857c94150d2e4b027a2e7e152` |

Independent audits and extractor results are in this worktree's `.run/sbobet-review/`: `core-more-5717357-audit-20260908.json`, `core-today-more-batch-20260908-audit.json`, `core-node-more-batch-20260908-audit.json`, `verified-real-core-5717357-20260908.json`, and `verified-real-more-5717357-20260908.json`.

## Runtime and remaining acceptance

Observed extension0.2.66, build `sha256:39a48c1d0e72ad888e1d56f2c035a2116fd8a33359192e99afbaa94e987d9b32`. Source epochs changed during investigation; this is not fixed-epoch stability evidence. Main source was already integrated at commit `82df06689d2bc30eeee3c85e211807a117188754`; prior integration does not deploy these newly discovered corrections.

Temporary probe listeners/globals, the worker-created inspect tab and DevTools window were removed. Source tab2105829034 remained loaded on zenandfe.com. No provider reload, extension deployment, shared restart or production source edit occurred in this experiment.

Remaining work: More ingestion, safe main/corner handling, native group accounting/mapping, current roster coverage, and hidden-price changes through the existing revision pipeline. **Full SBOBET coverage, production ingestion of every captured selection and continuous24/7 operation remain unaccepted.**
