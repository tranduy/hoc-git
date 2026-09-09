# CPU investigation and runtime fixes — 2026-09-09

User reported 50–80% CPU and lag across Chrome/the machine, and requested a fix.
Existing provider maintenance work, IM suspension and recovery limits remain in place.

## Measured causes

- A 20-second OS sample on this 16-logical-CPU machine attributed 10.31% of total
  machine CPU to the API. Chrome also consumed substantial CPU; unrelated apps
  were present, so total-machine changes cannot be attributed solely to this patch.
- A 10.426-second live API sampling profile attributed 3.009 seconds to catalog
  revision hashing, 1.624 seconds to catalog merging, and 1.171 seconds to GC.
  BTI's catalog contained approximately 77 MB across its record arrays.
- Instrumenting live publication for 15 seconds found approximately 98% identity
  reuse in BTI market/quote/native records, and approximately 98% native-record
  reuse in AP/SBO. AP/SBO normalized quote objects are usually rebuilt.
- The web comparison worker received complete native-market observations even
  though neither its engine nor comparison code reads them. On the same live BTI
  snapshot, structured cloning the command took 656–842 ms for 77.25 MB. Omitting
  this unused worker input reduced it to 245–282 ms and 35.06 MB. These are Node
  structured-clone measurements, not a Chrome renderer CPU profile.
- Windows UI Automation confirmed the current Fieldline Chrome window carried
  Chrome's high-memory warning (3.4 GB). Process 23832 subsequently reached about
  5 GB working set. Source inspection then found that the 60-second movement
  history retained entire historical `ComparisonEvent`/catalog graphs. A bounded
  reproduction with 20 generations retained 20 old graphs before the fix and
  zero afterward, while preserving all 20 movement records.

Only numeric timing/count/process metadata was saved. Catalog data stayed in
memory; no raw provider payloads, prices, credentials, or CPU profiles were saved.

## Changes

`CatalogRevisionHasher` caches SHA-256 record digests using weak object keys:
BTI records and native observations for all providers. Other providers' freshly
rebuilt normalized records keep grouped serialization. Published records are
readonly, and inspected adapters replace changed records. Weak caches do not
retain retired catalog graphs or an extra full JSON copy.

Revision format 2 intentionally changes opaque ETags once after deployment.
Ordering, field contents, stale transitions, observation-clock exclusions, and
AP receipt/sequence confirmations retain their previous semantics. FRESH and
STALE revisions of the same immutable catalog share the traversal.

On the same BTI snapshot with 1% of records replaced between publications, the
old implementation took 250–274 ms warm versus 46–60 ms for the new implementation.
The initial cold pass is more expensive (678 ms versus 248 ms), with roughly
19–20 MiB additional retained heap for this BTI catalog. AP warm samples fell
from 75–82 ms to 46–59 ms; SBO results were noisier (68–74 ms versus 47–72 ms).
Do not interpret this benchmark as the reduction in whole-machine CPU.

`ComparisonWorkerClient` projects catalogs immediately before every RESET/UPSERT
message, including coalesced updates and worker restart. It omits only native
observations from the worker message. Its original catalog map remains complete,
and result hydration uses those originals for UI details and native coverage.
No provider data, market, quote, freshness check, or recovery cadence was removed.

`PriceMovementTracker` now retains only `event.key` in historical movement records.
The only consumer uses that identity for ranking; previous/current odds, magnitude,
timestamps, ordering and expiration remain unchanged. This releases old full
catalog graphs independently of the 60-second movement retention window.

## Validation and deployment

- API: 159 relevant tests passed, including revision/store/routes, realtime app
  delivery, coverage, source and part-merge behavior; API typecheck/build passed.
- Web: 109 distinct relevant tests passed, with 4 existing skips; worker
  client/engine, movement tracker, ranking and catalog page; typecheck/build passed.
- New regression tests verify deterministic cold/warm revisions, immutable
  reuse across reordered arrays, replacement quotes/native selections, expiry
  without another traversal, compact worker messages and full result hydration.
- The existing manual-recovery remount test had a timing-sensitive caption
  assertion. Source discovery can resume persisted verification before the
  assertion, changing the caption while the button remains disabled. The test
  now accepts either valid caption and additionally checks the persisted future
  manual deadline; it still checks that a click makes no extra recovery request.
  Production recovery behavior was not changed.
- Independent reviews approved all three production changes.
- API-only intermediate deployment: `461d9c2f36e247224619ccd5ddbde8eb695f7550a8c80b78838965f8762f1a19`.
  Its finite 3-minute observer saw all five providers publishing revisions,
  with no websocket errors/disconnects; full rosters were still rebuilding.
- Final combined API/web build: `da6a0ed3e8b8f9a8ccdd1afdfa8ab5e159f98574b59a3912da917c5ab217ad1b`.
  Managed instance: `4d4f619d-2c7f-4666-91aa-cd5411f75899`.
  Deployed at `1788897998147` (2026-09-09 03:06:38 UTC+7).
  Extension remains 0.2.96, unchanged; source tabs were not manually reloaded.
  The existing Fieldline dashboard was reloaded using Chrome's own Reload button
  after verifying its current address matched the known dashboard host. This
  replaces old tracker instances that React Fast Refresh could otherwise retain.

Artifacts: `.run/cpu-root-cause-2026-09-09/`, including `profile-result.json`,
`publication-reference-reuse.json`, `revision-comparison.json`,
`worker-copy-comparison.json`, `retention-comparison.json`, and deployment/finite
observation summaries. Intermediate deployment evidence has separate `api-` and
`worker-` artifact names.
Sampling instrumentation was removed and the temporary Node inspector closed.

The final 30-second OS sample averaged 34.04% total-machine CPU, 22.56% Chrome
and 8.13% API. This does **not** demonstrate a whole-machine CPU reduction versus
the initial sample: Chrome's workload and the set of active processes changed,
and the provider rosters were rebuilding after restart. The API and clone
benchmarks above compare the same input, and the history regression reproduces
the eliminated retention path. Chrome can still hold several GB during active
catalog processing; eliminating all high-memory/CPU peaks is not established.

A separate Node profile of the current comparison engine with five real
catalogs (roughly 108,000 quotes) measured full rebuilds at 845–1,260 ms. Remaining
work includes fixture/competition matching, ticket validation, indexes and GC;
`comparison-profile.json` records the sanitized aggregate. This confirms that
the worker still has substantial legitimate work; no cadence or matching rules
were weakened merely to lower CPU.

Final finite observation is summarized in `acceptance.json`. Measurements in
the first ten minutes after a stack restart are startup observations, not provider
stability acceptance. No 24-hour stability or elimination of all Chrome lag is claimed.
