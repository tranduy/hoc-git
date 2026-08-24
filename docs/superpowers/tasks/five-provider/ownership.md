# Five-Provider File Ownership

This file is read-only for workers. The whitelist is exact: a worker may modify only the listed files. A listed optional new file may be created only at that exact path.

## SABA Worker

- `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- `apps/api/src/chrome-bridge/saba-ws-adapter.test.ts`
- `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`
- `docs/superpowers/reports/five-provider/saba.md`

## CMD Worker

- `apps/api/src/chrome-bridge/cmd-http-adapter.ts`
- `apps/api/src/chrome-bridge/cmd-http-adapter.test.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`
- optional new `apps/chrome-extension/src/cmd-recovery-state.ts`
- optional new `apps/chrome-extension/src/cmd-recovery-state.test.ts`
- `docs/superpowers/reports/five-provider/cmd.md`

## APSPORT Worker

- `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts`
- optional new `apps/api/src/chrome-bridge/tsport-authority-assembler.ts`
- optional new `apps/api/src/chrome-bridge/tsport-authority-assembler.test.ts`
- `docs/superpowers/reports/five-provider/apsport.md`

## IM Worker

- `apps/api/src/chrome-bridge/im-http-adapter.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- `apps/api/src/providers/im/im-football-catalog-source.ts`
- `apps/api/src/providers/im/im-football-catalog-source.test.ts`
- `docs/superpowers/reports/five-provider/im.md`

## SBOBET Worker

- `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- optional new `apps/api/src/chrome-bridge/ksport-baseline-generation.ts`
- optional new `apps/api/src/chrome-bridge/ksport-baseline-generation.test.ts`
- `docs/superpowers/reports/five-provider/sbobet.md`

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
- all `dist/**`, `.auth/**`, scripts, runtime state, logs, and process files;
- all planning/task/common documents;
- Git index and history;
- Chrome tabs, DevTools/debugger, extension reload, and live runtime.

## Collision Rule

The ownership sets do not overlap. If implementation appears to require a file outside the worker whitelist, the worker must leave a precise shared integration request in its own report. The worker must not widen its own scope.
