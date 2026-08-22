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

## 2026-08-21 final matching/revision integration

### Commit and files

- Integration commit: `dca9a2a` (`fix(web): harden exact ticket integration`).
- Files changed by this integration:
  - `apps/web/src/catalog/comparison.ts`
  - `apps/web/src/catalog/comparison.test.ts`
  - `apps/web/src/catalog/comparison-worker-engine.ts`
  - `apps/web/src/catalog/comparison-worker-engine.test.ts`
  - `apps/web/src/catalog/catalog-revision-coordinator.test.ts`
  - `docs/superpowers/plans/2026-08-21-final-realtime-integration.md`
- No provider collector, provider tab, URL, reset path or extension lifecycle
  was changed by this integration session. Existing unrelated worktree changes
  were not staged.

### Matching and revision behavior now covered

- Football pre-match identity requires exact normalized participants, kickoff
  tolerance and a compatible competition identity. Cross-language competition
  names are accepted only through an explicit verified alias table; arbitrary
  fuzzy league text is not accepted.
- Market grouping canonicalizes numeric lines (`-0.250` and `-0.25` are one
  line), and still requires exact market type, scope and settlement profile.
- A verified two-way cell requires the exact opposing domain (`HOME/AWAY` or
  `OVER/UNDER`), unique provider selection IDs, complete provenance, and one
  equal non-null provider sequence for both outcomes. Unknown or mixed
  generations fail closed.
- Reversed participants swap HOME/AWAY and invert the canonical home handicap
  exactly once. The UI derives the away display sign from that canonical home
  line; it does not invert the provider line a second time.
- The Coquimbo Unido / CA Platense regression proves `HOME -0.25` is displayed
  against `AWAY +0.25` after provider orientation.
- The worker now keeps a separate last-complete display catalog. A partial,
  mixed-generation, duplicate-outcome or wrong-identity UPSERT is excluded from
  executable output but cannot erase the last complete displayed row and cause
  a disappear/reappear blink.
- Reconnect/API-restart coverage proves a new baseline may reset sequence from
  `500` to `6`, after which revision `7` is accepted. Existing StrictMode and
  overlapping-refresh regressions also pass.

### Verification

- TDD red phase reproduced three initial defects: raw numeric line keys,
  mixed-generation opposing quotes, and same teams/time across incompatible
  competitions. Independent review then found and drove regressions for exact
  localized competition aliases, null generations, retaining the last complete
  display snapshot, and same-sequence duplicate outcomes.
- Final independent review: no remaining Critical or Important finding.
- Focused matcher/worker red-green suite after all review fixes: 60/60 passed.
- Final full web suite: 45 files, 363 passed / 4 intentionally skipped.
- `npm run typecheck --workspace @tool-chenh/web`: PASS.
- `npm run build --workspace @tool-chenh/web`: PASS.
- `git diff --check`: PASS for the integration diff.

### Passive 20-minute final soak

- Evidence: `.auth/run/final-integration-soak.json` (untracked runtime artifact).
- Window: `1787263019548 -> 1787264220373` (1,200,825 ms), 589 samples at a
  two-second interval. No reset, reload, close or provider-tab URL change was
  performed.
- Realtime WebSocket: one connection, 9,724 messages, sequence `14448 -> 19540`,
  zero gaps, zero backward sequences, zero errors; the only close was the
  verifier's normal code-1000 shutdown.
- Every bridge reported LIVE in all 589 samples and no catalog returned zero
  events while its bridge was LIVE. Bridge heartbeat/sequence movement is not
  counted as proof that provider odds were current.
- The verifier's `activeCatalogSamples` field is invalid because that running
  verifier read `state` instead of the API field `sessionState`; it must not be
  used. The authoritative end snapshot at `1787264228387` is recorded below.

| Provider | End catalog status | Source sequence | Revision changes | Quote changes observed | Events min-max | End catalog age | Final runtime result |
|---|---|---:|---:|---:|---:|---:|---|
| CMD | ACTIVE | `2327 -> 2839` | 222 | >=50 | 18-28 | 4.7 s | PASS |
| SABA | ACTION_REQUIRED / `PROVIDER_VALIDATION_FAILED` | `3505 -> 4173` | 0 | 0 | 82-82 | 6,796.7 s | FAIL |
| APSPORT | ACTION_REQUIRED / `PROVIDER_VALIDATION_FAILED` | `2869 -> 3591` | 0 | 0 | 65-65 | 6,795.2 s | FAIL |
| IM | ACTIVE | `4281 -> 5119` | 34 | >=50 | 415-417 | 43.7 s | PASS |
| SBOBET | ACTION_REQUIRED / `PROVIDER_VALIDATION_FAILED` | `4229 -> 5192` | 0 | 0 | 62-62 | 6,795.3 s | FAIL |
| BTI | ACTIVE | `94345 -> 114136` | 555 | >=50 | 29-36 | 5.1 s | FAIL (new BTI bundle still not runtime-proven) |

### Direct AH/TOTAL and UI evidence

The final button-equivalent API calls used the exact displayed event, market,
selection IDs and invoked the same `/api/preflight/realtime-check` flow as the
UI. Evidence is in `.auth/run/final-direct-checks.json` and
`.auth/run/final-missing-direct-checks.json`.

| Provider | AH direct check | TOTAL direct check | UI without F5 | Identity / latency evidence | Result |
|---|---|---|---|---|---|
| CMD | MATCH, DOM | MATCH, DOM | Prior same-day 10-minute UI run: 50 quote changes, one navigation, no page error | Current exact checks 16-721 ms; TOOL equals direct | PASS |
| SABA | NOT_FOUND, DOM | NOT_FOUND, DOM | Final soak: no revision; prior SABA UI run had 0 catalog responses/changes | `VISIBLE_PRICE_NOT_FOUND`, 3-4 ms; no direct odds returned | FAIL |
| APSPORT | NOT_FOUND, DOM | NOT_FOUND, DOM | Earlier clean UI run proved changes, but current catalog is ACTION_REQUIRED and frozen | `TSPORT_SELECTION_NOT_RENDERED`, 12-31 ms | FAIL current session |
| IM | MATCH, IN_PAGE_FETCH | MATCH, IN_PAGE_FETCH | Prior same-day 10-minute UI run: 36 quote changes, one navigation, no page error | Current exact checks 1.4-7.1 s; TOOL equals direct | PASS |
| SBOBET | SOURCE_UNAVAILABLE | SOURCE_UNAVAILABLE | Final soak: no revision or quote change | `SBOBET_DIRECT_HTTP_404`, 50-64 ms | FAIL |
| BTI | Prior installed-runtime MATCH | Prior installed-runtime MATCH | Prior UI run observed changes without F5, but the new atomic-generation bundle was not activated under this session's no-reload rule | Prior exact detail checks 202/707 ms; no exact BTI row was available for a new final button check | FAIL / not final-proven |

The in-app browser control surface rejected the final-session connection before
it exposed the existing tool tab. A standalone Playwright browser was not used
as a substitute, because that would not prove behavior in the user's live tab.
Therefore final-session UI-freeze/blink proof comes from deterministic
StrictMode/reconnect/overlap/atomic-display regressions; provider UI movement is
only credited where the same-day handoff already contains a valid one-navigation
UI soak. This is why the final result is **2/6 PASS (CMD and IM), not 6/6**.

### Remaining provider work

- SABA: restore a validating live catalog epoch, then rerun socket -> revision ->
  UI and direct AH/TOTAL checks without using stale persisted catalog data.
- APSPORT: restore validation and make virtualized selections fall through to
  the fresh in-page request path instead of ending at
  `TSPORT_SELECTION_NOT_RENDERED`.
- SBOBET: restore a valid sportsbook/STOMP source and a working direct endpoint;
  current direct fetch returns HTTP 404.
- BTI: activate the already-committed atomic-generation bundle only when an
  explicitly permitted extension lifecycle action is available, then rerun the
  15-minute API/UI/direct acceptance. No hard reset was performed here.

## 2026-08-21 five-book realtime recovery (CMD excluded)

### Commits and scope

- Recovery commit: `d2d7066` (`fix: harden five-book realtime recovery`).
- Exact ticket matching remains in `dca9a2a`; this recovery did not change CMD
  collection or matching semantics.
- Files in `d2d7066`:
  - `apps/chrome-extension/src/local-bridge.ts` and test
  - `apps/chrome-extension/src/network-observer.ts` and tests
  - `apps/chrome-extension/src/selection-price.ts` and test
  - `apps/chrome-extension/src/saba-selection-price.test.ts`
  - `apps/api/src/chrome-bridge/saba-ws-adapter.ts` and test
  - `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- Dirty CMD/reset files belonging to another task were not staged or committed.

### Corrections

- The extension bridge now replaces a half-open local WebSocket after 25 seconds
  without a server control message, so an API restart cannot leave all catalogs
  apparently connected but frozen.
- SABA promotes a DOM catalog without a socket only after two complete atomic
  generations have stable event coverage. A partial/viewport generation cannot
  replace the last complete catalog. Direct SABA checks now search the nested
  sportsbook frame instead of only the launcher document.
- BTI direct detail parsing now handles the provider's live `value`/`Count`
  array wrappers. A detail timeout is reported as
  `BTI_DETAIL_REQUEST_FAILED`, not a false identity `NOT_FOUND`.
- SABA/KSPORT recovery requests only a lightweight provider-socket baseline;
  it does not reload, close or navigate the provider tab.

### Verification

- Extension full suite: 28 files, **255/255 passed**; typecheck and build PASS.
- API focused five-book/data-plane suite: **70/70 passed**; typecheck PASS.
- Web exact matching/revision/StrictMode suite: **78 passed / 4 intentionally
  skipped**; typecheck PASS.
- `git diff --check`: PASS for the recovery commit.

### Current runtime evidence

- SABA direct AH: event `132214611`, market
  `132214611__1052429579`, selection
  `132214611__1052429579:home`; TOOL/direct both `-0.82 MALAY`, DOM `MATCH`
  in 227 ms.
- SABA direct TOTAL: event `132214611`, market
  `132214611__1050989298`, selection
  `132214611__1050989298:over`; TOOL/direct both `0.99 MALAY`, DOM `MATCH`
  in 6 ms. Evidence: `saba-direct-price-evidence-final-fixed.json`.
- BTI direct AH and TOTAL both returned `MATCH` from a fresh detail
  `IN_PAGE_FETCH` in 1,447 ms and 1,690 ms respectively. Evidence:
  `bti-direct-price-evidence-deployed.json`.
- Existing current-bundle evidence remains valid for APSPORT AH/TOTAL DOM
  `MATCH` and IM AH/TOTAL fresh GetSE `MATCH`.
- A 30-second post-deployment sample observed:

| Provider | Source sequence | Distinct catalog revisions | Event range | Quote range | Result |
|---|---:|---:|---:|---:|---|
| SABA | `221 -> 262` | 7 | 161-162 | 1406-1408 | PASS |
| IM | `283 -> 309` | 3 | 497 | 2436-2470 | PASS |
| APSPORT | `60 -> 70` | 7 | 29 | 62 | PASS |
| BTI | `809 -> 946` | 5 | 22-23 | 258-278 | PASS |
| SBOBET | `4868 -> 6731` | 1 | 25 | 286 | FAIL closed |

The SBOBET transport sequence above is not sportsbook proof. Inspection of the
attached KSPORT tab showed raw Volta messages (`t=current`, `t=top`) rather than
the required SBOBET sportsbook STOMP destinations. The catalog correctly
remains `ACTION_REQUIRED / PROVIDER_VALIDATION_FAILED`; stale persisted odds are
not treated as realtime. Software support for fragmented STOMP, duplicate and
out-of-order receipts, reconnect epochs and exact direct identity is covered by
tests, but this runtime cannot be marked PASS until the attached authenticated
tab is the actual KSPORT/SBOBET sportsbook product. Final truthful status for
the requested five providers is therefore **4/5 current runtime PASS**, not
5/5.

## 2026-08-21 CMD rerun and SBOBET OOPIF/heartbeat correction

### Corrected diagnosis

- The attached KSPORT tab is a real sportsbook shell. Its odds transport runs
  inside an OOPIF child CDP session on `wss://*.sb21.net/sport/.../websocket`.
  The root page also owns auxiliary Volta sockets; those are rejected and no
  longer allowed to select the catalog epoch.
- The current prematch partition uses destination
  `/topic/sports/1_11/today/ma/event/vi` and subscription
  `subSportHotMatch`; the adapter now accepts this together with the live
  partition and still waits for both partitions before publishing.
- A quiet, valid sportsbook socket sends SockJS/STOMP heartbeats. Previously
  those frames produced no decoded update, so the data plane falsely marked a
  healthy SBOBET catalog dead after the 20-second freshness interval. A
  liveness-only update now refreshes transport health only for the current,
  non-retired `/sport/` socket after a complete live+today baseline. It never
  republishes odds or creates a revision.

### Runtime evidence

- `sbobet-runtime-evidence-heartbeat-fix.json`: 60/60 bridge LIVE samples,
  60/60 provider ACTIVE samples, zero false-zero catalogs, source sequence
  `10474 -> 12810`, 30 catalog revision changes and 30 SBOBET WebSocket
  revisions. Multiple provider selection prices changed during the run.
- The currently deployed API stayed ACTIVE beyond the 20-second quiet-feed
  boundary. Focused adapter/data-plane tests are 40/40 PASS; API typecheck and
  build PASS.
- Direct SBOBET AH/TOTAL verification is still not credited in this section:
  the direct-price runtime probe timed out. Catalog realtime and direct-price
  verification are separate acceptance gates.

### CMD current blocker

- The exact CMD tab was rerun, but the provider page rendered `System
  Maintenance`. A subsequent 30-second sample had 30/30 bridge LIVE samples
  and sequence `110 -> 118`, while the catalog revision stayed unchanged and
  no quote changed. The displayed 172-event catalog is retained stale data,
  not current provider odds.
- CMD therefore remains `ACTION_REQUIRED / PROVIDER_VALIDATION_FAILED` until
  the provider tab serves its sportsbook again. No collector change can
  manufacture realtime prices from the maintenance page.

## 2026-08-21 Fabet canonical-origin migration

- Reset/login now uses `https://fabet.monster/`; successful renewal also
  migrates the legacy encrypted parent entry and trusted hostname from
  `fabet.com` to `fabet.monster` without changing the saved credentials.
- Verification: 99/99 focused API tests PASS; API typecheck and build PASS.
- Runtime Reset started at `1787297611711` and completed at `1787297698189`.
  The Fabet parent became ACTIVE on `fabet.monster`, and fresh Football
  launches were captured for SABA, IM, SBOBET, APSPORT and BTI.
- The same Reset was still FAILED at the Chrome replacement/freshness gate:
  `CHROME_BRIDGE_REFRESH_INCOMPLETE:CMD,SBOBET` and
  `CHROME_BRIDGE_TAB_REPLACEMENT_INCOMPLETE:CMD,KSPORT,TSPORT,BTI`.
  After completion SABA, IM, APSPORT and BTI catalogs were ACTIVE; CMD and
  SBOBET were ACTION_REQUIRED. Do not report this runtime as 6/6.

### KSPORT Reset follow-up

- Commit `a42a327` removes the false dependency on a signed-in Fabet portal
  tab inside user Chrome. When the API's isolated Fabet browser has already
  captured a fresh tokenized KSPORT launch, the extension falls back to that
  launch only for `FABET_PORTAL_TAB_UNAVAILABLE`; other portal failures still
  fail closed.
- Runtime Reset `1787298288093` created KSPORT tab `2105812446`. Its source
  stayed LIVE and sequence advanced `0 -> 161 -> 1052 -> 2794`; SBOBET changed
  from ACTION_REQUIRED to ACTIVE and its catalog acquiredAt continued to
  advance. The final Reset error was only
  `CHROME_BRIDGE_REFRESH_INCOMPLETE:CMD`, matching the provider maintenance
  page. SBOBET/KSPORT passed this Reset.

## 2026-08-21 disable implicit Cloudflare/WARP during Reset

- Root cause: Windows implicitly enabled `FABET_LOCAL_WARP_AUTH` when the
  variable was absent, so every Reset called the WARP connection path before
  Fabet authentication. This contradicted the operator's no-Cloudflare mode.
- WARP is now opt-in only: both server configuration and auth-egress creation
  require the explicit value `FABET_LOCAL_WARP_AUTH=1`. An absent value or `0`
  leaves Reset on direct authentication and never invokes WARP.
- TDD evidence: the new regression first failed with
  `DIRECT,WARP_SOCKS`, then passed with `DIRECT` only. Focused WARP/session
  suite: 17/17 PASS; API typecheck and build PASS.
- Runtime dev evidence: WARP was manually disconnected and the persistent
  repository `cloudflared` tunnel was stopped. During a real Reset started at
  `1787299102740`, WARP remained `Disconnected` across repeated observations
  for more than three minutes and the `cloudflared` process count remained 0.
  Reset provider completion is a separate gate and is not claimed here.

## 2026-08-21 KSPORT reset race and portal bootstrap follow-up

- Fixed the readiness race where KSPORT's real today destination
  `/topic/sports/1_11/today/ma/event/vi` completed after the generic
  five-second source window. KSPORT now gets a bounded ten-second window while
  still requiring a complete live+today baseline. The regression fails at 20
  polls and passes at poll 25.
- KSPORT now prefers the signed-in `fabet.monster` portal handoff and only then
  consumes the fresh one-time launch URL in the stable child tab. The fallback
  Football selector also accepts structural `data-sport-id` variants while
  excluding `Bóng đá 2`/odds boosts. No Cloudflare/WARP path was enabled.
- Verification: Chrome extension focused tests 132/132 PASS, extension
  typecheck/build PASS; SBOBET/SABA adapter and data-plane tests 65/65 PASS,
  API typecheck PASS; `git diff --check` reports no whitespace errors.
- Runtime Reset `1787309495153 -> 1787309581413` still FAILED only at the
  SBOBET catalog gate. KSPORT tab `2105813265` remained attached and heartbeat
  sequence advanced, but it rendered only the `Yêu thích của tôi` shell,
  emitted no `/sport/` WebSocket frame, and same-tab `/api/v2/getEvent`
  attempts resolved against `zenandfe.com` with HTTP 404. Therefore SBOBET is
  **not accepted as realtime** in this runtime; the remaining failure is the
  provider bootstrap/handoff, not STOMP decoding or the reset wait race.
- A delayed final child (`2105813277`) subsequently emitted a real sportsbook
  baseline: catalog became FRESH with 25 events/164 quotes and source sequence
  reached 341. A 50-second observation then caught the exact remaining fault:
  the source stopped at sequence 341 after roughly 16 seconds and both source
  and catalog became STALE. This disproves stable recovery; do not treat the
  short FRESH interval as acceptance.
- The extension now preserves the KSPORT child observer across an unrecognized
  outer-shell navigation only after `hasCompleteKsportBaseline` is true. This
  addresses the observed detach-without-`WS_STATE CLOSED` path while still
  rejecting Volta/error shells before a baseline exists. Focused extension
  verification is now 145/145 PASS.
- Runtime Reset `1787309842056 -> 1787309927052` did not provide a sportsbook
  baseline at all: source `chrome:KSPORT:2105813305` only emitted shell
  heartbeats and the prior catalog remained STALE. The preservation branch
  therefore could not be exercised on this provider run, and stable SBOBET
  recovery remains unverified/FAIL.
