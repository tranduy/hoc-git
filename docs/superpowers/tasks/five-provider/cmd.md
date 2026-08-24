# CMD Worker Task

Priority: 1

Report: `docs/superpowers/reports/five-provider/cmd.md`

## Required Reading

Read `common.md`, `ownership.md`, and the parallel runtime design before touching code. Follow the CMD whitelist exactly.

## Proven Root Causes

Two independent faults can keep CMD in `CANDIDATE`:

1. The page expression returns `baseline-requested` immediately after calling the provider function. That acknowledgement is not proof that a current-document complete `fc=1` HTTP response arrived. A naturally busy page is currently attempted only once per poll interval.
2. `cmd-http-adapter.ts` can advance its committed provider cursor from a pre-baseline delta. A delta at cursor 101 can then cause a complete baseline at cursor 100 to be discarded even though no baseline exists.

The shared observer also needs owning-CDP-session and loader fencing. This worker must not edit `network-observer.ts`; it must provide a deterministic provider-local recovery state unit and an exact integration request.

## Required Adapter Invariant

- Before the first complete `fc=1` baseline, deltas are bounded pending evidence and do not advance the committed baseline cursor.
- A valid complete `fc=1` baseline commits even when its cursor is below a buffered pre-baseline delta.
- Buffered deltas newer than that baseline are reapplied in order if their shape is supported; otherwise the adapter remains fail-closed and requests reconciliation without poisoning future full baselines.
- After a baseline exists, stale/equal cursors, wrong function codes, malformed bodies, cross-document parts, and replay remain rejected.

## Required Recovery-State Invariant

Implement or harden a provider-local bounded state machine that the integrator can wire into the observer:

- `busy` and `baseline-requested` without matching completion are not success;
- at most one recovery is active per CMD source/document;
- retries have both a fixed attempt cap and deadline;
- a matching current-document complete `fc=1` completion resolves success once;
- loader/source generation change, abort, release, cap, or deadline resolves failure and prevents later work;
- no reload, navigation, or tab replacement action exists in this unit.

## TDD Cases

1. Receive `fc=3, t=101` before any baseline, then complete `fc=1, t=100`; assert one `BASELINE` and ordered application of the newer supported delta.
2. Bound pre-baseline delta storage and prove overflow fails closed without permanently blocking a later complete baseline.
3. `busy -> busy -> baseline-requested -> matching completion` resolves once within the cap.
4. Always busy resolves a timeout at cap/deadline.
5. `baseline-requested` without matching completion retries and then times out.
6. Document/epoch abort between attempts prevents every later attempt and completion.
7. Duplicate matching completion does not publish twice.
8. Poller schedules immediate bounded recovery without overlapping its normal cadence.

## Focused Commands

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/cmd-http-adapter.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- src/cmd-snapshot-poller.test.ts src/cmd-recovery-state.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api -- --pretty false
npm.cmd run typecheck --workspace @tool-chenh/chrome-extension -- --pretty false
git diff --check -- apps/api/src/chrome-bridge/cmd-http-adapter.ts apps/api/src/chrome-bridge/cmd-http-adapter.test.ts apps/chrome-extension/src/cmd-snapshot-poller.ts apps/chrome-extension/src/cmd-snapshot-poller.test.ts apps/chrome-extension/src/cmd-recovery-state.ts apps/chrome-extension/src/cmd-recovery-state.test.ts
```

If the optional recovery-state files are unnecessary, do not create them and omit them from `git diff --check`.

## Required Shared Integration Request

The report must specify the observer wiring for:

- exact frame and current loader lookup;
- owning child CDP session for `Runtime.evaluate`;
- loader/source-generation checks before and after every await;
- correlation to one complete current-document `fc=1` request/body;
- bounded retry/abort diagnostics with no raw URL, frame, loader, body, or credential values.

The common base owns observer wiring; if that shared invariant fails, send the exact failing test/symbol to the root while continuing provider-local work.

## Phase A — LOCAL_GREEN

After focused GREEN, both affected workspace typechecks, scoped diff check, and
redacted secret scan, update only the CMD report to `LOCAL_GREEN` while the CMD
edit lease remains live. Release it in `finally`, notify root with
`LOCAL_GREEN CMD`, and wait without editing, building, restarting, reloading,
recovering, or beginning acceptance. CMD never claims a deployment lease.

## Phase C — End-to-End Realtime Gate

Only after root publishes `ACCEPTANCE_ROUND <ROUND_ID> <BUILD_IDENTITY>`, resolve
the exact current CMD source and begin the acceptance lease with
`begin-acceptance CMD <worker> chrome:CMD:<exact-tab-id>`. Always call
`end-acceptance` in `finally`:

Run the provider sampler without building:

```powershell
node scripts/verify-cmd-runtime.mjs 120000 .run/five-provider/cmd-runtime-evidence.json
```

1. Require one complete current-document authenticated `fc=1` baseline; `busy` or `baseline-requested` acknowledgement is not success.
2. Require CMD to become `ACTIVE` and `LIVE/FRESH` without tab navigation or replacement.
3. Sample for at least 120 seconds and record at least three authenticated CMD provider responses/cursor advances, including the scheduled full reconciliation cadence.
4. Record an ordered semantic delta when emitted and prove a pre-cutoff/pre-baseline delta cannot roll back the committed baseline.
5. Issue one exact addressed CMD snapshot, then prove it is single-flight, bounded, tied to the same leased tab/document, and leaves every other provider source unchanged. Do not use global maintenance.
6. If all gates pass, end acceptance and report
   `ACCEPTANCE_PASS <ROUND_ID> CMD`; do not edit the report to `DONE` yet.
7. On any failure, end acceptance, report
   `ACCEPTANCE_FAIL <ROUND_ID> CMD <REDACTED_REASON>`, and obey root's
   `STOP_ACCEPTANCE`. Wait for all leases to end before returning to
   `IN_PROGRESS` and provider-local TDD.
8. Only after root announces `ROUND_ACCEPTED` for this round may CMD acquire a
   new edit lease and update its report to `DONE`. `BLOCKED` is legal only for a
   proven external provider/auth failure.

Do not attach DevTools/CDP, use active-tab fallback, or touch another provider. Unit tests without this live gate are not completion.
