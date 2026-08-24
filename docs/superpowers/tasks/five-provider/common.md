# Common Rules for Five End-to-End Provider Workers

## Objective

Five workers run concurrently in the same repository checkout and branch. Each worker owns one outcome, not merely a patch:

| Worker | Account | Bridge lobby | Required result |
| --- | --- | --- | --- |
| SABA | SABA | SABA | realtime `ACTIVE` |
| CMD | CMD | CMD | realtime `ACTIVE` |
| APSPORT | APSPORT | TSPORT | realtime `ACTIVE` |
| IM | IM | IM | realtime `ACTIVE` |
| SBOBET | SBOBET | KSPORT | realtime `ACTIVE` |

BTI is the regression control and must remain `ACTIVE`.

Work only in `F:\0. PROJECT\tool-chenh` on
`feat/six-provider-realtime-feed`. Do not create a linked worktree or another branch.

## Definition of Done

A worker is done only after its built main application proves all of these:

1. `/api/chrome-bridge/sources` reports the exact source with `authorityDisposition: "ACTIVE"`.
2. `/api/catalog/sources` reports the account `sessionState: "ACTIVE"` with no reason.
3. The account catalog is nonempty unless the provider itself proves an explicit authoritative empty generation.
4. Provider-native evidence/cursor advances at least three times during the assigned observation window.
5. A real semantic price/status change is recorded when the provider emits one; unchanged heartbeat/DOM/control ACK never counts.
6. One provider-targeted recovery establishes a strictly newer authoritative baseline without changing another provider's source identity.
7. The report contains the build identity and runtime evidence. Unit tests alone can never satisfy completion.

## Parallel Ownership

- Read `ownership.md` and edit only the provider whitelist plus the provider's report/evidence file.
- Normal browser control is allowed only for the worker's already-open exact provider tab. Never rely on the active tab.
- Do not open DevTools or attach another debugger/CDP owner; the extension observer owns that attachment.
- Do not read or print `.auth`, launch URLs, cookies, tokens, raw provider bodies, or credentials.
- Do not run Git mutations. The root integrator alone stages and commits.
- Focused tests, provider diagnostics, exact provider recovery, build, restart, extension reload, and live sampling are part of the worker outcome, subject to the coordination lease below.

## Shared Deployment Coordination

Provider diagnosis, focused tests, exact-tab inspection, and provider-scoped API diagnostics run concurrently. Enclose each coherent provider source patch in a short edit lease:

```powershell
node scripts/five-provider-coordinator.mjs begin-edit <PROVIDER> <WORKER_ID>
# use apply_patch only on the provider whitelist
node scripts/five-provider-coordinator.mjs end-edit <TOKEN>
```

Five disjoint provider edit leases may coexist. Keep the provider edit lease through the
focused tests plus diff/secret checks for that patch, then release it before any runtime
wait or deployment request. This prevents another worker from building an unverified
shared-checkout snapshot. Build/restart/extension reload alter the shared runtime and
therefore use one short exclusive deployment lease:

```powershell
node scripts/five-provider-coordinator.mjs claim-deploy <PROVIDER> <WORKER_ID>
```

Before starting any guarded step that could consume the remaining lease window, renew
the exact still-live token. A failed renewal means ownership was lost: stop immediately
and do not continue editing, building, reloading, recovering, sampling, staging, or
committing under that token.

```powershell
node scripts/five-provider-coordinator.mjs renew-lease <TOKEN> [TTL_MS]
```

Keep the returned token. While holding the lease:

1. run the required focused tests and typecheck;
2. run `npm.cmd run build` from the shared repository root;
3. set `TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN` to the exact current deployment
   token and run the zero-argument command `node scripts/restart-live-stack.mjs`;
4. reload exactly the unpacked extension whose directory is
   `apps/chrome-extension/dist` in this repository checkout, once, without reloading or
   navigating a provider tab;
5. verify `/api/health` reports the deterministic identity computed from the
   four current `dist` trees and that the loaded unpacked-extension card still
   resolves to this repository checkout;
6. release the lease with `node scripts/five-provider-coordinator.mjs release-deploy <TOKEN>`.

The deployment transaction is exact: `restart-live-stack.mjs` accepts no CLI
arguments, never builds implicitly, and reads the lease token only from the
environment. Renew the lease immediately before build, restart, and extension
reload. Check the exit code of every external command. On any error before a
verified release, run `abort-deploy` in `finally` and clear the environment
variable:

```powershell
$deployment = node scripts/five-provider-coordinator.mjs claim-deploy <PROVIDER> <WORKER_ID> | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'DEPLOYMENT_LEASE_FAILED' }
$released = $false
$env:TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN = $deployment.token
try {
  node scripts/five-provider-coordinator.mjs renew-lease $deployment.token 1800000 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'DEPLOYMENT_LEASE_LOST' }
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'BUILD_FAILED' }
  $expectedBuild = (node --input-type=module -e "import { computeBuildIdentity } from './scripts/five-provider-coordinator.mjs'; console.log(await computeBuildIdentity(process.cwd()));").Trim()
  if ($LASTEXITCODE -ne 0 -or $expectedBuild -notmatch '^sha256:[a-f0-9]{64}$') { throw 'BUILD_IDENTITY_FAILED' }

  node scripts/five-provider-coordinator.mjs renew-lease $deployment.token 1800000 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'DEPLOYMENT_LEASE_LOST' }
  node scripts/restart-live-stack.mjs
  if ($LASTEXITCODE -ne 0) { throw 'MANAGED_RESTART_FAILED' }

  node scripts/five-provider-coordinator.mjs renew-lease $deployment.token 1800000 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'DEPLOYMENT_LEASE_LOST' }
  # Reload exactly this repository checkout's apps/chrome-extension/dist card once, then
  # compare API health and the loaded-extension path with the built artifact.
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/health'
  if ($health.buildIdentity -ne $expectedBuild) { throw 'RUNTIME_BUILD_IDENTITY_MISMATCH' }

  node scripts/five-provider-coordinator.mjs release-deploy $deployment.token | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'DEPLOYMENT_RELEASE_FAILED' }
  $released = $true
} finally {
  if (-not $released) {
    node scripts/five-provider-coordinator.mjs abort-deploy $deployment.token | Out-Null
  }
  Remove-Item Env:TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN -ErrorAction SilentlyContinue
}
```

Do not claim deployment while another worker is sampling acceptance. Never leave a deployment lease held after failure.
The coordinator also rejects deployment while any edit lease is active and rejects new source edits during deployment, so every build reads a stable repository snapshot.
If build/restart/reload fails before a new artifact is verified, run `node scripts/five-provider-coordinator.mjs abort-deploy <TOKEN>`; this releases the lease without falsely replacing the last successful build identity.

Root establishes a validated version-2 managed stack once before issuing the
five worker prompts. `LEGACY_STACK_REQUIRES_ROOT_HANDOFF` is a hard stop for a
worker: do not read, delete, repair, or replace `.auth` or runtime state. The
root-only handoff is the sole legacy transition; subsequent state changes are
performed by the managed scripts under the deployment lease.

Live acceptance leases are provider-scoped and may coexist for all five workers:

```powershell
node scripts/five-provider-coordinator.mjs begin-acceptance <PROVIDER> <WORKER_ID> <EXACT_SOURCE_ID>
node scripts/five-provider-coordinator.mjs end-acceptance <TOKEN>
```

The acceptance lease lasts 15 minutes by default, pins the latest deployed artifact hash and the exact source/tab identity, and rejects same-provider edits. The sampler verifies the same lease and API build identity again at the end. Always call `end-acceptance` in a `finally` path before changing source or requesting deployment. The coordinator rejects deployment while any acceptance lease is active, so one worker cannot invalidate another worker's evidence window.

The sampler automatically performs one normal recovery probe through this exact-source, same-tab route (the command is also available for a bounded diagnostic):

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4310/api/chrome-bridge/request-snapshot' -ContentType 'application/json' -Body '{"sourceId":"chrome:<LOBBY>:<TAB_ID>"}'
```

It sends one `REQUEST_SNAPSHOT` only to the currently attached exact source. Do not substitute global maintenance, active-tab actions, reload, or navigation. A provider launch refresh is reserved for a proven missing/expired/auth-invalid source.

Root protects Git review/staging/commit with a separate exclusive integration lease:

```powershell
node scripts/five-provider-coordinator.mjs claim-integration root-integrator
# review/stage/commit exact files
node scripts/five-provider-coordinator.mjs release-integration <TOKEN>
```

## Worker Loop

1. Inspect the exact provider tab, bridge source, catalog status, and provider-local code.
2. Reproduce the blocking behavior with a failing test or redacted runtime observation.
3. Acquire the provider edit lease, make the smallest provider-owned fix using `apply_patch`, and run its focused tests plus diff/secret checks while the lease remains held.
4. Release the edit lease in a `finally` path before waiting, deployment, or live acceptance.
5. Perform the exact deployment transaction above, verify identity, and release it.
6. Resolve the exact current source ID from the local bridge API, obtain the provider acceptance lease with that ID, and run the assigned sampler while checking authority, catalog state, current API build identity, and the pinned source/tab.
7. End acceptance even when the sampler fails. If runtime fails, return to step 1. Do not stop at a report or `READY_FOR_INTEGRATION` state.
8. Mark `DONE` only when every runtime gate passes. Otherwise keep working; use `BLOCKED` only for a demonstrated external provider/auth failure that code cannot correct.

## Collision and Shared-Code Rule

The common base contains shared observer/contract/data-plane wiring. Workers must not edit shared files concurrently. If runtime proves a shared-base defect, report the exact failing test and symbol to the root integrator immediately; continue all provider-local investigation that does not depend on that symbol. The root fixes and deploys shared code under the same deployment lease.

Every final report must list exact changed files, RED/GREEN evidence, build identity, starting/ending authority states, evidence advances, semantic changes, targeted recovery isolation, and the literal final status `DONE` or `BLOCKED`.
