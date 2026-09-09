# Repeated provider feed outages — 2026-09-09

The provider page being open did not guarantee that its catalog could cross the
extension, body assembler and feed controller. Several independent recovery
owners also continued old work after a source had recovered. This investigation
reproduced and repaired the following causes without extending quote freshness.

- A valid current-generation semantic delta refreshed evidence but left the
  controller STALLED/SOFT/HARD; registry publication was consequently stale.
  It now releases recovery only when all current live prerequisites pass. The
  original complete-baseline clock is unchanged; real stream faults still require
  a new complete baseline. Eight regressions failed before the fix; all 49 related
  controller/registry cases passed afterward.
- Dashboard AUTO requests previously promoted delayed snapshot/discovery errors
  into manual maintenance. Two dashboards could request restore after ACTIVE.
  AUTO now only asks for an in-page snapshot; explicit manual reload remains.
  Discovery prefers ACTIVE authority. Backend recovery also rechecks an actual
  readable feed at asynchronous mutation boundaries, including final launch
  delivery. Baseline-specific confirmation was not weakened.
- A faulted multipart epoch was retried forever in the same epoch. The API now
  sends an exact-source fatal rejection before ACK; the extension uses its
  existing source-only resync. Regressions verify ordering, retired-epoch rejection
  and preservation of healthy sources. First-fault diagnostics retain bounded
  reason, age, fragment and byte counts, with no response bodies or request IDs.
- Native multipart forwarding awaited a Chrome document command for every
  fragment. In a deterministic 6.6 MB/61-fragment reproduction, individually valid
  600 ms commands aged the final fragment to 36.6 s, beyond the unchanged 30 s
  receipt limit. First/final document proof reduced it to 1.2 s. Every fragment
  retains source/tab/bridge guards, and a body cannot complete without final
  document proof. Thirty relevant tests and independent review passed.
- CMD used the transport epoch as its native collector generation. Transport
  resync therefore discarded completed More work although the document had not
  changed. The collector now follows physical document/context ownership while
  forwarding still obeys bridge epochs. Original More receipt clocks survive;
  physical replacement still invalidates them. Sixty-three focused tests passed.
- IM cooldown telemetry counted a historical failure on every evaluation: a
  reproduction produced 77 reports from six physical requests. It now exposes
  original failure time, phase and current gate state, bounded to 32 scalar rows.
  Source/epoch replacement cannot relabel an old diagnostic round.
- Later live diagnostics showed IM NETWORK timeouts while a 15-minute gate was
  active; an offline regression proved the shared-breaker policy path. Proved local signing/network/body
  failures now wait at least 30 s; actual/unclassified provider failures keep a
  separate escalation count. Hard auth blocks and Retry-After remain protected.
  Existing persisted deadlines are preserved because prior refusal history cannot
  safely be reconstructed. The initial network timeout itself is not explained
  by this policy correction. Successful cadence remains 20 s; timeout remains 15 s.

All referenced tests are focused counts, not a sum of disjoint cases or a claim
that every repository test was run. Changes received independent reviews and
relevant API/extension/web builds and type checks.

## Runtime evidence and limits

Evidence directory: `.run/cmd-sbo-live-fix-2026-09-09/`.

Deployment #7 (`872881fd…`, API 36552) recorded a six-minute window: CMD, IM,
BTI, AP and SABA 72/72 healthy samples; SBO 71/72 after bootstrap. Later IM failed
again with late envelopes and a faulted assembler. This window was insufficient
to claim stability. The first managed handoff hit readiness timeout; a managed
launch with captured logs recovered local service. No permanent tunnel change.

Deployment #8 (`8c292974…`, API 25716) added the multipart and CMD cache corrections.
The 14:19:43–14:29:38 UTC capture contains 120 samples: SBO/BTI/AP/SABA 120 healthy,
CMD 119, IM 97. There were no captured assembler faults. A later IM observation
showed a genuine NETWORK timeout gate with no HTTP data for about 29 minutes,
proving the separate policy issue above. Do not report this deployment as all-six
stable. CMD transport epochs still changed, so the cache correction does not claim
that all resync triggers disappeared.

Web bundle is `index-BOS06VZq.js`; matching worker remains
`comparison.worker-S9JXkttS.js`. A read-only browser check of #7 completed without
page errors/crash but showed real source dropouts and one catalog GET timeout;
its 2.3 GB peak private allocation does not prove the historical 11.4 GB issue is
resolved. No new matching-profit or complete-normalization claim is made here.

Public route was verified as `live.babiesbo.uk` → `127.0.0.1:4311`; public HTML,
API health and the exact new JS bundle returned 200. One intermittent connection
reset was reproduced; the connected tunnel and unchanged request-error counter
did not establish its cause. No route or connector restart was justified.

Deployment #9 (`f99f53af…`, API 23940, extension `bf39c76f…`) is deployed and its
lease released. After the preserved legacy deadline expired, IM made two new
attempts that timed out at NETWORK. Its retry became about 30 seconds as intended,
but it still had no baseline. CMD/SBO/BTI/SABA/AP were LIVE with evidence ages
about 1–4 seconds in the same read. IM IS NOT FIXED. Comparison with committed
collector code found identical signing/token/header/body regions, so a signing
regression is not established. Missing evidence is the failed native request's
response-header/resource timing and browser error; existing API diagnostics do
not retain it and in-app browser bootstrap failed. No further speculative patch
or provider restart was performed. Root diagnostic observers have finished.

Final deployment/runtime outcome is recorded in `docs/SESSION-STATE.md` and
`deployment-result.json`. No bets or financial operations were performed.
