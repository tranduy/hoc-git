# Five-Provider Parallel Runtime Recovery Design

Date: 2026-08-24

Status: approved for implementation

Code foundation: `6c440e8` (`fix(extension): recover authenticated SABA launches`)

Scope: SABA, CMD, APSPORT/TSPORT, IM, and SBOBET/KSPORT. BTI is the live regression control.

## Goal

Finish the five non-BTI realtime feeds quickly without allowing parallel agents to corrupt a shared Git index, overwrite shared integration files, race extension builds, or compete for Chrome debugger ownership.

The final result is still one application and one branch. Parallelism is used only for provider-local adapter logic and focused tests. Shared bridge wiring, builds, runtime processes, extension reload, browser control, integration, and commits remain serialized through one integrator.

## Execution Model

All six Codex sessions use the same linked worktree and branch:

```text
F:\0. PROJECT\tool-chenh\.worktrees\six-provider-realtime-feed
feat/six-provider-realtime-feed
```

Roles are fixed for the whole run:

- Integrator: owns Git, all shared files, build artifacts, API/web processes, extension reload, Chrome tabs, debugger attachment, and live acceptance.
- SABA worker: owns only the SABA API adapter files and its report.
- CMD worker: owns only the CMD HTTP adapter, CMD poller/recovery unit, their tests, and its report.
- APSPORT worker: owns only the TSPORT API adapter/authority assembler, their tests, and its report.
- IM worker: owns only the IM adapter/catalog-source files, their tests, and its report.
- SBOBET worker: owns only the KSPORT adapter/baseline-generation files, their tests, and its report.

An exact worker whitelist is authoritative. Everything not listed in that whitelist belongs to the integrator. Workers do not make opportunistic edits outside their list.

## Why Browser Ownership Is Serialized

The five provider pages should stay open in five distinct Chrome tabs. That isolates page state and lets the integrator address each provider by exact `tabId` rather than relying on whichever tab is active.

The five worker sessions must not open DevTools, call `chrome.debugger`, navigate, reload, close, focus, or otherwise automate those tabs. Chrome permits only one debugger owner for a target; a second DevTools/debugger attachment can detach the extension observer and invalidate the realtime evidence being tested.

Only the integrator may:

- inspect or drive the provider pages;
- attach/detach CDP or DevTools;
- reload the unpacked extension;
- copy a build into the Chrome-loaded extension directory;
- restart API/web/launcher processes;
- trigger live source recovery;
- perform runtime acceptance.

Workers use deterministic fixtures and focused Vitest suites only.

## Shared-State Safety

Workers must not run Git mutations (`add`, `commit`, `reset`, `restore`, `checkout`, `stash`, `merge`, `rebase`, `clean`) or package builds. They may run `git status --short` and `git diff -- <their paths>` read-only.

Workers must not edit:

- `network-observer.ts`, `background.ts`, contracts, provider authority/coordinator, data plane, registry, route/control, or server wiring;
- `dist`, `.auth`, runtime state, logs, or launch data;
- another provider's files;
- common task documents or another worker's report.

When provider-local work requires shared wiring, the worker records one exact integration request in its report: required input/output, the shared file and symbol, the failing test that the integrator should add, and the invariant that must remain true. The integrator applies the shared edit once after collecting all reports.

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

This preserves the requested priority while allowing all five adapter workers to work concurrently.

## Acceptance Contract

A provider is accepted only when all of the following are observed from the built main application:

- authority disposition is `ACTIVE`;
- catalog/feed state is `LIVE` and externally reported snapshot state is `FRESH`;
- a current authoritative baseline has committed for the current source epoch;
- provider evidence/cursor advances at least three times during observation;
- a real provider price/status delta changes the semantic catalog when the provider sends one;
- generic tab heartbeat, replay, unchanged DOM, and control acknowledgement do not renew authority;
- targeted recovery does not reset another provider;
- API restart and one extension reload recover through new authoritative evidence;
- BTI remains active throughout;
- the final six-provider soak runs for ten minutes with no false-live source.

External provider/authentication unavailability is not converted into success. In that case the source remains fail-closed with an exact reason and the report records the external evidence.
