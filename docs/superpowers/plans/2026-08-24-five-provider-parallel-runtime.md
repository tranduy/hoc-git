# Five-Provider End-to-End Parallel Runtime Plan

> Use `systematic-debugging`, `test-driven-development`, and
> `verification-before-completion`. Tests are a checkpoint; realtime acceptance
> from the currently deployed main application is the outcome.

## Goal

Run five Codex workers concurrently in one worktree and branch. Each owns one
already-open provider tab from diagnosis through live proof:

| Worker | Account | Bridge lobby | Priority |
| --- | --- | --- | --- |
| SABA | SABA | SABA | 1 |
| CMD | CMD | CMD | 1 |
| APSPORT | APSPORT | TSPORT | 1 |
| IM | IM | IM | 2 |
| SBOBET | SBOBET | KSPORT | 2 |

BTI stays `ACTIVE` as the regression control. Total elapsed time should approach
the slowest worker, not the sum of the five tasks.

## Architecture

- All sessions use `F:\0. PROJECT\tool-chenh\.worktrees\six-provider-realtime-feed`
  on `feat/six-provider-realtime-feed`.
- Provider workers own disjoint provider files and their exact provider runtime.
- Root owns shared source, Git index/history, cross-provider review, and the final
  combined six-provider gate.
- Five provider edit leases may coexist. Build/restart/reload uses one exclusive
  deployment lease over a stable source tree. Acceptance leases pin exact
  source/tab and deployed artifact identity and may coexist for all providers.
- A worker loops diagnosis -> RED -> fix -> GREEN -> deploy -> exact-tab recovery
  -> live sampler until `DONE`; it never pauses at a patch/report handoff.

The binding documents are:

- `docs/superpowers/specs/2026-08-24-five-provider-parallel-runtime-design.md`
- `docs/superpowers/tasks/five-provider/common.md`
- `docs/superpowers/tasks/five-provider/ownership.md`
- one provider task file and one provider report.

## Base Preparation — Root

- [ ] Close shared authority/recovery defects with focused RED/GREEN tests.
- [ ] Make the coordinator fail closed and pin acceptance to exact source ID and
  deterministic deployed artifact hash.
- [ ] Make runtime samplers require `ACTIVE` authority, `ACTIVE` catalog,
  nonempty authoritative catalog, provider evidence advances, exact source/tab,
  current build identity, and no unrelated source replacement.
- [ ] Run provider/shared regressions, complete typechecks, complete builds,
  diff-check, and credential/raw-payload scan.
- [ ] Under the root integration lease, commit one coherent base.
- [ ] Under a deployment lease, build, restart the managed stack from that commit,
  reload that worktree's unpacked extension, and publish the artifact identity.
- [ ] If the pre-base runtime still uses legacy stack state, root alone validates
  the exact process tree and performs the one-time handoff to managed state v2;
  provider workers never inspect or mutate `.auth` state.
- [ ] Resolve the five exact current source IDs before starting acceptance.

## Five Concurrent Provider Loops

Each worker performs all items below for only its provider:

- [ ] Confirm the exact provider tab/source and acquire a short provider edit lease.
- [ ] Reproduce the first failing invariant with a focused test or redacted runtime
  observation; implement the smallest bounded fix.
- [ ] Run provider focused tests, typecheck, diff-check, and secret scan while the
  provider edit lease is still held; release it in `finally` only after those checks.
- [ ] Renew the exact live lease token before any guarded step that could exhaust its
  remaining TTL; if renewal fails, stop immediately instead of continuing as owner.
- [ ] Acquire the exclusive deployment lease, build/restart/reload the main app,
  verify `/api/health` reports the resulting artifact identity, then release it.
  Use the exact transaction in `common.md`: `npm.cmd run build`, export the live
  lease as `TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN`, run zero-argument
  `node scripts/restart-live-stack.mjs`, and reload only this worktree's
  `apps/chrome-extension/dist` card.
- [ ] Acquire an acceptance lease with the exact source ID and run the provider
  sampler. Always end acceptance before returning to source edits.
- [ ] Require a current authoritative baseline, three provider-native evidence
  advances, semantic price/status movement when emitted, and provider-targeted
  recovery to a strictly newer baseline without replacing another source.
- [ ] Update only the provider report. `DONE` is legal only when all live gates
  pass. If a gate fails, continue the loop. `BLOCKED` requires proven external
  auth/provider failure after in-scope alternatives are exhausted.

## Root Integration While Workers Run

- [ ] Review provider diffs continuously and fix shared seams with integration RED
  tests; do not turn workers into patch-only reporters.
- [ ] Use the root integration lease around every Git stage/commit operation so a
  provider edit cannot begin between status review and commit.
- [ ] Reject any evidence produced from an expired lease, different source/tab,
  different artifact identity, bridge heartbeat alone, replay, unchanged DOM,
  or control acknowledgement.
- [ ] Keep all five provider tabs separate; never use active-tab fallback or attach
  competing DevTools/CDP ownership.

## Final Six-Provider Gate

- [ ] All five provider reports are `DONE` from pinned live acceptance.
- [ ] BTI remains `ACTIVE` throughout.
- [ ] Restart API and reload the extension once from the final artifact; all five
  providers establish new non-replayed authoritative baselines.
- [ ] Run the simultaneous ten-minute six-provider soak and retain redacted
  evidence of authority/freshness/cursor progression and cross-provider isolation.
- [ ] Report exact commits, artifact identity, tests/builds, five provider verdicts,
  BTI status, and any real external blocker.

Provider-local GREEN, a report, or any `READY_FOR_INTEGRATION` wording is never a
completion state.
