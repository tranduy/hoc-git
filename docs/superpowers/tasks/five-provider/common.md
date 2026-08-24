# Common Rules for Five End-to-End Provider Workers

## Objective

Five workers run concurrently in the same repository checkout. Each worker owns
one provider from diagnosis through live proof, but workers never deploy the
shared application.

| Worker | Account | Bridge lobby | Priority | Successful terminal result |
| --- | --- | --- | --- | --- |
| SABA | SABA | SABA | 1 | live `DONE` |
| CMD | CMD | CMD | 1 | live `DONE` |
| APSPORT | APSPORT | TSPORT | 1 | live `DONE` |
| IM | IM | IM | 2 | live `DONE` |
| SBOBET | SBOBET | KSPORT | 2 | live `DONE` |

BTI is the regression control and must remain `ACTIVE` throughout every live
acceptance window.

Work only in:

```text
F:\0. PROJECT\tool-chenh
```

Every shell/tool invocation must set that exact directory as its `workdir`. If a
tool has no `workdir` field, assert the root in the same invocation before doing
anything else:

```powershell
$repoRoot = 'F:\0. PROJECT\tool-chenh'
Set-Location -LiteralPath $repoRoot
if ((Get-Location).Path -ne $repoRoot) { throw 'WRONG_REPOSITORY_ROOT' }
```

Never use `.worktrees\six-provider-realtime-feed` for this run.

## Binding Documents and Precedence

Before any edit, read all of these from the repository root:

1. `proccess.md` — the full common contract and the worker's exact role;
2. this file;
3. `docs/superpowers/tasks/five-provider/ownership.md`;
4. `docs/superpowers/specs/2026-08-24-five-provider-parallel-runtime-design.md`;
5. `docs/superpowers/plans/2026-08-24-five-provider-parallel-runtime.md`;
6. the worker's task file;
7. the worker's current report.

This file and `proccess.md` are authoritative for coordination. `ownership.md`
remains authoritative for file whitelists, provider/source mapping, and its
current root-only deployment rule. Provider workers must never build, restart,
reload, or claim a deployment lease.
Historical report text is evidence only and never overrides the current contract.

## Definition of Done

`LOCAL_GREEN` is a required checkpoint, not success. A worker may write `DONE`
only after that worker has run a fresh 120-second acceptance against the exact
combined build published by root and proved all of the following:

1. the pinned bridge source has `authorityDisposition: "ACTIVE"`;
2. the account source has `sessionState: "ACTIVE"`, no reason, and a nonempty
   authoritative catalog;
3. the authoritative baseline belongs to the current source epoch;
4. provider-native cursor/evidence advances at least three times;
5. a semantic price/status change is recorded when the provider emits one;
   heartbeat, ACK, replay, or unchanged DOM is not semantic evidence;
6. one targeted recovery of the exact source establishes a strictly newer
   authoritative baseline without replacing another provider source;
7. BTI remains `ACTIVE` for the entire window;
8. the source/tab and `/api/health.buildIdentity` remain equal to the acceptance
   binding and root's published round identity.

Unit tests, `LOCAL_GREEN`, a report, or `READY_FOR_INTEGRATION` can never replace
live acceptance. `BLOCKED` is legal only for a demonstrated external auth/provider
failure after provider-local code and same-tab recovery alternatives are exhausted.

## File and Safety Rules

- Edit only files that the role and `ownership.md` list in that provider's exact
  whitelist; do not edit `ownership.md` itself.
- Use `apply_patch` for tracked file edits.
- Do not run Git mutations: `add`, `commit`, `reset`, `restore`, `checkout`,
  `stash`, `merge`, `rebase`, `clean`, or `push`. Root alone owns Git history.
- Do not edit shared observer/background/contracts/data-plane/server files,
  another provider's files, planning documents, generated `dist`, `.auth`, or
  coordinator state. The runtime sampler may write only the role's ignored
  evidence file.
- Do not read, print, or persist tokens, cookies, signed URLs, raw provider
  bodies, credentials, or launch material.
- Do not use active-tab fallback. Control only the exact provider source/tab.
- Do not open DevTools or claim debugger/CDP ownership.
- Do not reload, navigate, focus, or replace a provider tab. Targeted recovery
  must use the exact-source API defined by the task.

## Provider Edit Lease

Each coherent provider-local TDD patch, including its RED test, must be enclosed
by the existing provider edit lease:

```powershell
node scripts/five-provider-coordinator.mjs begin-edit <PROVIDER> <WORKER_ID>
# add and run RED, apply the minimal fix, run GREEN/typecheck/diff/secret checks,
# and update the provider report
node scripts/five-provider-coordinator.mjs end-edit <TOKEN>
```

Acquire the lease before every file mutation and release it in `finally`. Five
different provider edit leases may coexist. Workers never call `claim-deploy`,
`release-deploy`, `abort-deploy`, or `restart-live-stack.mjs` and never build or
reload the extension.

## Phase A — Concurrent Provider-Local TDD

Each worker performs this phase for only its provider:

1. inspect the exact provider source/tab and provider-local code without runtime
   mutation;
2. use systematic debugging to identify the first failing invariant;
3. acquire the provider edit lease before adding or changing any test;
4. add and run focused RED, implement the smallest whitelisted fix, then run
   focused GREEN, every affected workspace typecheck, scoped `git diff --check`,
   and a redacted secret scan while the lease remains live;
5. record exact changed files, RED/GREEN evidence, checks, and any exact shared
   integration request in the provider report;
6. set the report status to `LOCAL_GREEN`, end the edit lease in `finally`, tell
   root `LOCAL_GREEN <PROVIDER>`, and wait.

`LOCAL_GREEN` means provider-local work is green on the current shared tree. If
root changes a shared seam that affects the provider, root invalidates that
checkpoint and the worker must rerun the affected local checks before reporting
`LOCAL_GREEN` again. During the wait, the worker must not edit, build, restart,
reload, recover, begin acceptance, or claim deployment.

## Phase B — Root Freeze and One Combined Deployment

Root waits until all five workers are `LOCAL_GREEN`, all provider edit leases are
absent, all required shared integration work is complete, and the shared tree is
reviewed. Root then announces `FREEZE_FOR_COMBINED_DEPLOY <ROUND_ID>`. From that
announcement until the round ends, workers make no tracked edits.

Root alone claims the existing exclusive deployment lease with the fixed command:

```powershell
node scripts/five-provider-coordinator.mjs claim-deploy SABA root-integrator 1800000
```

`SABA` is only the coordinator's fixed serialization label for the combined
five-provider deployment. It does not give root SABA provider ownership and does
not make this a SABA-only build. Root alone runs one complete build, managed-stack
restart, and exact unpacked-extension reload for the round, verifies health, then
releases the lease so `lastDeployment` pins that combined artifact. Workers do
none of those actions.

Root publishes exactly one message for the successful round:

```text
ACCEPTANCE_ROUND <ROUND_ID> <BUILD_IDENTITY>
```

There is no stable-runtime-barrier command or prerequisite. The freeze message,
the root-only combined deployment, the recorded `lastDeployment`, and the
published build identity are the complete handoff.

## Phase C — Concurrent 120-Second Live Acceptance

After root publishes the round, all five workers concurrently:

1. resolve the exact current source ID for their own provider from the local API;
2. begin the existing acceptance lease with that exact source ID;
3. run only their assigned 120-second sampler, without building or reloading;
4. verify every Definition of Done gate and the published build identity;
5. always end the acceptance lease in `finally`;
6. report `ACCEPTANCE_PASS <ROUND_ID> <PROVIDER>` to root on success, but do not
   edit the report to `DONE` until root declares the whole round accepted.

Acceptance commands are provider-specific and listed in each task. Acceptance
leases may coexist. Workers may inspect only their exact provider tab/source and
may issue only the sampler's exact-source targeted recovery.

## Round Failure and Retry

Any acceptance failure invalidates the round for all five providers:

1. the failing worker ends its acceptance lease and immediately reports
   `ACCEPTANCE_FAIL <ROUND_ID> <PROVIDER> <REDACTED_REASON>`;
2. root announces `STOP_ACCEPTANCE <ROUND_ID>`;
3. every worker stops its sampler, ends its acceptance lease in `finally`, and
   discards that round's verdict/evidence for completion purposes;
4. root waits until no acceptance or edit lease remains, then allows only the
   failed provider worker(s) and any required root-owned shared fix to edit;
5. failed providers return to `IN_PROGRESS`, perform provider-local RED/GREEN,
   and report `LOCAL_GREEN` again;
6. root waits for a fully green, edit-free tree, freezes a new round, and performs
   one new combined deployment;
7. all five workers rerun fresh 120-second acceptance on the new build. No worker
   may reuse a prior build identity, source binding, lease, or evidence.

When all five workers report acceptance pass for the same round and every
acceptance lease has ended, root announces
`ROUND_ACCEPTED <ROUND_ID> <BUILD_IDENTITY>`. Only then may each worker acquire a new provider edit lease,
write its report as `DONE` with the exact live evidence, release the lease, and
finish.

## Shared Defects

If a worker proves that a required fix is outside its whitelist, it records the
exact file, symbol, failing test, and redacted runtime symptom in its own report
and tells root. Root owns that shared fix. The worker continues independent
provider-local work but cannot claim `LOCAL_GREEN` for an invariant that still
depends on an unresolved shared defect.
