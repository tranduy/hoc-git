# Root Integrator Task

## Outcome

Root coordinates one shared checkout at `F:\0. PROJECT\tool-chenh`. Five
provider workers perform provider-local diagnosis and TDD concurrently, then
wait at `LOCAL_GREEN`. Root alone freezes edits and deploys the combined tree
once per acceptance round. All five workers then run their own live acceptance
concurrently against that one build.

| Worker | Account | Bridge lobby | Priority |
| --- | --- | --- | --- |
| SABA | SABA | SABA | 1 |
| CMD | CMD | CMD | 1 |
| APSPORT | APSPORT | TSPORT | 1 |
| IM | IM | IM | 2 |
| SBOBET | SBOBET | KSPORT | 2 |

BTI must remain `ACTIVE` throughout every acceptance window.

## Root-Only Ownership

Root alone owns shared source, Git history, combined build output, managed-stack
restart, and unpacked-extension reload. Provider workers own only the exact
whitelists in `ownership.md`, their provider-local TDD, their report/evidence,
and exact-provider live acceptance.

`ownership.md` remains authoritative for whitelists, provider/source mapping,
and its current root-only deployment rule. Workers never build, restart, reload,
or claim a deployment lease.

Every root tool call must use `F:\0. PROJECT\tool-chenh` as its exact `workdir`.
Never use the linked `.worktrees\six-provider-realtime-feed` checkout.

## Before Provider Work

Root completes any one-time legacy-to-managed-v2 handoff before the five worker
prompts start. Only root may inspect or mutate the minimum `.auth` state required
for that handoff. Workers never read, delete, repair, or replace `.auth` state.

Root also verifies that the five provider pages remain in five distinct tabs and
that the loaded unpacked extension belongs to this repository root. Root must not
open DevTools or take debugger/CDP ownership from the extension observer.

## Phase A — Parallel Local Green

Workers edit concurrently under disjoint provider edit leases. Root continuously
reviews provider diffs and resolves exact shared integration requests. Any root
shared-source edit that can affect a provider invalidates that provider's earlier
`LOCAL_GREEN`; root tells the affected worker to rerun its focused checks.

Root may use the existing integration lease for root-only Git review/staging and
commits, but that lease is not a deployment mechanism. Root must never call
`restart-live-stack.mjs` under `claim-integration`.

Before freezing a round, root must prove:

1. all five reports say `LOCAL_GREEN` for the current shared tree;
2. required shared integration requests are resolved;
3. coordinator status has no deployment, edit, or acceptance lease;
4. provider/shared focused tests and affected workspace typechecks are green;
5. scoped diffs are reviewed and contain no credentials, raw payloads, launch
   material, or unauthorized files.

## Phase B — Freeze and One Combined Deployment

Root chooses a unique round ID and announces:

```text
FREEZE_FOR_COMBINED_DEPLOY <ROUND_ID>
```

Workers must make no tracked edits from this point until root either cancels the
round after a failure or accepts it. Root rechecks coordinator status, then alone
claims the existing deployment lease exactly once, inside the transaction below,
with the fixed label `SABA root-integrator`.

The `SABA` argument is coordination-only. It is the existing coordinator's fixed
serialization label for the combined artifact; it does not grant provider-file
ownership and does not mean the deployment contains only SABA. Do not add a new
coordinator command or stable-barrier feature.

Root first performs the non-browser portion of exactly one combined deployment
transaction per round. This command claims the lease; do not run a separate
`claim-deploy` command before it:

```powershell
$deployment = node scripts/five-provider-coordinator.mjs claim-deploy SABA root-integrator 1800000 | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'COMBINED_DEPLOYMENT_LEASE_FAILED' }
$env:TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN = $deployment.token
try {
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'COMBINED_BUILD_FAILED' }

  $expectedBuild = (node --input-type=module -e "import { computeBuildIdentity } from './scripts/five-provider-coordinator.mjs'; console.log(await computeBuildIdentity(process.cwd()));").Trim()
  if ($LASTEXITCODE -ne 0 -or $expectedBuild -notmatch '^sha256:[a-f0-9]{64}$') {
    throw 'BUILD_IDENTITY_FAILED'
  }

  node scripts/restart-live-stack.mjs
  if ($LASTEXITCODE -ne 0) { throw 'MANAGED_RESTART_FAILED' }
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/health'
  if ($health.buildIdentity -ne $expectedBuild) {
    throw 'RUNTIME_BUILD_IDENTITY_MISMATCH'
  }
} catch {
  node scripts/five-provider-coordinator.mjs abort-deploy $deployment.token | Out-Null
  Remove-Item Env:TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN -ErrorAction SilentlyContinue
  throw
}
```

The deployment lease remains active after that command. Root must now use browser
control to open a separate `chrome://extensions` window, reload only the unpacked
extension whose resolved path is exactly
`F:\0. PROJECT\tool-chenh\apps\chrome-extension\dist`, and close that control
window without navigating/reloading a provider tab or touching another extension
card. Root then inspects the loaded card/path again and proves a post-reload bridge
connection from the five existing provider tabs. If browser control is unavailable,
the path differs, or the post-reload bridge proof is missing, root runs
`abort-deploy <TOKEN>`, clears `TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN`, reports the
blocker, and must not publish an acceptance round.

There is deliberately no automatic release in the build/restart block. Only after
the browser action and both proofs succeed may root run, using the exact token from
the single claim above:

```powershell
node scripts/five-provider-coordinator.mjs release-deploy <TOKEN> | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'COMBINED_DEPLOYMENT_RELEASE_FAILED' }
Remove-Item Env:TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN -ErrorAction SilentlyContinue
```

Only after that release records `lastDeployment` does root publish:

```text
ACCEPTANCE_ROUND <ROUND_ID> <EXPECTED_BUILD_IDENTITY>
```

There is no stable-runtime-barrier command. The freeze, successful root-only
transaction, recorded `lastDeployment`, and published identity are the handoff.

## Phase C — Concurrent Acceptance

All five workers begin provider-scoped acceptance leases and run their own
120-second samplers concurrently. Root does not build, restart, reload, stage,
commit, or edit while any acceptance is active.

Root tracks only messages for the current round:

- `ACCEPTANCE_PASS <ROUND_ID> <PROVIDER>`
- `ACCEPTANCE_FAIL <ROUND_ID> <PROVIDER> <REDACTED_REASON>`

A pass is provisional until all five providers pass the same round. Workers end
their acceptance leases in `finally` and do not write `DONE` yet.

## Failure Loop

On the first failure, root immediately announces:

```text
STOP_ACCEPTANCE <ROUND_ID>
```

Root waits until all acceptance leases have ended. Evidence and pass messages
from that round are invalid for completion. Root then permits only the failed
provider worker(s), plus any required root-owned shared fix, to edit. Failed
providers return to `IN_PROGRESS`, complete fresh RED/GREEN, and report
`LOCAL_GREEN`. Any root shared edit invalidates affected local-green checkpoints.

When the tree is fully green and lease-free again, root creates a new round,
freezes edits, and performs one new combined deployment. All five workers must
rerun acceptance on the new build; no prior build identity, source binding, or
evidence may be reused.

## Successful Round

After all five providers pass the same round and coordinator status shows no
acceptance lease, root announces:

```text
ROUND_ACCEPTED <ROUND_ID> <BUILD_IDENTITY>
```

Workers may then acquire their provider edit leases solely to write final `DONE`
reports with exact build/source/tab/baseline/evidence/recovery/BTI proof. Root
reviews those reports and may run a read-only simultaneous soak against the same
accepted build. Root must not add an extra restart/reload that would invalidate
the workers' accepted identity.

No unit-test report, `LOCAL_GREEN`, `READY_FOR_INTEGRATION`, or provisional pass
is a successful terminal state. Successful completion is five live `DONE`
reports for the same accepted build.
