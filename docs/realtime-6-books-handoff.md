# Realtime six-book handoff

## Shared visible-price verification infrastructure

- Commit: `d0711c5` (`feat: add fail-closed direct price verification infrastructure`)
- Scope: shared **Kiểm tra giá thật** request/response, API coordinator/control plane,
  extension direct-read dispatch, fail-closed identity verification, JSONL evidence,
  and the side-by-side Web UI. No provider collector was changed by this commit.

### Files changed

- Contracts: `packages/contracts/src/domain.ts`, `schemas.ts`, `chrome-bridge.ts`
  and their tests.
- API: `selection-price-probe-coordinator.ts`, `chrome-bridge-control-plane.ts`,
  `provider-preflight.ts`, `server.ts` and focused tests.
- Extension: `local-bridge.ts`, `background.ts`, `network-observer.ts`,
  `selection-price.ts` and focused tests.
- Web: `ranked-ticket-table.tsx`, `ticket-realtime-check.test.ts`, component tests,
  and `styles.css`.

### Verified behavior

- The request preserves provider, event ID/label, HOME/AWAY participants, market,
  scope, line, outcome, provider market ID and provider selection ID end to end.
- The direct result carries TOOL price/clock/sequence, direct bookmaker price/read
  time, `DOM` or `IN_PAGE_FETCH`, and `MATCH`, `MISMATCH`, `NOT_FOUND` or
  `AMBIGUOUS`.
- Direct reads are dispatched through the Chrome bridge after the button request;
  the API does not substitute catalog/WebSocket quote data for the direct price.
- Multiple matching frames/selections fail closed as `AMBIGUOUS`; missing identity
  fails closed as `NOT_FOUND`.
- JSONL entries retain the complete request identity and both displayed/direct
  result objects. The UI renders TOOL and SÀN HIỆN TẠI next to each other and
  exposes the direct-read method or failure code.

### Tests and evidence

- TDD red cases observed for missing participants/methods, lost method on
  `NOT_FOUND`/`AMBIGUOUS`, and duplicate frame candidates incorrectly returning
  `FOUND`.
- Exact staged commit tree (detached verification worktree):
  - contracts/API/extension focused suite: **210 passed**;
  - Web focused suite: **21 passed**;
  - `npm.cmd run typecheck --workspaces --if-present`: all six workspaces passed;
  - `git diff --cached --check`: passed before commit.
- No bet, hard reset, reload, tab close, or provider-tab URL change was performed.

### Remaining work

- Reload/deploy the built extension and API/Web bundle before manual UI use; this
  infrastructure commit deliberately did not alter live provider tabs.
- Validate each provider-specific resolver separately against authenticated live
  pages. This handoff does **not** claim that any bookmaker is realtime.
- Existing unstaged collector/reset work in the worktree remains untouched and is
  not part of commit `d0711c5`.
