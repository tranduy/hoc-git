# Five-Provider End-to-End Parallel Runtime Plan

> Use `systematic-debugging`, `test-driven-development`, and
> `verification-before-completion`. Provider tests establish `LOCAL_GREEN`;
> fresh live acceptance on root's combined build establishes `DONE`.

**Goal:** Bring SABA, CMD, APSPORT/TSPORT, IM, and SBOBET/KSPORT to live `DONE`
while BTI remains `ACTIVE`.

**Architecture:** Five workers perform disjoint provider-local TDD in parallel and
wait at `LOCAL_GREEN`. Root freezes the shared root checkout and performs one
combined deployment per round. The same five workers then run concurrent
120-second acceptance against the one published build. Any failure stops the
whole round, triggers a targeted fix, and causes one new combined deployment.

**Repository:** `F:\0. PROJECT\tool-chenh`

**Spec:** `docs/superpowers/specs/2026-08-24-five-provider-parallel-runtime-design.md`

## Global Constraints

- Every tool call uses the exact repository root; never use the linked worktree.
- Root alone owns Git, shared files, build, restart, and extension reload.
- Workers edit only provider whitelists, use no Git mutations, and never deploy.
- No active-tab fallback, DevTools/CDP, provider-tab navigation/reload, or secret
  access is allowed.
- BTI stays `ACTIVE` through every provider acceptance.
- `LOCAL_GREEN` and provisional acceptance pass are nonterminal. Live `DONE` is
  the only successful provider terminal state.

## Role Matrix

| Worker | Account | Bridge lobby | Priority |
| --- | --- | --- | --- |
| SABA | SABA | SABA | 1 |
| CMD | CMD | CMD | 1 |
| APSPORT | APSPORT | TSPORT | 1 |
| IM | IM | IM | 2 |
| SBOBET | SBOBET | KSPORT | 2 |

Priority controls root review order, not permission to race deployment. SABA,
CMD, and APSPORT blockers are reviewed first; IM and SBOBET still perform local
work concurrently.

## Task 1 — Root Preparation

- [ ] Work only in `F:\0. PROJECT\tool-chenh` and confirm all prompt/task/report
  paths resolve from that root.
- [ ] Complete any root-only legacy-to-managed-v2 handoff before worker prompts.
- [ ] Keep five provider pages in five distinct tabs and confirm the loaded
  unpacked extension belongs to the repository-root `dist` path.
- [ ] Issue the five one-line prompts from `proccess.md`.

## Task 2 — Concurrent Provider-Local TDD

Each provider worker completes these steps only inside its whitelist:

- [ ] Read `proccess.md`, `common.md`, `ownership.md`, the spec, this plan, the
  provider task, and the provider report in order.
- [ ] Inspect exact provider state and diagnose the first failing invariant
  without runtime mutation.
- [ ] Acquire the provider edit lease before writing the focused RED test.
- [ ] Run RED, apply the minimal provider-local fix, then run GREEN, all affected
  typechecks, scoped diff check, and redacted secret scan while the lease lives.
- [ ] Record exact evidence and any shared integration request in the provider
  report, set status `LOCAL_GREEN`, and end the edit lease in `finally`.
- [ ] Notify root with `LOCAL_GREEN <PROVIDER>` and wait without editing,
  accepting, recovering, building, restarting, or reloading.

Root handles exact shared integration requests while local work runs. A root
shared edit invalidates affected provider checkpoints; those workers rerun their
local verification and report `LOCAL_GREEN` again.

## Task 3 — Freeze the Combined Tree

- [ ] Confirm all five current reports are `LOCAL_GREEN`.
- [ ] Resolve every required shared integration request.
- [ ] Review provider/shared diffs, focused results, typechecks, and secret scans.
- [ ] Confirm coordinator status has no deployment, edit, or acceptance lease.
- [ ] Choose a unique round ID and announce
  `FREEZE_FOR_COMBINED_DEPLOY <ROUND_ID>`.
- [ ] Recheck the lease-free state immediately before claiming deployment.

The freeze is a root message, not a new coordinator feature. Workers make no
tracked edit until the round fails or is accepted.

## Task 4 — Root-Only Combined Deployment

- [ ] Root claims
  `node scripts/five-provider-coordinator.mjs claim-deploy SABA root-integrator 1800000`.
  The SABA label is coordination-only and grants no provider ownership.
- [ ] Root runs one `npm.cmd run build` for the whole tree.
- [ ] Root computes the aggregate build identity.
- [ ] Root exports the exact token as `TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN` and
  runs zero-argument `node scripts/restart-live-stack.mjs`.
- [ ] Root reloads exactly
  `F:\0. PROJECT\tool-chenh\apps\chrome-extension\dist` once and does not
  reload/navigate provider tabs or another extension.
- [ ] Root verifies `/api/health.buildIdentity`, releases the deployment lease,
  and confirms `lastDeployment` records the combined artifact.
- [ ] Root publishes `ACCEPTANCE_ROUND <ROUND_ID> <BUILD_IDENTITY>`.

No provider worker performs any item in this task. There is no stable barrier and
no per-worker deployment.

## Task 5 — Concurrent Provider Acceptance

Each worker performs the following against the same published round:

- [ ] Resolve the exact current provider source ID.
- [ ] Begin the provider acceptance lease with that source ID.
- [ ] Run the provider's exact sampler for at least 120 seconds without build or
  reload.
- [ ] Prove pinned source/tab/build, `ACTIVE` authority and catalog, current
  baseline, three provider-native evidence advances, semantic movement when
  emitted, exact-source recovery isolation, and BTI `ACTIVE` throughout.
- [ ] End the acceptance lease in `finally`.
- [ ] On success send `ACCEPTANCE_PASS <ROUND_ID> <PROVIDER>` and wait without
  editing the report to `DONE`.

Root performs no build, restart, reload, edit, stage, or commit while acceptance
leases are active.

## Task 6 — Failure Round

On the first failed provider gate:

- [ ] The worker ends its lease and sends
  `ACCEPTANCE_FAIL <ROUND_ID> <PROVIDER> <REDACTED_REASON>`.
- [ ] Root broadcasts `STOP_ACCEPTANCE <ROUND_ID>`.
- [ ] All five workers stop sampling, end leases in `finally`, and discard the
  round for completion purposes.
- [ ] Root waits for zero acceptance/edit leases, then unfreezes only failed
  providers and required root-owned shared work.
- [ ] Failed providers return to `IN_PROGRESS`, add a fresh RED, fix, verify, and
  report `LOCAL_GREEN` again.
- [ ] Root repeats Tasks 3–5 with a new round and one new combined deployment.
- [ ] All five workers rerun acceptance; no old build identity, source binding,
  lease, or evidence is reused.

## Task 7 — Successful Round and Reports

- [ ] Root receives five `ACCEPTANCE_PASS` messages for the same round.
- [ ] Root confirms every acceptance lease has ended and announces
  `ROUND_ACCEPTED <ROUND_ID> <BUILD_IDENTITY>`.
- [ ] Each worker acquires its provider edit lease, updates only its own report to
  `DONE` with exact build/source/tab/baseline/evidence/semantic/recovery/BTI
  proof, and releases the lease.
- [ ] Root verifies all five `DONE` reports refer to the same accepted build.
- [ ] Any final soak is read-only against that build; no extra restart/reload may
  invalidate the accepted identity.
