# SBOBET collection audit — 2026-09-07

Current checkpoint: implementation-v2, assignment05. See [implementation handoff](2026-09-07-sbobet-hidden-markets-handoff.md) for final behavior, verification and remaining work. The original21:10 audit is preserved in the immutable exchange package.

## Actual route and initial defects

KSPORT/SBO maps to SBOBET account `catalog-source:SBOBET:FOOTBALL`. The production Chrome data plane registers KsportWsCatalogAdapter. The similarly named SbobetSocketIoCatalogAdapter is a legacy path and cannot alone fix current KSPORT collection.

The existing NetworkObserver captures verified KSPORT HTTP/SockJS/STOMP traffic, including child contexts, and maintainKsportFeed manages source lifecycle. Baseline source proves Live/Today recovery and native updates, not all future/early roster membership or complete per-event detail subscriptions.

The baseline detail gap was concrete: observed request-template capture and resource fallback excluded eventId requests, while recovery fetched paired Live/Today snapshots. No per-event queue/caller existed. The request partition classifier could misclassify an admitted event response as roster authority. Snapshot admission also depended on binary comparison eligibility, rejecting legitimate native-only/integer-only containers.

Source inspection did not prove an authenticated per-event request format. The separate exact-price helper reuses an observed GET URL; the separate Playwright manager retains only the latest bodies/DOM subset. Neither establishes complete hidden-group membership or continuing updates on the active Chrome route.

## Private implementation now completed

- Structural native snapshot/evidence validation and event-specific partition exclusion.
- Real observed-template request protocol, caller-driven bounded scheduler, document-context lane and observer caller with explicit completeness proof gate.
- Observer ingestion of matched main pairs, cancellation, actual receipt clocks, existing chunking and publication; no additional application cadence.
- Active API detail partition, native receipt ordering, shallow-main preservation, authoritative omission/empty handling, newer-WS precedence, membership renewal and trusted empty/native-only publication.
- Direct/legacy inventory corrections and unknown-group accounting; shared SBOBET/APSPORT normalizer unchanged.
- Bounded passive HTTP/DOM probe and actual observer-to-schema-to-data-plane-to-revision tests.

The current source defaults completeness proof to false. No production proof setter caller exists. Initial template capture expires after24responses/120seconds; authentication/document reacquisition beyond that window and worker-context requests remain unfinished. Counter semantics, full future roster, hidden subscriptions and long-lived retention budgets require real-source evidence. These limits prevent a functional completion claim.

## Real evidence available

Under exact API-only grants, the worker read deployed .39 catalogs at22:04 and22:40, in separate epochs. The22:40 verified source/tab/epoch sample contained112events738markets1476quotes1822native observations. Type14 contributed276 UNMAPPED observations;type15 contributed284, total560. Canonical corner markets existed. These are deployed-catalog observations, not all markets returned by the source or a source denominator.

At22:41:47 a guarded follow-up stopped before catalog read because the fixed runtime boundary changed. No across-build price comparison was retained. Owner subsequently deployed .40 and .41 without worker packages. Old grants are invalid; no passive probe/browser action has run.

The sanitized API sample and transitions live only in the assigned exchange folder. No auth, query/header values, raw source captures or browser session was copied.

## Exact questions still requiring source access

1. What observed request returns the full event native container, and what proves its completeness rather than a filtered subset?
2. Which real partitions enumerate all prematch/early events, including future fixtures?
3. Which hidden groups receive STOMP changes while unopened, what are actual subscriptions and numeric receipt ordering semantics, and are live/today counters comparable?
4. What do native14/15 represent, and is there explicit parent-fixture linkage for derivative pseudo-events?
5. How do valid request templates and subscriptions recover after authentication, document/source change and reconnect?
6. Do unknown/native-only observations correspond to expected published/excluded identities without silent loss?

No answer is inferred from synthetic fixtures or translated labels. Unknown/native-only markets remain explicitly inventoried and excluded from exact comparison until equivalence is proven.

## Next step and ownership

The frozen four-file discovery-v1 package has reviewed passive HTTP/DOM wiring and separate provider/shared patches,369/369 passing regressions, extension typecheck and baseline reconstruction. It can be reviewed/deployed independently of active collection. It intentionally cannot establish complete STOMP subscription coverage.

Prompt-author prepares the integration package; SABA coordinates its deployment and an exact new probe/API window. The SBOBET worker then investigates and implements the source-specific changes and performs acceptance. The running source, deployment, application3second cadence and other providers remain outside this worker's ownership.

No full-source denominator, real unopened hidden-price-change proof, integrated recovery run or24/7 operational evidence exists yet. Status remains WAITING_SOURCE_ACCESS / WAITING_LIVE, not DONE.
