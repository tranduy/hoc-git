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

## CMD collector and direct-price verification

- Commit: `271ddcc` (`fix(cmd): preserve realtime snapshot generations`)
- Scope: CMD only. No other bookmaker collector was staged or committed.

### Fixes

- `CmdSnapshotAssembler` now tracks the newest generation independently from
  chunk arrival time. A late chunk from an older snapshot cannot complete and
  overwrite a newer CMD catalog; source reset clears the generation watermark.
- `CmdDomCatalogAdapter` supplies both the monotonic arrival clock and provider
  observation generation to the assembler.
- CMD direct-price checks retain the expanded event/participant/market identity,
  while remaining compatible with the installed strict bridge bundle. The two
  command shapes are mutually exclusive: a new bundle accepts the full command;
  the installed bundle accepts the exact-ID compatibility command. Missing
  `method` is inferred as `DOM` only for this known CMD bundle.
- Added reusable CMD runtime verifiers for source/catalog/WebSocket and browser
  UI observation without provider-tab navigation.

### Regression tests

- Out-of-order chunks assemble once in index order.
- A late old generation cannot overwrite the newer snapshot.
- HOME `-0.25` and AWAY `+0.25` retain exact event/market/selection identity.
- FULL_TIME does not mix with FIRST_HALF at the same line.
- The same market/line in two events resolves only the requested event.
- A missing exact CMD selection fails closed.
- Installed CMD bridge compatibility remains correlated to the exact request.

Verification on 2026-08-21:

- CMD/provider/bridge focused suite: **160 passed** across 27 files.
- Web revision/UI suite: **70 passed, 4 skipped** across 2 files.
- `npm.cmd run typecheck`: all six workspaces passed.
- Runtime verifier scripts passed `node --check`; `git diff --cached --check`
  passed before commit.

### Authenticated runtime evidence

- No provider tab was reset, reloaded, closed, or navigated. The same CMD tab
  remained `chrome:CMD:2105811967` throughout.
- Ten-minute source soak (`.auth/run/cmd-runtime-evidence.json`): 591/591 samples
  LIVE; source sequence `5366 -> 5708`; catalog revision changed 99 times and
  the WebSocket delivered 99 CMD revision messages; event count stayed between
  98 and 108 with **0** live samples at zero events; no WebSocket errors.
- A concrete exact quote changed without a refresh, for example
  `25243041 | legacy:25243041:3:0.5 | ...:over` changed `-0.78 -> -0.80`
  from source sequence `5398 -> 5402`.
- Ten-minute browser UI soak (`.auth/run/cmd-ui-runtime-evidence.json`): exactly
  one document navigation, 100 CMD catalog responses, the same exact quote
  changes observed in the page session, and no page errors. This proves the UI
  consumed CMD updates without F5.
- Direct DOM AH check: event `25243032`, market
  `legacy:25243032:1:0/0.5`, HOME line `-0.25`; TOOL `0.76`, direct CMD `0.76`,
  `MATCH`, 40 ms.
- Direct DOM TOTAL check: event `25243041`, market
  `legacy:25243041:3:0.5`, OVER line `0.5`; TOOL `-0.88`, direct CMD `-0.88`,
  `MATCH`, 32 ms.
- Full identities and both prices were persisted to
  `%LOCALAPPDATA%/tool-chenh/logs/realtime-ticket-checks.jsonl` under check IDs
  `61d30d81-3d81-4216-abd0-6a7b29f5a786` and
  `e09519ea-986b-476a-ad4f-7f8b35a37604`.

### Remaining CMD note

- The currently installed extension is an older strict bundle. CMD works now
  through the tested compatibility path above. Reloading a newly built extension
  later will select the full-identity command automatically; it is not required
  for the runtime PASS recorded here.
