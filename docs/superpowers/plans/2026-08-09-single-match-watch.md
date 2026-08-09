# Single-match Live Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only match-detail screen that sequentially samples a real provider catalog, shows current odds/status, and persists an exact change timeline without inventing a second provider or placing bets.

**Architecture:** A pure TypeScript diff module compares two filtered event snapshots and produces safe watcher events. A React match-detail component owns a non-overlapping polling loop and bounded local persistence, while `LiveCatalogPage` owns list/detail navigation. The existing authenticated catalog endpoint remains the only data source; G2 vs TH appears only after a verified LoL catalog adapter returns it.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing `@tool-chenh/contracts`, browser `localStorage`.

## Global Constraints

- Monitoring is read-only: no wager endpoint, bet button, or automatic action.
- Never persist or render tokens, cookies, launch URLs, credentials, authorization headers, or raw account IDs in watcher logs.
- Poll sequentially one second after the preceding request settles; never overlap catalog reads.
- Store at most 200 newest watcher events per provider event.
- Emit a candidate balance-window event only from two distinct verified providers and the existing exact opportunity engine.
- With CMD alone, label the view `Single-provider observation — cross-book timing unavailable`.
- Do not synthesize G2 vs TH or any other event absent from a verified live feed.

---

### Task 1: Pure snapshot diff and bounded log

**Files:**
- Create: `apps/web/src/watch/match-watch.ts`
- Create: `apps/web/src/watch/match-watch.test.ts`

**Interfaces:**
- Consumes: `LiveCatalogResponse` and provider event/market/quote contracts.
- Produces: `MatchSample`, `MatchWatchEntry`, `sampleMatch`, `diffMatchSamples`, and `boundWatchEntries`.

- [ ] **Step 1: Write the failing identity and movement tests**

Create fixtures for one event with `FT_1X2` quotes and assert exact entries for `2.1 -> 2.05`, `OPEN -> SUSPENDED`, `SUSPENDED -> OPEN`, event disappearance, unrelated-event filtering, and no entries for unchanged samples. Assert entries contain provider, public event/market/selection IDs, safe match labels, observation/detection times, and elapsed sample milliseconds, but no account ID or response object.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/match-watch.test.ts`

Expected: FAIL because `match-watch.ts` does not exist.

- [ ] **Step 3: Implement the minimum pure model**

Define discriminated entry kinds `ODDS_CHANGED | MARKET_SUSPENDED | MARKET_REOPENED | QUOTE_SUSPENDED | QUOTE_REOPENED | EVENT_MISSING | POLL_FAILED | STALE`. `sampleMatch(catalog, eventId)` returns only the selected event and its markets/quotes. `diffMatchSamples(previous, current, detectedAtMs)` compares stable market and selection keys and emits only transitions. `boundWatchEntries(entries, 200)` returns the newest 200 entries deterministically.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the Task 1 command and require every exact literal assertion to pass.

- [ ] **Step 5: Commit Task 1**

Run: `git add apps/web/src/watch && git commit -m "feat: detect live match quote changes"`

### Task 2: Safe persistent watcher state

**Files:**
- Create: `apps/web/src/watch/watch-storage.ts`
- Create: `apps/web/src/watch/watch-storage.test.ts`

**Interfaces:**
- Consumes: a provider/event storage identity and `MatchWatchEntry[]`.
- Produces: `loadWatchEntries`, `saveWatchEntries`, `clearWatchEntries`, and `watchStorageKey`.

- [ ] **Step 1: Write failing storage tests**

Use a fake `Storage` to prove round-trip persistence, malformed JSON fail-closed behavior, maximum 200 rows, event isolation, and rejection of unknown fields. Include canary token/cookie/launch URL/account-ID strings in malformed input and assert none survive a subsequent save.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/watch-storage.test.ts`

- [ ] **Step 3: Implement schema-checked persistence**

Use a versioned key `fieldline:match-watch:v1:<provider>:<providerEventId>`. Parse an explicit allowlist of watcher fields, return `[]` on any invalid record, cap writes at 200, and remove only the selected match key on clear.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the Task 2 command and require all tests to pass.

- [ ] **Step 5: Commit Task 2**

Run: `git add apps/web/src/watch/watch-storage* && git commit -m "feat: persist safe match watch logs"`

### Task 3: Match-detail watcher UI and sequential polling

**Files:**
- Create: `apps/web/src/components/match-watch-detail.tsx`
- Create: `apps/web/src/components/match-watch-detail.test.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: selected `ProviderEvent`, initial `LiveCatalogResponse`, `CatalogApiLike`, account ID kept only in component memory, and Task 1/2 helpers.
- Produces: `MatchWatchDetail` with start/stop/clear controls, current provider table, health summary, and timeline.

- [ ] **Step 1: Write failing detail-view tests**

Assert `View & watch` switches from list to a detail heading, current selections align under a CMD provider column, a second-source placeholder says `Awaiting verified second provider`, and a clear warning says `Single-provider observation — cross-book timing unavailable`. Assert there is no button whose accessible name matches `bet|wager|place`.

- [ ] **Step 2: Write failing polling tests with deferred promises**

Use fake timers and controlled `CatalogApiLike.read` promises. Prove the next read is not called while the prior read is pending, starts one second after settlement, displays an odds-change row and suspension row, changes to `STALE`/`ERROR` on failure without deleting prior evidence, stops all future reads, and clears only the selected log after confirmation-free `Clear log`.

- [ ] **Step 3: Run focused UI tests and confirm RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/components/match-watch-detail.test.tsx src/pages/live-catalog-page.test.tsx`

- [ ] **Step 4: Implement the match-detail component**

Use an effect-scoped stopped flag and one timeout handle. Start from the accepted initial snapshot, schedule `catalogApi.read(accountId)` only after the previous promise settles, filter the selected event, append Task 1 transitions, persist via Task 2, and clean up timeout/state on unmount or Stop. Render provider cards horizontally, status badges, exact observation age/sample interval, and a newest-first semantic list with `aria-live="polite"` for new changes.

- [ ] **Step 5: Wire list/detail navigation**

On `View & watch`, set `event` and `account` query parameters using `history.replaceState`; render `MatchWatchDetail`. On `Back to matches`, remove the query parameters and return to the already loaded list. On initial load with matching query parameters, load the account catalog and open the event only if the returned event exists; otherwise show a safe missing-event message.

- [ ] **Step 6: Add responsive presentation**

Add scoped classes for the dark detail header, provider grid, strong odds cells, red suspended state, green reopened state, yellow candidate/health warning, and two-column desktop/stacked mobile timeline. Preserve keyboard focus and horizontal overflow for provider columns.

- [ ] **Step 7: Run focused UI tests and confirm GREEN**

Run the Task 3 command, then `npm.cmd run typecheck --workspace @tool-chenh/web`.

- [ ] **Step 8: Commit Task 3**

Run: `git add apps/web/src/components/match-watch-detail* apps/web/src/pages/live-catalog-page* apps/web/src/styles.css && git commit -m "feat: add single-match live watch screen"`

### Task 4: Live smoke monitor and operator evidence

**Files:**
- Create: `scripts/smoke-watch-match.mjs`
- Modify: `docs/operator/live-session-setup.md`

**Interfaces:**
- Consumes: local API base URL, an active account selected from the public redacted account list, optional public event ID, and bounded duration.
- Produces: stdout JSON-lines containing only safe match/market/selection/status/change/timing fields and a final sample/change summary.

- [ ] **Step 1: Write a failing dry-run test through extracted pure formatting helpers**

Feed two sanitized catalog snapshots to the script helper and assert one safe odds-change JSON line, one suspension line, and no account/session/token/URL fields.

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test scripts/smoke-watch-match.test.mjs`.

- [ ] **Step 3: Implement the bounded live smoke script**

Select only an event genuinely returned by `/api/catalog/accounts/:id`, prefer live events, poll sequentially, log safe diffs, stop after the requested duration, and report honestly when zero changes occur. Refuse to use fixture mode and never call a wager route.

- [ ] **Step 4: Verify dry-run and document operation**

Run the Task 4 test. Document the detail route, log meanings, CMD Football limitation, G2 vs TH LoL requirement, and distinction between one-provider detection interval and verified two-provider change delay.

- [ ] **Step 5: Run one real bounded observation**

With the local LIVE server and active account, monitor a returned event for at least two minutes. Record safe output only. If no change occurs, retain the sample count and zero-change result; do not edit fixtures or fabricate transitions.

- [ ] **Step 6: Commit Task 4**

Run: `git add scripts/smoke-watch-match* docs/operator/live-session-setup.md && git commit -m "test: add real match watch smoke monitor"`

### Task 5: Full verification and safety review

**Files:**
- Review: all files changed by Tasks 1–4.

**Interfaces:**
- Consumes: complete implementation.
- Produces: verified read-only feature and evidence-backed limitation report.

- [ ] **Step 1: Run web verification**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run && npm.cmd run typecheck --workspace @tool-chenh/web && npm.cmd run build --workspace @tool-chenh/web`.

- [ ] **Step 2: Run workspace verification**

Run: `npm.cmd run verify && npm.cmd run build`.

- [ ] **Step 3: Run security and diff checks**

Run secret-pattern scans against changed files, `git diff --check`, and verify no wager route/control was introduced.

- [ ] **Step 4: Inspect the detail page with a real or live-shaped accepted snapshot**

Verify desktop and narrow layouts, readable provider columns, status colors plus text labels, keyboard controls, and that stale/suspended states cannot be mistaken for an actionable window.

- [ ] **Step 5: Commit any verification-only corrections**

If corrections were required, commit them with `fix: harden live match watcher`; otherwise leave the verified implementation commits unchanged.
