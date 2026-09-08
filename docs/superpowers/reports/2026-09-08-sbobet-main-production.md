# SBOBET MAIN production evidence — 2026-09-08

## Deployed implementation

SBOBET is integrated into MAIN `feat/realtime-hardening` and running extension **0.2.73**, implementation commit `30e1bea`. The user's explicit transfer of MAIN/runtime ownership supersedes the historical SABA ownership restriction. Exact stack handoff completed and its coordinator lease was released at 14:49:04 UTC+7.

- Stack build: `sha256:25b27330af742c2f867cd7a5082ff63024e3586482ca089e6a2b3389a9091956`.
- Extension build: `sha256:38034b9a9b467e9d98611f816ab33155cd6233d89f7c938f01822a0473f51304`; actual worker manifest confirmed 0.2.73.
- Source: `chrome:KSPORT:2105829034`; measured epoch: `7e4040b2-4240-4ff4-b7d9-ce9430834d38:3`.

The collector uses the actual `getEventBetMore` response for hidden groups and unfiltered `getEvent?timeRange=early` for All Early. Today plus Early minus Live supplies the prematch roster. Complete More receipts reconcile only their own partition, preserving independent main/Early data and newer receipts. Unknown native groups retain explicit diagnostics; three-way/refund markets are not forced into binary comparison. Existing application publication/revision/WebSocket cadence remains unchanged.

## Complete current source traversal

The passive capture reached **491/491 current prematch owners**: Today 123 + Early 382 − Live 14. More returned native rows for **444** owners and valid empty partitions for **47**. Empty More does not mean the event has no main markets. The saved capture contains 779 HTTP responses, all 200, with zero body, shape, ownership or dropped-capture errors, and 73 actual source selection price changes.

The native roster exactly matches all 491 API prematch IDs. No main/Early canonical markets or native inventory rows were missing. The captured More responses decode to **8,709 supported markets**, including **8,639 additional market IDs** beyond captured main. All other native rows retain their normalization, exclusion or unmapped disposition.

Artifact: `.run/parallel-hidden-markets-2026-09-07/sbobet/production073/coverage-native-1788854777291.json`, 9,317,993 bytes, SHA256 `e8d8f0d96a47cb2433d95fb81483fd50f983272d38dcf58df65acb905b50c9d5`. Original receipt clocks are retained; `snapshotAtMs` is export time, after capture stopped. API comparison: `catalog-aligned-1788854667709.json`; detailed analysis and findings: `COVERAGE-NATIVE-API-1788854777291.json`, `COVERAGE-FINDINGS-1788854777291.json` in the same directory.

At that aligned snapshot, 8,688/8,709 captured More market IDs were present. The 21 missing IDs belonged to event 5728786; its next automatic receipt at 15:08:14 restored 20 of those IDs and omitted the old group-72 market. Event 5722412 retained six older prices despite a later native response. Fourteen other price differences had newer API receipts; there were no semantic mismatches or observations marked NORMALIZED without a published market. These temporal differences are recorded explicitly rather than hidden behind aggregate coverage counts.

Both owners subsequently received automatic More updates. For 5722412, all six prices match the captured native values (3.13, 2.22, 2.24, 1.22, 1.83, 1.7), with a genuine new receipt at 15:17:07.588 and sequence 2911. No targeted source GET was executed; the attempted inspection script never initialized. The prior newer native response had waited approximately 15 minutes before this successful automatic retry. For 5728786, the newer complete-More partition contains 20 of the 21 old IDs; old group-72 market `182773459721000` is absent. Its later raw body was not saved, so a source withdrawal is consistent with the newer authoritative partition but is not independently raw-response verified. Final evidence: `TWO-OWNER-RECOVERY-FINAL-1788855506676.json` and `RETRY-OWNER-1788855506676.json`. No persistence defect was established and no speculative product change was made.

## Automatic ongoing updates and stability

The read-only API/WebSocket window ran **14:50:34–15:05:04 UTC+7**, 870,474 ms. All **58/58 samples were FRESH**, with one epoch, zero sampling errors, zero failing pipeline hops and zero NORMALIZED observations missing their published market.

It recorded **249 actual Decimal More price/status changes across 249 selections and 13 owners**; every corresponding sampled catalog revision was observed on the existing WebSocket. There were also 456 Malay quote changes and 641 revision messages. Publication peaked at **13,710 markets / 27,420 quotes**. Two samples crossed the former 15:04:20 periodic renewal deadline without a source reset.

Evidence: `production073/LIVE-MORE-WINDOW.json` and `LIVE-MORE-SUMMARY.json`. Raw SHA256: `77c482228730895a78749c0e20b83c05f0549cdb6fc0b12ccdbbdc8cbaefa032`.

The native first traversal took approximately 13 minutes after passive capture began, with collection already underway. Per-owner detail refresh is a paced queue; its 30/120-second eligibility and 2–60-second retry backoff are not guaranteed execution deadlines. The application publication setting remains 3 seconds. This window proves actual continuing hidden-price publication and bounded stability, not every-source-price freshness within 3 seconds, rendered UI latency, or 24-hour operation.

## Fixes and verification

- Successful current main request provenance, paced More collection and source-proven binary mappings: `7f9a815`.
- All Early collection, separate Early/More membership, closure clocks and migration handling: `f46e3ce`.
- Early startup from actual worker-origin main receipts: `dc9669e`.
- Preserve healthy HTTP collection during unnecessary socket recovery: `b3e0029`.
- Stop periodic KSPORT page navigation that repeatedly discarded the hidden-market traversal: `30e1bea`. Explicit/failure recovery remains available. Persisted lease timing directly matched the previous 14:24 and 14:44 source resets.

The final lease change reproduced a failing regression, then passed 22 lease tests, four manifest tests, extension typecheck/build and independent review. The earlier integration passed its focused API, observer, protocol, lifecycle and shared-provider regression checks, typechecks and production builds. No application realtime configuration or shared APSPORT normalizer changes were needed for these final fixes. Historical intermediate windows and their failures remain in version history and the separate `production068` through `production072` evidence directories; they are not mixed into current-build acceptance.

## Operational handoff

The managed SBOBET runtime remains active on 0.2.73. Passive listeners, API/WebSocket sampling, local artifact receivers and temporary helper UI have been stopped or removed. No pending deployment lease remains. The current source traversal and automatic updates are proven within the stated evidence windows; this report does not assert every current native row was simultaneously raw-compared, or certify 24/7 operation.
