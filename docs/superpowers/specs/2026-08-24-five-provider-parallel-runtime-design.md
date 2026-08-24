# Five-Provider Parallel Runtime Recovery Design

Date: 2026-08-24

Status: approved coordination model

Repository root: `F:\0. PROJECT\tool-chenh`

Scope: SABA, CMD, APSPORT/TSPORT, IM, and SBOBET/KSPORT. BTI is the live
regression control.

## Goal

Complete five provider feeds quickly without racing shared builds or invalidating
live evidence. Provider-local diagnosis and TDD run concurrently. Deployment is
not provider-owned: root freezes the combined tree and performs one build,
managed restart, and unpacked-extension reload per acceptance round. The five
workers then prove their own providers concurrently against that exact build.

There is no patch-only completion and no per-worker deployment loop.

## Roles and Ownership

All six sessions use the same root checkout. Every shell/tool invocation resolves
relative paths from `F:\0. PROJECT\tool-chenh`; the linked
`.worktrees\six-provider-realtime-feed` checkout is out of scope.

| Role | Owned work |
| --- | --- |
| Root integrator | shared source, Git history, freeze, combined deploy, round control |
| SABA worker | SABA whitelist, report/evidence, SABA acceptance |
| CMD worker | CMD whitelist, report/evidence, CMD acceptance |
| APSPORT worker | TSPORT whitelist, report/evidence, APSPORT acceptance |
| IM worker | IM whitelist, report/evidence, IM acceptance |
| SBOBET worker | KSPORT whitelist, report/evidence, SBOBET acceptance |

`ownership.md` defines exact file whitelists, source mapping, and the current
root-only deployment rule. Workers never build, restart, reload, or claim
deployment.

## Provider Mapping

| User-facing account | Bridge/adapter | Worker |
| --- | --- | --- |
| SABA | SABA | SABA |
| CMD | CMD | CMD |
| APSPORT | TSPORT | APSPORT |
| IM | IM | IM |
| SBOBET | KSPORT | SBOBET |
| BTI | BTI | root regression control |

The five provider pages remain in five separate Chrome tabs. A worker controls
only its exact source/tab, never the active tab. DevTools and competing CDP
ownership are forbidden. Tokens, cookies, launch URLs, signed URLs, credentials,
and raw provider bodies never enter code, reports, evidence, or diagnostics.

## Existing Coordination Primitives

This model adds no coordinator feature.

- Provider edit leases serialize mutations to one provider whitelist and may
  coexist across different providers.
- The existing deployment lease serializes root's combined deployment only.
  Root claims it with provider label `SABA` and worker `root-integrator`; `SABA`
  is a fixed coordination label, not provider ownership.
- Existing provider acceptance leases pin exact source IDs and the
  `lastDeployment` build identity and may coexist across all five providers.
- The root integration lease may protect root Git operations, but it is never
  used to run the managed restart because the restart requires a provider-labeled
  deployment token.

There is no stable-runtime-barrier command. Phase transitions use explicit root
messages plus existing coordinator state.

## Execution State Machine

### 1. Provider-local work

All five workers diagnose and implement concurrently inside disjoint whitelists.
Each coherent patch holds its provider edit lease from before the RED test is
written through GREEN tests, affected typechecks, diff checks, secret scan, and
report update.

The worker reports `LOCAL_GREEN <PROVIDER>` and releases its edit lease. This is
a wait state, not completion. A worker in `LOCAL_GREEN` must not edit, recover,
accept, build, restart, or reload. Root/shared edits invalidate affected local
green checkpoints and require those workers to rerun local verification.

### 2. Freeze and combined deployment

Root waits for all five current `LOCAL_GREEN` reports, resolves shared integration
requests, reviews the tree, and proves there are no edit, deployment, or
acceptance leases. Root announces `FREEZE_FOR_COMBINED_DEPLOY <ROUND_ID>`.

Root alone then claims:

```powershell
node scripts/five-provider-coordinator.mjs claim-deploy SABA root-integrator 1800000
```

Under that token, root performs one combined `npm.cmd run build`, sets
`TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN`, runs zero-argument
`node scripts/restart-live-stack.mjs`, reloads exactly
`F:\0. PROJECT\tool-chenh\apps\chrome-extension\dist`, proves
`/api/health.buildIdentity`, and releases the lease. Release records the combined
artifact as `lastDeployment`.

Root then publishes `ACCEPTANCE_ROUND <ROUND_ID> <BUILD_IDENTITY>`.

### 3. Concurrent live acceptance

All five workers resolve their exact current source IDs, acquire provider-scoped
acceptance leases, and run their own provider samplers for at least 120 seconds.
They pin the same root-published build but retain responsibility for their own
provider gate and exact-tab recovery.

A successful worker ends its acceptance lease and reports
`ACCEPTANCE_PASS <ROUND_ID> <PROVIDER>`. The pass remains provisional and the
worker makes no tracked edit until root accepts the whole round.

### 4. Failure and retry

The first `ACCEPTANCE_FAIL` invalidates the round for everyone. Root broadcasts
`STOP_ACCEPTANCE`; all workers stop sampling, end acceptance leases, and discard
the round for completion purposes. Root waits for zero acceptance leases before
allowing edits.

Only failed providers and required root-owned shared seams change. Failed workers
return to provider-local RED/GREEN and `LOCAL_GREEN`. Root freezes a new round and
performs one new combined deployment. All five workers rerun acceptance against
the new build; no evidence or binding crosses rounds.

### 5. Completion

When all five workers pass the same round and all acceptance leases have ended,
root publishes `ROUND_ACCEPTED <ROUND_ID> <BUILD_IDENTITY>`. Workers may then edit
only their own reports under provider edit leases and write `DONE` with the live
evidence from that accepted round.

## Provider Outcomes

Provider-local implementations remain fail-closed:

- SABA: only a fresh current-stream Socket.IO reset/data/done sequence establishes
  authority; retired streams cannot re-enter.
- CMD: only a current-document complete authenticated `fc=1` response establishes
  authority; page-call acknowledgement does not, and pre-baseline deltas cannot
  poison the full-baseline cursor.
- APSPORT: DOM supplies expected identity/coverage only; fresh TSPORT WebSocket
  evidence supplies authoritative quotes and the baseline generation.
- IM: both authenticated GetSE partitions for one cutoff/generation commit
  atomically; valid positive Hong Kong odds normalize without accepting zero or
  non-finite values.
- SBOBET: KSPORT live/today partitions pair by explicit recovery generation,
  while independent receipt sequences remain ordering evidence only.

## Live Acceptance Contract

Each worker must prove on the root-published combined build:

- exact pinned source authority is `ACTIVE`;
- catalog source is `ACTIVE`, reason-free, `FRESH`, and nonempty;
- the baseline belongs to the current source epoch;
- provider-native evidence advances at least three times;
- a real semantic price/status delta is recorded when emitted, while heartbeat,
  replay, ACK, and unchanged DOM do not renew authority;
- exact-source targeted recovery creates a strictly newer authoritative baseline
  without changing any other provider source;
- BTI remains `ACTIVE` throughout;
- source/tab and API build identity remain pinned for the full window.

`LOCAL_GREEN`, `READY_FOR_INTEGRATION`, a unit-test result, or a provisional
acceptance pass is not success. The only successful terminal provider status is
live `DONE` from the same accepted round. A real external auth/provider outage
remains fail-closed and may be reported as `BLOCKED`; it is never converted into
success.
