# SBOBET implementation v2 — 2026-09-07

Status: **IMPLEMENTATION_REVIEW_READY / WAITING_SOURCE_ACCESS / WAITING_LIVE**. The assignment is not complete.

This is the final private implementation snapshot following assignment05. It supersedes the original 21:10 implementation package. The independently deployable discovery-v1 probe remains frozen. All implementation, source investigation and subsequent acceptance remain the SBOBET worker's responsibility. Prompt-author reviews/prepares integration; SABA controls the running checkout and deployment.

- Baseline: `1710d642136138b536e4e2736a6ccb611e55fd97`; tree `6ceccb6655fd3af4e759f99d39c2d9376ecce2d5`.
- Branch/worktree: `worker/sbobet-hidden-20260907`, `F:\0. PROJECT\tool-chenh\.worktrees\parallel-sbobet-20260907`.
- Package: `F:\0. PROJECT\tool-chenh\.run\parallel-hidden-markets-2026-09-07\sbobet\implementation-v2`.
- Exact file/patch hashes and reconstructed candidate tree are in MANIFEST.json. Provider and shared patches are separate, both against the baseline; do not blindly stack on an older implementation/probe patch.

## Resulting behavior

The active KSPORT route now has an event-detail consumer and a concrete observer caller. A verified complete detail can publish through the existing bridge schema, ChromeCatalogDataPlane and CatalogRevisionStore. Main snapshots preserve detail-only markets; newer socket values and withdrawals survive older detail responses. Real source proof is still required before enabling active requests.

### API and native inventory

- Per-native-market receipt clocks and HTTP/WS/detail provenance retain the age of untouched prices.
- Dedicated detail membership handles complete-empty detail, authoritative omission, current live overlap, source retirement and same-ID removal/readmission. A request from the old membership cannot apply after readmission; an ordinary main refresh preserves valid pending work.
- Provider numeric receipt ordering rejects older/replayed changes per stream/partition/event/market while preserving distinct market updates. Its live provider counter semantics and cross-partition event-metadata ordering require source verification before integration.
- Trusted KSPORT empty/native-only materialized catalogs now reach publication for HTTP and accepted WS changes. Other provider gates and the shared SBOBET/APSPORT normalizer are unchanged.
- Direct/observed and legacy Socket.IO paths retain sparse metadata, signed zero handicap, withdrawals and unknown native inventory without inventing equivalence. Native NORMALIZED disposition requires actual normalization. The legacy Socket.IO adapter is not the registered production KSPORT adapter; the existing separate browser manager remains limited to its prior response/DOM behavior.

### Extension caller and discovery

- Structural full-snapshot admission accepts native-only/integer/zero/empty groups and rejects malformed/mixed/error wrappers. Event-specific requests cannot become whole-roster authority.
- Bounded passive HTTP/DOM discovery is wired to existing observer contexts: 24 response reads over the initial 120 seconds per epoch, DOM attempts no more often than every 30 seconds, bounded traversal and allowlisted summaries. No click/replay/subscription/controller operation; no raw query/header/page body in diagnostics; membership always UNPROVEN.
- A real request protocol preserves an actually observed HTTPS GET template and changes only its one numeric event ID. It checks exact event/native containers, rejects redirects, uses existing-context Runtime.evaluate with credentials/no-store/abort, and remains valid after minification.
- One caller-driven lane per source feeds from a matched authoritative Live/Today HTTP pair, subtracts live IDs, and ticks from existing KSPORT maintenance without waiting in the price forwarding queue. It retains physical concurrency through cancellation, with bounded roster, spacing, timeout and backoff.
- Detail emission preserves actual wall/monotonic receipt time and request cutoff, uses existing chunking/request identity, and rechecks context, epoch, membership and cancellation. Document preflight is outside the price queue; synchronous final guards do not yield before forwarding.
- Existing application 3,000 ms publication/fallback, realtime socket/coalescing and shared normalizer remain unchanged.

## Explicit proof gate and remaining implementation

`NetworkObserver.setSbobetDetailCompletenessVerified(source, proof)` accepts only the exact observed URL/document/session/source epoch. The default is false and there is no production caller that establishes this proof. An array-shaped response alone is not completeness evidence. Therefore this package does not yet enable real active collection.

The worker still must:
1. Inspect the real complete detail request and full prematch/early roster; validate group membership against a source denominator. Discovery-v1 currently exposes HTTP/DOM shapes, not a full STOMP subscription/receipt inventory.
2. Prove real endpoint semantics and native receipt counter behavior, then supply the narrowly scoped production proof/activation and any needed subscription corrections. Do not infer the numeric types14/15 or pseudo-event parent linkage.
3. Complete template reacquisition after authentication/document changes outside the initial discovery window. Current detail execution supports verified document contexts only, not worker contexts.
4. Measure retention of long-lived watermarks/tombstones and close operational gaps using actual source evidence.
5. Integrate, run a protected real-source acceptance window, verify continuing unopened hidden-market price/line/status changes through the existing publication path, and exercise recovery within the granted scope.

## Verification

All new source fixtures and endpoint proof are synthetic. Tests demonstrate code behavior, not real source coverage.

| Suites | Latest passing assertions |
| --- | ---: |
| API/KSPORT, legacy/direct/observed, data plane, browser/recovery and unchanged AP normalizer (9 files) | 195 |
| Existing observer plus detail/probe integration (3 files, after final race fix) | 396 |
| Unchanged discovery/protocol/lane/scheduler/native-validator helpers (5 files) | 157 |
| Actual observer envelopes → schema → data plane → revision store (1 file, final observer) | 3 |

751 distinct assertions across 18 files have passing results. This is not a claim of one combined all-green invocation. The 22:55 API run passed all195 assertions but exited1 because the existing browser-manager afterAll close exceeded10s; its isolated23:00:46 rerun passed2/2 and exited0, with no timeout/production change. The other8 API files passed in that run. Final observer396/396 passed22:58; helper files were unchanged from their passing run. Joined pipeline3/3 reran23:00:48 and exited0 after the final observer fix.

API and extension typechecks passed. The cross-application verification file also passed a scoped strict noEmit check. Meaningful regressions reproduced request/receipt races, minified expression failure and the final cancellation microtask gap before fixes. Independent reviews cleared the final observer, pipeline and provider changes. Package generation verifies diff whitespace, exact inventory, alternate-index reconstruction and an unchanged real index.

No worker patch has been applied to the running checkout. No shared build, restart, tab action, credential/session/raw-capture copy or deployment was performed by this worker.

## Real observations and next executable step

Granted API-only reads recorded separate deployed-.39 epochs at22:04 and22:40. The latter verified source `chrome:KSPORT:2105829034`, tab2105829034, epoch `74040073-8f28-489c-b83f-5d6f442faf05:13` before/after the sample:112events,738markets,1476quotes,1822native observations;560 type14/15 observations UNMAPPED. These are catalog counts, not full-source denominators. The next read stopped on a fixed-build mismatch before catalog collection; samples were not pooled.

The owner's22:58 ledger records .41 deployed without worker patches: build `sha256:ac5fd49fc1892b309b174a4b5a582b964840cf1d13b300c1c124e93fa79be6ea`, APIinstance `cba91c44-cb2c-44aa-ac36-b293f95dc646`. Imported adapters/core need the supplemental ledger hashes; the coordinator hash alone does not cover them. Previous .39 grants are invalid. No .41 probe/More/acceptance grant is recorded at this checkpoint.

Concrete pending coordination: review the frozen discovery-v1 package, deploy that probe through the runtime owner, and record a fresh10-minute KSPORT-only probe/API window coordinated with activation (probe collects during first120seconds). Its HANDOFF specifies executable bounds and expected diagnostic. This step does not require enabling the unproven active detail lane. SBOBET then performs source investigation and writes the remaining verified activation/subscription/recovery changes; these are not transferred to SABA.

Full coverage, ongoing hidden-price acceptance, latency distribution, recovery on the integrated build and 24/7 operation remain unproven. A later10–15minute acceptance observation must report its actual duration and cannot establish24hours.
