# CMD Worker Task

Priority: 2

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

Do not edit the observer yourself. Do not use the live CMD page or DevTools.
