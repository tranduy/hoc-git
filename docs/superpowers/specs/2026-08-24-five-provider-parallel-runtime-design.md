# Five-Provider Parallel Runtime Recovery Design

Date: 2026-08-24

Status: approved for implementation

Code foundation: `6c440e8` (`fix(extension): recover authenticated SABA launches`)

Scope: SABA, CMD, APSPORT/TSPORT, IM, and SBOBET/KSPORT. BTI is the live regression control.

## Goal

Finish the five non-BTI realtime feeds quickly without allowing parallel agents to corrupt a shared Git index, overwrite shared integration files, race extension builds, or compete for Chrome debugger ownership.

The final result is one application and one branch. Each worker owns one provider end-to-end: diagnosis, RED/GREEN, deployment, exact-tab runtime recovery, and live acceptance. Provider work runs concurrently; only the short shared build/restart/extension-reload transaction is serialized by the repository coordinator. There is no patch-only completion phase.

## Execution Model

All six Codex sessions use the same repository checkout and branch:

```text
F:\0. PROJECT\tool-chenh
feat/six-provider-realtime-feed
```

Roles are fixed for the whole run:

- Integrator: owns Git, shared source files, common-base defects, and the final six-provider gate.
- SABA worker: owns only the SABA API adapter files and its report.
- CMD worker: owns only the CMD HTTP adapter, CMD poller/recovery unit, their tests, and its report.
- APSPORT worker: owns only the TSPORT API adapter/authority assembler, their tests, and its report.
- IM worker: owns only the IM adapter/catalog-source files, their tests, and its report.
- SBOBET worker: owns only the KSPORT adapter/baseline-generation files, their tests, and its report.

An exact worker whitelist is authoritative. Everything not listed in that whitelist belongs to the integrator. Workers do not make opportunistic edits outside their list.

## Browser and Runtime Ownership

The five provider pages should stay open in five distinct Chrome tabs. That isolates page state and lets the integrator address each provider by exact `tabId` rather than relying on whichever tab is active.

Each worker may inspect/control only its already-open exact provider tab and must never fall back to the active tab. DevTools/CDP remain forbidden because a second debugger owner can detach the extension observer. Provider-scoped status, recovery, and acceptance run concurrently.

Each provider-local mutation and its focused verification are enclosed by its short provider edit lease. Five disjoint edit leases may coexist. A still-live lease may be extended only by a token-CAS renewal; an expired or replaced holder cannot renew and must stop immediately. Build, managed-stack restart, and unpacked-extension reload are permitted to a worker only while it holds the exclusive deployment lease from `scripts/five-provider-coordinator.mjs`; deployment is denied until all edit leases are released, and no new edit may start during deployment. Acceptance leases may coexist for all five providers and prevent deployment from interrupting another worker's evidence window. The worker that changes a provider remains responsible until the integrated main application proves that provider realtime.

The deployment transaction is fixed: build with `npm.cmd run build`, place the
exact live deployment token in `TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN`, invoke the
zero-argument `node scripts/restart-live-stack.mjs`, reload exactly
`apps/chrome-extension/dist`, prove the aggregate artifact identity, and only
then release the lease. Root establishes managed state v2 once before workers
start. Legacy-state handoff is root-only; a worker never reads or manually
mutates `.auth` or runtime state.

## Shared-State Safety

Workers must not run Git mutations (`add`, `commit`, `reset`, `restore`, `checkout`, `stash`, `merge`, `rebase`, `clean`). They may run `git status --short` and `git diff -- <their paths>` read-only. Provider writes require the provider edit lease; package builds and shared runtime mutations require the exclusive deployment lease.

Workers must not edit:

- `network-observer.ts`, `background.ts`, contracts, provider authority/coordinator, data plane, registry, route/control, or server wiring;
- `dist`, `.auth`, runtime state, logs, or launch data;
- another provider's files;
- common task documents or another worker's report.

When provider runtime proves a shared-base defect, the worker reports the exact shared file/symbol and failing test immediately. The root fixes shared code under the deployment lease while the worker continues independent provider-local diagnosis. The worker does not stop or claim completion at that handoff.

## Provider Mapping

| User-facing account | Bridge/adapter name | Worker |
| --- | --- | --- |
| SABA | SABA | SABA |
| CMD | CMD | CMD |
| APSPORT | TSPORT | APSPORT |
| IM | IM | IM |
| SBOBET | KSPORT | SBOBET |
| BTI | BTI | Integrator regression control |

Launch URLs and authentication material are stored only in the ignored local `.auth` area. They are never copied into tracked plans, tests, reports, diagnostics, or commits.

## Provider Outcomes

Each worker must leave its adapter in a fail-closed, test-proven state:

- SABA: only a fresh current-stream Socket.IO reset/data/done sequence may establish authority; retired streams cannot re-enter.
- CMD: a current-document complete `fc=1` body establishes authority; page-call acknowledgement alone does not; pre-baseline deltas cannot poison the full-baseline cursor.
- APSPORT: DOM supplies expected identity/coverage only; a fresh TSPORT event socket supplies every authoritative quote and the baseline generation.
- IM: both authenticated GetSE partitions for one cutoff/generation commit atomically; positive Hong Kong odds are normalized without accepting invalid zero/non-finite values.
- SBOBET: current live and today KSPORT partitions pair by an explicit recovery generation, not accidental equality of independent receipt sequences.

## Integration Order

The integrator handles shared requests and live acceptance in this order:

1. SABA
2. CMD
3. APSPORT
4. IM
5. SBOBET
6. BTI regression and six-provider soak

This preserves the requested integration priority while allowing all five adapter workers to work concurrently in both the code phase and the provider-scoped live phase.

## Acceptance Contract

A provider worker may report `DONE` only when all of the following are observed by that worker from the lease-protected built main application whose artifact identity is pinned in its acceptance lease:

- authority disposition is `ACTIVE`;
- catalog/feed state is `LIVE` and externally reported snapshot state is `FRESH`;
- a current authoritative baseline has committed for the current source epoch;
- provider evidence/cursor advances at least three times during observation;
- a real provider price/status delta changes the semantic catalog when the provider sends one;
- generic tab heartbeat, replay, unchanged DOM, and control acknowledgement do not renew authority;
- targeted recovery does not reset another provider;
- BTI remains active throughout;

After all five provider-local `DONE` verdicts, root separately restarts/reloads
the final combined artifact and runs the ten-minute six-provider soak. That soak
is a final integration gate, not a prerequisite that an individual worker must
somehow complete before the other workers finish.

`READY_FOR_INTEGRATION` is not a completion status. The only successful terminal state is `DONE` after the built main application passes the provider's runtime gates.

External provider/authentication unavailability is not converted into success. In that case the source remains fail-closed with an exact reason and the report records the external evidence.
