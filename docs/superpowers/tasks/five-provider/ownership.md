# Five-Provider File Ownership

This file is read-only for workers. The whitelist is exact: a worker may modify only the listed files. A listed optional new file may be created only at that exact path.

## SABA Worker

- `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- `apps/api/src/chrome-bridge/saba-ws-adapter.test.ts`
- `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`
- `docs/superpowers/reports/five-provider/saba.md`
- ignored runtime output `.run/five-provider/saba-runtime-evidence.json`

## CMD Worker

- `apps/api/src/chrome-bridge/cmd-http-adapter.ts`
- `apps/api/src/chrome-bridge/cmd-http-adapter.test.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`
- optional new `apps/chrome-extension/src/cmd-recovery-state.ts`
- optional new `apps/chrome-extension/src/cmd-recovery-state.test.ts`
- `docs/superpowers/reports/five-provider/cmd.md`
- ignored runtime output `.run/five-provider/cmd-runtime-evidence.json`

## APSPORT Worker

- `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts`
- optional new `apps/api/src/chrome-bridge/tsport-authority-assembler.ts`
- optional new `apps/api/src/chrome-bridge/tsport-authority-assembler.test.ts`
- `docs/superpowers/reports/five-provider/apsport.md`
- ignored runtime output `.run/five-provider/apsport-runtime-evidence.json`

## IM Worker

- `apps/api/src/chrome-bridge/im-http-adapter.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- `apps/api/src/providers/im/im-football-catalog-source.ts`
- `apps/api/src/providers/im/im-football-catalog-source.test.ts`
- `docs/superpowers/reports/five-provider/im.md`
- ignored runtime output `.run/five-provider/im-runtime-evidence.json`

## SBOBET Worker

- `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- optional new `apps/api/src/chrome-bridge/ksport-baseline-generation.ts`
- optional new `apps/api/src/chrome-bridge/ksport-baseline-generation.test.ts`
- `docs/superpowers/reports/five-provider/sbobet.md`
- ignored runtime output `.run/five-provider/sbobet-runtime-evidence.json`

## Integrator Ownership

The integrator owns every repository file not explicitly whitelisted above. In particular, workers must not modify:

- `apps/chrome-extension/src/network-observer.ts`
- `apps/chrome-extension/src/network-observer.test.ts`
- `apps/chrome-extension/src/background.ts`
- `apps/chrome-extension/src/source-tab-recovery.ts`
- `apps/chrome-extension/src/source-tab-recovery.test.ts`
- `apps/chrome-extension/src/tab-registry.ts`
- `apps/chrome-extension/src/tab-registry.test.ts`
- `apps/chrome-extension/src/lobby-signatures.ts`
- `apps/chrome-extension/src/lobby-signatures.test.ts`
- `packages/contracts/**`
- provider authority/coordinator, registry, data-plane, route/control, recovery actor, and server files;
- all `dist/**`, `.auth/**`, scripts, runtime state, logs, and process files except the five exact leased `.run/five-provider/*-runtime-evidence.json` outputs listed above;
- all planning/task/common documents;
- Git index and history;
- DevTools/debugger, extension reload, global process lifecycle, builds, and cross-provider runtime state.

## Phase B Runtime Leases

After the integration barrier, runtime ownership is also non-overlapping:

| Worker | Leased account | Leased bridge source |
| --- | --- | --- |
| SABA | SABA | SABA |
| CMD | CMD | CMD |
| APSPORT | APSPORT | TSPORT |
| IM | IM | IM |
| SBOBET | SBOBET | KSPORT |

The integrator supplies the exact current `tabId`, source ID, commit, API process identity, and extension artifact identity in a follow-up message. A lease permits read-only status/catalog sampling and provider-targeted recovery for that account. It does not permit build/restart/reload, DevTools/CDP, active-tab actions, another account, or raw launch/auth access.

## Collision Rule

The ownership sets do not overlap. If implementation appears to require a file outside the worker whitelist, the worker must leave a precise shared integration request in its own report. The worker must not widen its own scope.
