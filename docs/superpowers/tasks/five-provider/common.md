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

## Hard Concurrency Rules

- Do not create a worktree or switch branches.
- Do not run any Git mutation: no add, commit, reset, restore, checkout, stash, merge, rebase, clean, cherry-pick, or push.
- Do not run any build command. Builds write shared `dist` artifacts.
- Do not start, stop, restart, or signal API, web, launcher, Chrome, or extension processes.
- Do not copy or sync extension artifacts.
- Do not open DevTools or use browser automation, CDP, `chrome.debugger`, tab focus, navigation, reload, close, or runtime recovery endpoints.
- Do not read, print, edit, or include `.auth` launch/token material.
- Do not edit any file outside the exact whitelist in your task.
- Do not edit common/ownership/task documents.
- Do not edit another worker's report.
- Do not use formatting commands that rewrite files beyond your whitelist.

Focused tests are allowed. Multiple workers may run provider-local Vitest suites concurrently. If a test command would build a dependency or write shared generated output, do not run it; record it for the integrator.

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
10. Write only your provider report at the path assigned in your task.
11. Stop. Do not commit, build, or perform live browser testing.

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

Every report must include:

- worker/provider and starting coordination-base commit;
- exact changed files;
- root cause proven by code/test evidence;
- RED command and exact failing assertion count;
- GREEN command and exact passing count;
- provider authority/baseline/delta invariants now covered;
- shared integration request, or the literal statement `Shared integration request: none`;
- concerns or remaining external blockers;
- confirmation that no Git mutation, build, runtime process, browser, debugger, `.auth`, or other provider file was touched.

Do not claim live runtime success. Only the integrator can make that claim after building and testing the main application.
