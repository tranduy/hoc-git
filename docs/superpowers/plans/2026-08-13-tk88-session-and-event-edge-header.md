# TK88 Session and Event Edge Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse an explicitly owned TK88 Chromium session for its configured lounges and render a full-width two-book arbitrage list whose event headers show balanced ROI, profit, providers, odds and ticket identity.

**Architecture:** Extend the session contract with a distinct TK88 source, then bind catalog strategies explicitly rather than falling through Fabet. Keep all ranking arithmetic pure in the Web watch layer. The page renders only exact two-provider rows in the main list and keeps a sticky read-only balancing panel on the right.

**Tech Stack:** TypeScript, Zod, Fastify, Playwright persistent Chromium contexts, React, Decimal.js through `@tool-chenh/core`, Vitest.

## Global Constraints

- System remains read-only; never open a bet slip, enter a stake or submit a wager.
- Never expose cookie, token, password or complete launch URL in source, logs, API, UI, docs or fixtures.
- Main arbitrage list requires at least two fresh providers and one exact two-outcome row.
- Headline percentage is balanced worst-case ROI: `minimum outcome profit / total stake × 100`.
- Green/toast requires fresh OPEN legs, exact mapping, provider preflight and at least 20,000 VND verified worst-case profit.
- Preserve unrelated dirty execution/history work.

---

### Task 1: Exact two-book event summary and full-width UI

**Files:**
- Modify: `apps/web/src/watch/ranked-tickets.ts`
- Modify: `apps/web/src/watch/ranked-tickets.test.ts`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: existing `RankedEvent`, `RankedTicket`, `FixedBaseStakePlan` and exact `ComparisonEvent.rows`.
- Produces: `eventEdgeSummary(event: RankedEvent): EventEdgeSummary | null`, where `EventEdgeSummary` contains `ticketKey`, `roiPercent`, `worstCaseProfit`, `providers`, `odds`, `marketType`, `line`, `state`.

- [ ] **Step 1: Write failing pure ranking tests**

Add tests proving `eventEdgeSummary` selects the best exact plan, returns balanced ROI (`plan.roi × 100`), names both distinct providers and returns `null` for zero exact rows or a one-provider plan.

- [ ] **Step 2: Run the pure tests and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/ranked-tickets.test.ts`

Expected: FAIL because `eventEdgeSummary` does not exist.

- [ ] **Step 3: Implement the pure summary**

Use `Decimal` for ROI multiplication and validate `new Set(plan.legs.map(leg => leg.provider)).size >= 2`. Do not derive the headline from raw odds gap.

- [ ] **Step 4: Write failing page tests**

Add tests asserting:

```tsx
expect(screen.getByText("11.63%")).toBeTruthy();
expect(screen.getByText(/SABA.*SBOBET/u)).toBeTruthy();
expect(screen.getByText(/Estimated balanced profit/u)).toBeTruthy();
expect(screen.queryByText("Single Book FC vs One Source United")).toBeNull();
expect(screen.getByLabelText("Selected ticket balance")).toBeTruthy();
```

Also assert the event row exposes both odds and exact market/line without opening details.

- [ ] **Step 5: Run the page test and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/pages/live-catalog-page.test.tsx`

Expected: FAIL because single-provider events remain in the list, the headline is absent and the right panel has no compact balance summary.

- [ ] **Step 6: Implement the page and styles**

Filter main `rankedEvents` to `tickets.length > 0` and require each ticket summary to contain two providers. Render a compact event header with ROI, profit, provider pair, both odds and market/line. Populate the sticky right panel from the selected event's best ticket. Change `main` to `width: calc(100% - 224px); max-width: none` and use a desktop grid that consumes all remaining width; stack under `1180px`.

- [ ] **Step 7: Verify and commit Task 1**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/watch/ranked-tickets.test.ts src/pages/live-catalog-page.test.tsx src/components/ranked-ticket-table.test.tsx
npm.cmd run typecheck --workspace @tool-chenh/web
npm.cmd run build --workspace @tool-chenh/web
```

Commit only Task 1 files with `git commit -m "fix: show full-width two-book edge summaries"`.

---

### Task 2: Distinct TK88 session contract and encrypted registration

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Modify: `packages/contracts/src/schemas.test.ts`
- Modify: `apps/api/src/sessions/types.ts`
- Modify: `apps/api/src/sessions/session-manager.ts`
- Modify: `apps/api/src/sessions/session-manager.test.ts`
- Modify: `apps/web/src/pages/sessions-page.tsx`
- Modify: `apps/web/src/pages/sessions-page.test.tsx`

**Interfaces:**
- Produces: `SessionSource = "FABET_LOGIN" | "TK88_CHROME" | "MANUAL_PROVIDER_SESSION"`.
- Produces a TK88 profile registration/status path that stores only encrypted metadata/credentials already supported by the vault; API returns redacted status only.

- [ ] **Step 1: Write RED contract and manager tests**

Assert Zod accepts `TK88_CHROME`, redacted status round-trips it, and SessionManager keeps TK88 distinct from Fabet/manual records during list, renew and reset operations.

- [ ] **Step 2: Run contract/session tests and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts; npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/session-manager.test.ts`

- [ ] **Step 3: Implement minimal contract and manager support**

Extend only the enum/schema/allowlist and source-specific predicates. Fabet reset must not remove TK88; TK88 reset must not remove Fabet. No secret fields are added to public DTOs.

- [ ] **Step 4: Add and implement Sessions UI tests**

Assert the UI labels TK88 as `TK88 Chrome`, displays its redacted state and has an explicit reset action with confirmation. Do not render tokens/cookies.

- [ ] **Step 5: Verify and commit Task 2**

Run contract/API/Web focused tests and all three typechecks. Commit with `git commit -m "feat: add distinct TK88 browser sessions"`.

---

### Task 3: TK88 persistent browser and explicit lounge binding

**Files:**
- Create: `apps/api/src/sessions/tk88-browser.ts`
- Create: `apps/api/src/sessions/tk88-browser.test.ts`
- Modify: `apps/api/src/sessions/session-services.ts`
- Modify: `apps/api/src/catalog/catalog-source-registry.ts`
- Modify: `apps/api/src/catalog/catalog-source-registry.test.ts`
- Modify provider managers only for lounges proven to use TK88 during live inspection.

**Interfaces:**
- Produces: `Tk88BrowserAutomation.withLoungePage(identity, consume)` using one persistent profile rooted below `%LOCALAPPDATA%/tool-chenh/.auth/browser-profiles/tk88`.
- `identity` contains explicit provider/category/verified host-or-protocol evidence; it contains no token.
- Catalog source configuration gains an explicit strategy field: `"TK88_CHROME" | "FABET_LOGIN" | "DIRECT_SESSION"`.

- [ ] **Step 1: Write RED browser ownership tests**

Use a local Playwright test page to prove concurrent calls for two lounges do not navigate/close each other's pages, profile reuse survives another read, and navigation failure is reported as unavailable rather than zero events.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/tk88-browser.test.ts`

- [ ] **Step 3: Implement persistent TK88 browser manager**

Launch a visible persistent context, reuse pages by exact lounge identity, serialize only navigation for the same launcher page, and keep provider-page reads independent. Redact URLs in errors/logs.

- [ ] **Step 4: Write RED source-strategy tests**

Assert a TK88-configured pair cannot resolve a Fabet session, a Fabet pair cannot resolve TK88, and a missing exact TK88 session returns `CATALOG_SOURCE_UNAVAILABLE`.

- [ ] **Step 5: Implement explicit source binding**

Add strategy to supported pairs only after read-only live inspection proves which supplied lounge belongs to TK88. Do not bulk-label all providers as TK88. Reuse existing normalizers and exact provider/category validation.

- [ ] **Step 6: Verify and commit Task 3**

Run focused browser/registry/provider tests, API typecheck/build and secret-canary scans. Commit with `git commit -m "feat: read configured lounges through TK88 Chrome"`.

---

### Task 4: Read-only live acceptance, docs and full verification

**Files:**
- Modify: `F:/0. PROJECT/tool-chenh/proccess.md`
- Modify: `F:/0. PROJECT/tool-chenh/sảnh.md`
- Modify tests only if a live-observed schema requires a fail-closed decoder regression.

**Interfaces:**
- Consumes the TK88 session and event summary from Tasks 1–3.
- Produces an evidence table per source: strategy, session state, read state, event/market/quote counts, first-read latency and warm-read latency.

- [ ] **Step 1: Run read-only inspection from the existing TK88 profile**

For each supplied lounge, identify the page/provider/category using structural evidence, then capture only safe endpoint method/path shape and normalized counts. Never print query strings, headers, bodies, cookies or tokens.

- [ ] **Step 2: Run repeated catalog reads**

Verify at least three successive reads for each configured source and confirm quote timestamps or sequences advance. A visible working page plus parser failure must remain `SCHEMA_CHANGED/UNAVAILABLE`, not zero events.

- [ ] **Step 3: Verify the UI**

Open `/football-live` and `/lol-live`; confirm the main list has no one-provider cards, uses the full viewport, and every row exposes two providers, both prices, ROI percentage, balanced profit and ticket identity. Confirm stale sources cannot turn green.

- [ ] **Step 4: Run full verification**

Run:

```powershell
npm.cmd run verify
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

- [ ] **Step 5: Record evidence and commit**

Append exact pass counts and safe live counts to `proccess.md`; update `sảnh.md` with source strategy and verified coverage. Explicitly state remaining unsupported lounges. Commit documentation and any decoder regressions with `git commit -m "docs: record TK88 live catalog acceptance"`.
