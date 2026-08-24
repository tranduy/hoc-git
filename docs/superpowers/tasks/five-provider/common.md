# Common Rules for Five Parallel Provider Workers

This file is read-only for workers.

## Start Here

Work only in:

```text
F:\0. PROJECT\tool-chenh\.worktrees\six-provider-realtime-feed
```

Required branch:

```text
feat/six-provider-realtime-feed
```

The branch must contain code foundation commit `6c440e8`. The integrator will provide the final coordination-base commit in the launch prompt.

Before editing, read in full:

1. `docs/superpowers/tasks/five-provider/common.md`
2. `docs/superpowers/tasks/five-provider/ownership.md`
3. your one provider task file
4. `docs/superpowers/specs/2026-08-24-five-provider-parallel-runtime-design.md`

Use `superpowers:systematic-debugging`, then `superpowers:test-driven-development`, and use `superpowers:verification-before-completion` before reporting done.

## Two Mandatory Phases

- Phase A — provider code: RED/GREEN, provider-local implementation, focused tests, diff review, and a report marked `READY_FOR_INTEGRATION`.
- Integration barrier — the integrator reviews all provider diffs, applies shared wiring, commits, builds the main application, reloads the extension, restarts the current stack, and issues one exact runtime lease per worker.
- Phase B — provider live acceptance: the same worker resumes, tests only its leased provider against the integrated main application, updates its report, and may mark `DONE` only after every realtime gate passes.

Phase A is never completion. A worker must remain available for the integration barrier and Phase B.

## Hard Concurrency Rules

- Do not create a worktree or switch branches.
- Do not run any Git mutation: no add, commit, reset, restore, checkout, stash, merge, rebase, clean, cherry-pick, or push.
- Do not run any build command. Builds write shared `dist` artifacts.
- Do not start, stop, restart, or signal API, web, launcher, Chrome, or extension processes.
- Do not copy or sync extension artifacts.
- During Phase A, do not use browser automation, tab actions, or runtime recovery endpoints.
- In every phase, do not open DevTools, attach CDP/`chrome.debugger`, or use active-tab actions.
- During Phase B, use only the account, exact tab ID, exact source ID, and build identity in the integrator-issued runtime lease. Never inspect or act on another provider.
- Do not read, print, edit, or include `.auth` launch/token material.
- Do not edit any file outside the exact whitelist in your task.
- Do not edit common/ownership/task documents.
- Do not edit another worker's report.
- Do not use formatting commands that rewrite files beyond your whitelist.

Focused tests are allowed. Multiple workers may run provider-local Vitest suites concurrently. If a test command would build a dependency or write shared generated output, do not run it; record it for the integrator.

After a Phase B lease, the only generally permitted local runtime interfaces are:

- `GET http://127.0.0.1:4310/api/chrome-bridge/sources` for transport diagnostics;
- `GET http://127.0.0.1:4310/api/catalog/sources` for authority/feed status;
- `GET http://127.0.0.1:4310/api/catalog/accounts/:accountId` for the leased catalog;
- `WS ws://127.0.0.1:4310/api/realtime` filtered to the leased account;
- `POST http://127.0.0.1:4310/api/maintenance/refresh-provider/:provider` only when the lease explicitly names that provider/action;
- the existing `scripts/verify-<provider>-runtime.mjs` assigned by the provider task, with output written only to its exact ignored `.run/five-provider/*-runtime-evidence.json` lease path.

CMD has no public provider-refresh route. Its worker requests one exact addressed CMD snapshot from the integrator and observes the result; it must not substitute a global refresh.

## Worker Workflow

1. Run `git status --short` read-only and inspect only your whitelisted paths.
2. If any whitelisted file already has edits you did not make, stop without touching it and report the collision to the integrator.
3. Read the current implementation and existing tests.
4. Add the exact failing test specified by your task.
5. Run the focused test and record the RED assertion. A missing fixture or syntax error is not valid RED evidence.
6. Make the smallest provider-local production change using `apply_patch`.
7. Run the focused tests until GREEN.
8. Review `git diff -- <your exact files>` and `git diff --check -- <your exact files>`.
9. Scan your diff for credentials, raw launch URLs, cookies, tokens, and raw provider bodies.
10. Write only your provider report at the path assigned in your task and set status to `READY_FOR_INTEGRATION`.
11. Pause and remain available. Do not describe Phase A as done, complete, fixed, successful, or realtime-ready.
12. When the integrator supplies a runtime lease, verify its build identity and resume Phase B.
13. Query only provider-scoped local API/status/catalog/recovery endpoints for the leased account/source.
14. Address only the exact leased tab/window identity; if the available mechanism can only act on the active tab, stop and request integrator assistance.
15. Prove the provider-specific runtime gates in your task, including continuous evidence and targeted recovery isolation.
16. Update the same report with redacted live evidence. Mark `DONE` only when every gate passes; otherwise mark `BLOCKED` with the exact observed reason.

## Shared Integration Request Format

If the provider cannot be completed without a shared-file edit, do not edit the shared file. Add this section to your report:

```text
Shared integration request
- Shared symbol/file:
- Provider-local output already implemented:
- Exact shared input/wiring required:
- RED integration test the integrator must add:
- Safety invariant:
- Focused command:
```

The request must be concrete enough for the integrator to apply without re-investigating the provider-local logic.

## Completion Report Contract

The Phase A report must include:

- worker/provider and starting coordination-base commit;
- exact changed files;
- root cause proven by code/test evidence;
- RED command and exact failing assertion count;
- GREEN command and exact passing count;
- provider authority/baseline/delta invariants now covered;
- shared integration request, or the literal statement `Shared integration request: none`;
- concerns or remaining external blockers;
- status `READY_FOR_INTEGRATION`;
- confirmation that no Git mutation, build, runtime process, browser, debugger, `.auth`, or other provider file was touched during Phase A.

The Phase B update must include:

- the integrator-issued commit/build/extension identity and leased account/tab/source identity, all redacted where required;
- starting and ending authority/feed/catalog state;
- one current authoritative baseline generation and provenance;
- at least three provider-evidence/cursor advances sampled over the provider's required window;
- a semantic price/status change when the provider actually emits one, without synthesizing activity;
- targeted recovery result and proof that unrelated providers were not reset;
- final status `DONE`, or `BLOCKED` with exact runtime evidence.

Only the provider worker may claim its leased provider passed Phase B; only the integrator may claim the combined six-provider application passed.
