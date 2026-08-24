# Integrator Task

This file governs the only session allowed to mutate Git history, shared files, build artifacts, runtime processes, the loaded extension, or debugger ownership. Provider workers receive bounded runtime leases only after the integration barrier.

## Exclusive Resources

The integrator exclusively owns:

- Git index, commits, branch state, and final history;
- every file not explicitly assigned to one worker;
- all shared extension and API integration files;
- contracts and generated/build output;
- launcher, API, web, and browser processes;
- Chrome extension reload and loaded-directory synchronization;
- all DevTools/CDP/`chrome.debugger` ownership;
- exact provider tab IDs, runtime lease issuance, and combined live acceptance;
- ignored `.auth` launch data.

Workers never receive raw launch URLs or tokens. The integrator resolves them locally by provider key.

## Collection Protocol

For each Phase A worker report:

1. Confirm its declared starting coordination-base commit.
2. Compare `git diff --name-only` with the exact provider whitelist.
3. Reject any out-of-scope edit and ask the worker to move it into a shared integration request; do not silently absorb it.
4. Read every changed production/test line.
5. Re-run the report's focused RED/GREEN outcome from the current combined worktree.
6. Require the report status to be `READY_FOR_INTEGRATION`, not done.
7. Apply shared wiring with a new integration-level failing test before production edits.
8. Stage only exact reviewed paths and commit only after the relevant gate passes.

Do not stage a common progress file. Each worker has a separate report to avoid write conflicts.

## Shared Integration Priority

### SABA

- Preserve the committed expected-launch/error-page/current-baseline readiness rules.
- Ensure same-tab targeted Socket.IO reconnect leads to a current OPEN/reset/data/done baseline.
- Prove invalid auth/error pages never report ready.

### CMD

- Wire the provider-local recovery state into the observer.
- Resolve the current frame, current loader, default-main-world context, and owning child CDP session.
- Recheck source/document generation after each await.
- Correlate success to a complete bound current-document `fc=1` response, not expression acknowledgement.
- Keep retries single-flight, attempt-capped, deadline-bounded, abortable, and non-navigating.

### APSPORT

- Route TSPORT recovery through observer refresh.
- Capture DOM only as the current expected event-ID set.
- Reconnect only the exact football event socket in the same tab, including discovery after epoch reset.
- Pass fresh stream identity and expected coverage to the adapter.
- Prove candidate DOM alone remains non-authoritative and full WS coverage promotes once.

### IM

- Preserve exact current-document/request/cutoff metadata and atomic two-part commit.
- Do not move odds normalization into shared generic code.

### SBOBET

- Create and propagate one explicit recovery/baseline generation for paired live/today receipts.
- Keep independent receipt sequences for ordering and overlap resolution.
- Preserve current stream/source/document fencing and bounded pending state.

## Static Gates

Run provider-focused suites first, then shared regressions, then full suites. Builds are serialized after tests/typechecks.

Minimum focused API command:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/saba-ws-adapter.test.ts src/chrome-bridge/saba-ws-realtime-regression.test.ts src/chrome-bridge/cmd-http-adapter.test.ts src/chrome-bridge/tsport-ws-adapter.test.ts src/chrome-bridge/im-http-adapter.test.ts src/providers/im/im-football-catalog-source.test.ts src/chrome-bridge/ksport-ws-adapter.test.ts
```

Minimum shared API regression command:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/chrome-catalog-data-plane.test.ts src/chrome-bridge/provider-authority-coordinator.test.ts src/chrome-bridge/provider-feed-registry.test.ts src/chrome-bridge/automatic-source-recovery.test.ts src/chrome-bridge/chrome-bridge-route.test.ts src/chrome-bridge/chrome-bridge-control-plane.test.ts src/server.test.ts
```

Minimum extension command:

```powershell
npm.cmd test --workspace @tool-chenh/chrome-extension
```

Then run package typechecks/builds and `git diff --check`. Scan tracked diffs for token/session/cookie/authorization fields and raw provider payloads before every commit.

## Build Barrier and Runtime Leases

After every provider-local/shared gate passes:

1. Commit all reviewed integration changes.
2. Run the full static matrix, then build contracts/API/extension/web serially.
3. Start/restart the main application from that exact commit.
4. Sync and reload the extension once; verify loaded artifact hash.
5. Create the ignored evidence directory with `New-Item -ItemType Directory -Force .run/five-provider`.
6. Resolve the five exact provider tab IDs and current bridge source IDs without exposing URLs/tokens.
7. Send each worker a lease containing only its account, tab ID, source ID, commit, API process identity, extension artifact identity, allowed local endpoints, sampler command, evidence path, and acceptance window.
8. Keep DevTools/CDP/`chrome.debugger`, global restart, extension reload, and build rights exclusively in the integrator.

## Runtime Gate

Keep the five provider pages in different Chrome tabs. Build/reload once. Provider workers then select only their leased exact tab/source rather than activating tabs; the integrator watches for cross-provider interference.

For each provider record redacted evidence:

- active source ID and epoch hash/opaque identifier;
- authority disposition;
- feed/catalog state;
- baseline generation/provenance;
- starting and ending provider evidence/cursor;
- semantic revision when a real provider delta occurs;
- targeted recovery duration and result;
- whether any unrelated provider source/sequence changed unexpectedly.

Do not accept a worker report that contains only unit tests or bridge sequence. Do not turn an unavailable external login/provider into an empty successful catalog.

Integration order is SABA, CMD, APSPORT, IM, SBOBET. Runtime provider checks may run concurrently after leases are issued; the final order is five worker verdicts, BTI regression, restart/reload reproof, then a ten-minute simultaneous soak.
