# Root Coordinator Task

## Outcome

The root coordinator prepares one buildable shared base, keeps shared files and Git history coherent, and prevents one worker from invalidating another worker's runtime evidence. It does not turn provider workers into patch-only assistants.

Five provider workers own five end-to-end outcomes concurrently:

- SABA -> realtime `ACTIVE`
- CMD -> realtime `ACTIVE`
- APSPORT/TSPORT -> realtime `ACTIVE`
- IM -> realtime `ACTIVE`
- SBOBET/KSPORT -> realtime `ACTIVE`

BTI remains the `ACTIVE` regression control. Total elapsed time should approach the slowest provider, not the sum of five provider tasks.

## Root-Only Ownership

The root alone mutates Git history and shared source listed in `ownership.md`. It reviews cross-provider changes, resolves collisions, and commits coherent checkpoints. Provider workers own diagnosis, provider-local implementation, focused tests, deployment under a lease, exact-tab recovery, and live acceptance for their assigned provider.

No report, unit-test result, or `READY_FOR_INTEGRATION` label is a successful terminal state. Only the runtime gates in `common.md` permit `DONE`.

## Stable-Workspace Protocol

All sessions share one repository checkout. Every provider source mutation must be enclosed by a short provider edit lease:

```powershell
node scripts/five-provider-coordinator.mjs begin-edit <PROVIDER> <WORKER_ID>
# apply one coherent provider-local patch
node scripts/five-provider-coordinator.mjs end-edit <TOKEN>
```

Five disjoint edit leases may coexist. A deployment lease is denied while any edit lease exists, and new edits are denied during deployment. This gives build/restart/reload a stable filesystem snapshot without serializing diagnosis and tests.

Deployment and acceptance commands are defined in `common.md`. Acceptance leases may coexist for all five providers and block deployment until their evidence windows end.

## One-Time Legacy Handoff

Before issuing worker prompts, root alone validates that every recorded legacy
launcher/API/web PID belongs to this exact repository checkout, stops only that proven
tree, verifies both live ports are clear, removes only the unchanged legacy
record, and starts the committed base so it publishes managed state v2. No
provider worker may read, repair, delete, or replace `.auth` state. After this
one transition, every deployment uses the zero-argument managed restart command
and its environment-bound deployment lease; encountering legacy or malformed
state is a hard stop reported to root.

## Shared Base Gate

Before the five workers start, root must prove:

1. shared contracts compile;
2. provider adapters and observer recovery wiring pass focused tests;
3. API and extension typecheck;
4. the complete main application builds from the current shared commit;
5. the managed stack and loaded extension both use that exact base;
6. the five provider tabs remain separate and are addressed by exact tab/source identity;
7. no token, cookie, launch URL, raw body, or credential is present in the diff.

## Review and Commit Loop

Root continuously reviews disjoint provider diffs while workers continue their runtime loops. Before status review/staging/commit it atomically claims `claim-integration root-integrator`; this lease blocks new edits, deployments, and acceptances until `release-integration <TOKEN>`. Root stages only reviewed files and releases the lease in `finally`. Shared defects reported by a worker are fixed by root with a failing integration test first.

The final result requires all five provider verdicts, BTI regression, one restart/reload reproof, and a simultaneous soak. A provider may be `BLOCKED` only with redacted evidence of a genuine external auth/provider failure after in-scope code and same-tab recovery alternatives are exhausted.
