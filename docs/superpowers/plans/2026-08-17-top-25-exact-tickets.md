# Top 25 Exact Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the 25 highest-ROI real exact two-book football tickets across all visible mapped events and deploy the verified build.

**Architecture:** Add a pure global ticket flattener/ranker beside the existing per-event ranking. The page consumes these ranked ticket items directly so one event may contribute multiple rows, while selection still pins the parent event and exact ticket. Existing mapping, settlement and two-provider fail-closed rules remain unchanged.

**Tech Stack:** TypeScript, React 19, Decimal, Vitest, Vite, local Node stack, Cloudflare Tunnel.

## Global Constraints

- Never fabricate tickets or pad with one-book observations.
- Apply selected providers and Live/Pre-match filters before ranking.
- Sort by ROI descending and cap at 25.
- Preserve exact event, market, line, settlement and opposing-outcome validation.
- Deploy only after focused tests, web typecheck, production build and local HTTP verification pass.

---

### Task 1: Global exact-ticket ranking

**Files:**
- Modify: `apps/web/src/watch/ranked-tickets.ts`
- Test: `apps/web/src/watch/ranked-tickets.test.ts`

**Interfaces:**
- Consumes: `readonly RankedEvent[]`
- Produces: `topRankedTicketItems(events, limit)` returning `{ event: RankedEvent; ticket: RankedTicket }[]`

- [ ] **Step 1: Write the failing test** proving multiple tickets from one event are retained, ROI is descending, null/one-provider plans are excluded and the result is capped at 25.
- [ ] **Step 2: Run `npm.cmd test --workspace @tool-chenh/web -- --run src/watch/ranked-tickets.test.ts` and verify RED because `topRankedTicketItems` is absent.**
- [ ] **Step 3: Implement the pure flatten/filter/deduplicate/sort/slice function using `Decimal`.**
- [ ] **Step 4: Re-run the focused test and verify GREEN.**

### Task 2: Render ticket rows and preserve selection

**Files:**
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Test: `apps/web/src/pages/live-catalog-page.test.tsx`

**Interfaces:**
- Consumes: `topRankedTicketItems(rankedEvents, 25)`
- Produces: 0–25 ticket cards; click pins the parent event and sets `highlightTicketKey` to the selected ticket.

- [ ] **Step 1: Write failing page tests** proving one event can render two ticket cards, ROI order is global, only 25 cards render, and click selects the exact ticket.
- [ ] **Step 2: Run the focused page test and verify RED under the current one-card-per-event rendering.**
- [ ] **Step 3: Replace `displayEvents` with ticket items, derive each card summary from its exact ticket, and pass the ticket key through `watch`.**
- [ ] **Step 4: Re-run page and ranking tests and verify GREEN.**

### Task 3: Verify local and deploy

**Files:**
- No production source changes unless verification exposes a regression.

- [ ] **Step 1: Run all web tests, web typecheck and web production build.**
- [ ] **Step 2: Restart only the managed local stack required to load the new build and verify `/football-live` returns HTTP 200.**
- [ ] **Step 3: Inspect the rendered local page for up to 25 ROI-descending exact ticket rows without invented one-book entries.**
- [ ] **Step 4: Deploy through the existing Cloudflare Tunnel workflow and verify the public football URL returns HTTP 200.**
- [ ] **Step 5: Record exact test counts, local/public URLs and any real-source limitation in the handoff.**

