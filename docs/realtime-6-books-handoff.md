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

## SABA WebSocket catalog and direct-price verification

- Commit: `c62bff8` (`fix(saba): preserve websocket baseline across reconnects`)
- Scope: SABA and the minimum shared bridge compatibility needed by the installed
  extension. No collector implementation for the other five books was included.

### Fixes and regression coverage

- SABA only publishes a WebSocket partition after `reset/empty -> baseline -> done`;
  pre-baseline deltas cannot create a partial catalog. Subsequent upsert/delete
  deltas are applied by provider event/odds IDs; duplicate and older revisions
  fail closed.
- Complete SABA baselines are retained per document and persisted in
  `chrome.storage.session`. A bridge/API reconnect replays only a complete
  baseline from the same page document. A document/source epoch change discards
  the old state; no tab reload, close or URL mutation is used.
- Memory pressure removes an entire SABA partition instead of deleting middle
  deltas and creating an unrecoverable sequence gap.
- Exact direct-price lookup uses SABA event/market/selection IDs in the current
  top document, distinguishes HOME/AWAY and OVER/UNDER, and fails closed when
  missing or ambiguous. The installed strict bridge shape and its missing legacy
  `method` field are accepted only for correlated SABA/CMD DOM responses.
- Regression cases cover reset/baseline/done/delta, duplicate/out-of-order,
  lower sequence after source epoch change, reversed participants, quarter
  handicap, FULL_TIME/FIRST_HALF, exact selection and ambiguity.

### Verification on 2026-08-21

- API focused suite: **40 passed**.
- Extension focused suite: **83 passed**.
- SABA normalizer: **10 passed**.
- Web comparison/worker suite: **54 passed**.
- Typecheck: all six workspaces passed; `git diff --cached --check` passed.
- CDP capture before the extension worker transition recorded 27 SABA
  `Network.webSocketFrameReceived` `/socket.io/` frames, sequence `23926 ->
  23993`, one source epoch and 26 delta frames.
- Ten-minute pre-deployment soak: 591/591 source samples LIVE, source sequence
  `22709 -> 24133`, event count fixed at 60 with zero false-zero samples. It also
  exposed the real remaining defect: **0 catalog revisions and 0 UI SABA
  responses**, so this run is explicitly not recorded as realtime PASS.
- Direct authenticated DOM verification now completes against exact IDs:
  AH check `9b999142-dd40-489c-9cc2-497039a6c3ee` read `-0.99` in 61 ms versus
  stale TOOL `-0.93`; TOTAL check `7643a834-3475-448b-9ed5-bfae2c6e4b8a`
  read `0.93` in 915 ms versus stale TOOL `0.94`. Both correctly returned
  `ODDS_CHANGED/MISMATCH`, proving the direct value is not copied from catalog.

### Runtime blocker still open

- The built extension service worker was restarted without changing any provider
  tab. Chrome reattached CDP to the already-open SABA page, but CDP cannot replay
  the baseline of a WebSocket that was created before the new debugger session.
  The current SABA catalog therefore remains the persisted 60-event STALE
  snapshot until the provider socket naturally reconnects and emits a new
  reset/done baseline. Forcing that baseline would require a provider-tab reload,
  which this task explicitly forbids. Do not claim SABA catalog realtime PASS
  until a natural reconnect yields a new baseline and the 10-minute verifier
  records quote/revision/UI changes without F5.
- Local evidence files: `saba-cdp-capture-evidence.json`,
  `saba-runtime-evidence.json`, `saba-ui-runtime-evidence.json`, and
  `saba-direct-price-evidence.json` (kept untracked).

## APSPORT/TSPORT atomic catalog and exact-price verification

- Commit: `96c0ba6` (`fix(apsport): verify exact live selection prices`)
- Scope: APSPORT/TSPORT plus the minimum shared probe/coordinator handling for
  TSPORT diagnostic results. No collector code for the other five books was
  included.

### Fixes and regression coverage

- A completed TSPORT DOM snapshot now replaces the prior DOM generation as one
  unit. Obsolete events and selection IDs cannot survive into the new
  generation; socket-only hidden markets remain in their independent partition.
- DOM snapshot extraction no longer invents selection IDs. Catalog rows keep
  the provider event, market and `odd-item-<selectionId>` identities.
- Direct-price verification first requires one visible exact DOM selection with
  the same event, ordered participants, market type, scope, line and outcome.
  Hidden duplicates are ignored; missing or multiple visible exact candidates
  fail closed.
- If the exact DOM row is virtualized, the extension performs a fresh
  credentialed, no-store GET using a request URL observed in the same TSPORT
  tab and accepts only a full provider-ID identity match. The catalog and its
  realtime WebSocket are never used as the direct-price result.
- TSPORT's async resolver is awaited through CDP, and API preflight preserves
  its exact NOT_FOUND/AMBIGUOUS diagnostic instead of timing out.
- Regression tests cover hidden/duplicate nodes, similar team names, the same
  line in another market, obsolete selection IDs, reversed participants,
  ambiguous/not-found results, bounded stalled requests and atomic generation
  replacement.

### Verification on 2026-08-21

- Extension focused suite: **74 passed**.
- API focused suite: **29 passed**.
- Typecheck: API and extension passed; `git diff --cached --check` passed.
- Direct authenticated AH check: event `5639352`, market
  `5639352:FT_AH:+0/0.5:0`, selection `56393520050000025h`; TOOL `0.77`, direct
  DOM `0.77`, `MATCH`, 1,015 ms.
- Direct authenticated TOTAL check: event `5628780`, market
  `5628780:FT_TOTAL:2.5/3:1`, selection `56287800030020075h`; TOOL `0.87`, direct
  DOM `0.87`, `MATCH`, 7 ms. Both checks are recorded in
  `%LOCALAPPDATA%/tool-chenh/logs/realtime-ticket-checks.jsonl`.
- Clean ten-minute soak after the scheduled 03:00 maintenance: 592 samples,
  zero false-zero catalogs, source sequence `358 -> 12270`, 562 catalog
  revision changes and 3,595 APSPORT realtime revision messages. Event count
  stayed between 53 and 60.
- The API and UI independently recorded the same exact-ID odds changes. Example:
  selection `56525400030020075h` changed `0.84 -> 0.85`, sequence `1261 ->
  1306`; the UI recorded one initial document navigation, no F5/reload and no
  page errors. Current TSPORT source is LIVE with 60 events and 272 quotes.

### Evidence and remaining note

- Runtime evidence is kept untracked in `apsport-runtime-evidence-clean.json`,
  `apsport-ui-runtime-evidence-clean.json`, and
  `apsport-direct-price-diagnostic.json`.
- The 03:00 scheduled maintenance overlapped a discarded intermediate monitor;
  none of its observations are used for the clean soak evidence above.

## IM atomic GetSE catalog and exact-price verification

- Commit: `e7c7c59` (`fix(im): publish atomic realtime generations`)
- Scope: IM collector, IM direct-price resolver, and only the shared diagnostic
  handling required to carry IM fail-closed results. No collector for another
  bookmaker was staged or committed.

### Fixes and regression coverage

- Each signed in-page GetSE refresh assigns one generation to Market 1 and
  Market 2. The API publishes only after both partitions of that generation
  arrive; a new partition cannot be combined with an old one, reverse arrival
  is supported, and a complete old generation arriving late cannot roll the
  catalog back. Source reset clears pending/current generation state so a lower
  sequence in a new epoch is accepted.
- IM recovery continues to use the lightweight `REQUEST_SNAPSHOT` path and the
  authenticated in-page signing helper. It never uses `RELOAD_SOURCE` for the
  one-time IM URL.
- Prematch extraction retains only the next 48 hours. Live events bypass that
  age filter. Runtime contained no prematch event beyond 48 hours; the old-live
  case is covered by the focused catalog regression test because no IM live
  event existed during this run.
- Direct-price verification never clicks, opens, or navigates to an IM event.
  It accepts a visible DOM value only with exact event/market/selection IDs;
  otherwise it signs and sends fresh no-store Market 1 and Market 2 GetSE
  requests in the existing authenticated main world. Event, ordered
  participants, market ID/type, scope, outcome, line and selection ID must all
  match uniquely. Missing, ambiguous, stale-scope/line/outcome and unavailable
  token/request results fail closed.

### Tests and runtime evidence on 2026-08-21

- TDD red cases were observed for mixed Market 1/Market 2 generations, a late
  complete old generation, missing direct-price module, navigation-based IM
  probing, and previously unrecognized IM direct diagnostics.
- API focused suite: **51 passed** across five files.
- Extension focused suite: **69 passed** across two files.
- Typecheck: all six workspaces passed; `git diff --cached --check` passed.
- Ten-minute source soak (`im-runtime-evidence.json`): **586/586** samples LIVE,
  source sequence `285 -> 673`, 27 catalog revision changes and 35 IM WebSocket
  revision messages. Event count stayed between 417 and 420 with **0** false-zero
  samples and no WebSocket errors.
- Ten-minute browser UI soak (`im-ui-runtime-evidence.json`): exactly one initial
  document navigation, 27 IM catalog responses, the same exact-ID quote changes
  as the API monitor, and no page errors. Example selection
  `112810440|2505747403|32416727556` changed `0.82 -> 0.78`, sequence
  `291 -> 303`, without F5.
- Final authenticated direct AH check `6dfb613b-bd96-465c-9fd1-cbebd98827fc`:
  event `112768882`, market `2504645311`, selection `32399416603`, HOME line
  `0.5`; TOOL `0.92`, fresh GetSE `0.92`, `MATCH`, `IN_PAGE_FETCH`.
- Final authenticated direct TOTAL check `e7feb063-5188-4e51-ac08-668283195548`:
  event `112732851`, market `2503756420`, selection `32392951293`, OVER line
  `2.75`; TOOL `0.80`, fresh GetSE `0.80`, `MATCH`, `IN_PAGE_FETCH`.
- The final build was deployed without resetting, reloading, closing or changing
  any provider tab URL. IM remained on tab `2105812090`; after the final API
  restart it was LIVE with 419 events and 1,864 quotes.

### Evidence files and remaining note

- Evidence is kept untracked in `im-runtime-evidence.json`,
  `im-ui-runtime-evidence.json`, and `im-direct-price-evidence-final.json`.
- There was no live IM fixture during the soak, so retention of an old-start live
  event is test-proven rather than live-runtime-proven. No other IM blocker was
  observed in this run.

## SBOBET/KSPORT STOMP catalog and exact-price verification

- Commit: `158cb57` (`fix(sbobet): harden realtime stomp ingestion`)
- Scope: KSPORT/SBOBET STOMP decoder and catalog adapter, KSPORT transport
  validity, exact-price probing, tab identity, replay, and SBOBET-only runtime
  verification scripts. No collector for another bookmaker was committed.

### Fixes and regression coverage

- SockJS/STOMP MESSAGE fragments are reassembled through NUL termination;
  heartbeats and late RECEIPT frames cannot poison or replay the next provider
  message. Live and today must both establish a baseline before publication.
- Provider receipt order is monotonic per partition. Event deltas merge by
  provider event ID and market deltas merge by provider market ID without
  erasing unrelated events or markets. Full partition snapshots still replace
  atomically.
- An explicit socket OPEN retires the old stream and starts an empty epoch. Late
  old-stream frames are ignored. CLOSED retires the current stream, invalidates
  the catalog, and clears retained replay frames so stale prices cannot be
  resurrected.
- Replay retains every STOMP fragment from only the current sports stream. A
  continuation fragment does not need to repeat the destination header.
- Tab heartbeats, analytics, jackpot frames and undecodable WS frames do not
  refresh KSPORT catalog liveness. Only a decoded provider catalog update can
  do so; the system therefore fails closed instead of showing heartbeat-only
  data as realtime.
- Volta/error/non-sportsbook tabs are rejected as KSPORT authorities.
- Direct price verification first checks exact visible DOM identity across all
  frames. DOM is accepted only when event ID, ordered participants, market ID,
  selection ID, market type, scope, canonical line and outcome all match. If no
  DOM candidate exists, frames are tried sequentially with one fresh no-store
  `/api/v2/getEvent` request at a time. It stops on the first fully identified
  result; multiple candidates and missing identity fail closed. Catalog odds
  are never returned as `SÀN HIỆN TẠI`.

### Tests and runtime evidence on 2026-08-21

- Focused suite: **141 passed** across seven SBOBET/KSPORT adapter, observer,
  price, identity and normalizer files.
- API and extension typecheck passed; API and extension builds passed;
  `git diff --cached --check` passed.
- Independent code review found no remaining Critical or Important issue after
  the closed-stream retirement regression was added.
- Passive ten-minute soak (`sbobet-runtime-evidence.json`): 591 samples; source
  heartbeat sequence `1574 -> 2031`; provider status was `ACTION_REQUIRED` in
  **591/591** samples and `ACTIVE` in **0/591**; no false-zero transition;
  retained stale catalog stayed at 62 events and one unchanged revision.
- A bounded CDP capture contained no KSPORT sports STOMP frame. It contained
  only the tab heartbeat, analytics traffic and a direct `/api/v2/getEvent`
  HTTP 404. Therefore there was no real quote delta available to prove
  frame -> source sequence -> catalog revision -> UI in this run.
- Direct AH and TOTAL preflight both failed closed with `SOURCE_UNAVAILABLE` /
  `SBOBET_DIRECT_HTTP_404`; no catalog price was substituted as the current
  bookmaker price.

### Runtime status and remaining blocker

- Runtime realtime status is **NOT PASS**. The current authenticated KSPORT tab
  has no active sportsbook STOMP feed, so quote-change/UI-no-F5 and direct AH /
  TOTAL MATCH evidence cannot be produced honestly.
- No launcher, provider reset, reload, close or URL change was performed. The
  code is built, but loading the rebuilt extension into the existing Chrome
  session would itself require an extension/tab lifecycle action outside this
  task's runtime constraints.
- Evidence remains untracked in `sbobet-runtime-evidence.json`,
  `sbobet-direct-price-precheck.json`, and the capture under
  `%LOCALAPPDATA%/tool-chenh/chrome-bridge-captures/`.

## BTI atomic catalog and exact-price verification

- Code commit: `e5f7c72` (`fix(bti): publish atomic realtime generations`)
- Scope: BTI HTTP event-list/detail ingestion, BTI catalog liveness, exact-price
  probing, and BTI-only runtime verification scripts. No collector for another
  bookmaker was included.

### Fixes and regression coverage

- A refresh now tags all four live/prematch event-list requests with one
  generation. The adapter publishes only after all four partitions complete,
  replaces them atomically, and rejects late older generations. A timeout,
  malformed response, incomplete generation, or uncorrelated direct-price
  detail cannot erase or overlay the last good catalog.
- Event detail obtained as part of catalog refresh is generation-correlated and
  bounded. A newly committed baseline clears detail overlays from the previous
  generation.
- BTI heartbeat/analytics traffic advances source transport sequence but no
  longer refreshes catalog liveness. Catalog `acquiredAt` advances only after a
  valid decoded catalog update, allowing legitimate provider silence to be
  distinguished from a dead catalog while keeping the lightweight in-tab
  snapshot path.
- The direct-price check sends one fresh authenticated no-store BTI event-detail
  request inside the existing tab. It requires one exact ordered event, market
  ID/type/scope/canonical line, selection ID/outcome/side and an enabled quote.
  Missing or multiple event/market/selection candidates fail closed; catalog or
  event-list odds are never returned as the current bookmaker price.

### Tests and build evidence on 2026-08-21

- Focused adapter/observer/probe suite: **118 passed** across four files.
- BTI direct-catalog and BTI data-plane cases: **8 passed** (20 unrelated cases
  skipped by the BTI filter).
- API and extension typecheck passed; API and extension builds passed;
  `git diff --cached --check` passed.
- Independent review found no remaining Critical/Important implementation
  defect. It requested a UI verifier; `scripts/verify-bti-ui-runtime.mjs` was
  added before the code commit.

### Runtime evidence and status

- Existing installed-runtime direct AH check
  `41e5f73f-aa3c-4612-89a6-4854c21039ba`: event
  `877193587199340544`, market `0HC877193588084412471:-0.25`, selection
  `0HC877193588084412471HMM`; TOOL `0.77`, fresh detail `0.77`, `MATCH`,
  `IN_PAGE_FETCH` in 202 ms.
- Existing installed-runtime direct TOTAL check
  `5b84b1a7-8f27-4c4c-b05c-c985eac91f6c`: event
  `877193587199340544`, market `0OU877193588084412472:3.25`, selection
  `0OU877193588084412472OMM`; TOOL `0.82`, fresh detail `0.82`, `MATCH`,
  `IN_PAGE_FETCH` in 707 ms.
- Fifteen-minute passive API soak: **889/889** samples LIVE, source sequence
  `64842 -> 80886`, catalog acquired time advanced, 725 catalog revision
  changes, 3,517 BTI WebSocket revision messages, event count 35-44, **0**
  false-zero samples, and no WebSocket errors. Multiple AH/TOTAL quote changes
  were observed.
- Fifteen-minute browser UI soak performed exactly one document navigation and
  observed 1,581 BTI catalog responses plus exact-ID AH/TOTAL quote changes
  without F5. Example AH selection
  `877994424062545920|0HC877994427346612259:0.5|0HC877994427346612259HMM`
  changed `0.83 -> 0.75`, sequence `69440 -> 69523`. The first verifier run
  recorded a shutdown-only response-handler race; the verifier was fixed to
  drain pending responses, and a 10-second smoke then completed with 16 catalog
  responses, multiple quote changes and **0** page errors.
- Runtime status for commit `e5f7c72` is **NOT YET FINAL PASS**. The running API
  process and extension service worker were already loaded before this commit.
  The old installed runtime exposed at least one per-quote sequence regression
  during the soak; the new atomic-generation code targets that exact failure,
  but activating it requires an extension lifecycle reload. This task forbids
  reload/reset/close/URL changes, so no such action was performed and the final
  bundle was not falsely reported as runtime-proven.

### Evidence files and remaining step

- Evidence remains untracked in `bti-runtime-evidence.json`,
  `bti-ui-runtime-evidence.json`, and `bti-direct-price-evidence.json`.
- After an explicitly permitted extension reload/deployment, rerun the same
  15-minute API/UI verifiers. Final PASS requires monotonic generation/quote
  evidence, a BTI quote change reflected in UI without F5, no false zero, and
  fresh AH/TOTAL detail checks.
