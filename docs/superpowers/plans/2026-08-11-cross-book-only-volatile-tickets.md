# Cross-book-only Volatile Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only exact two-provider Football/LoL tickets, keep their live prices visible, and prioritize movement-created executable profit.

**Architecture:** Tighten the existing comparison projection so event and market intersections require two unique providers and unambiguous semantic identity. Preserve immediate quote samples in the lag tracker, expose a deterministic rank score, and render provider/category diagnostics separately from the main cross-book list.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Decimal.js, Playwright provider extraction.

## Global Constraints

- Main list requires at least two unique selected providers on the exact event and exact ticket.
- Football supports exact full-time half-goal Asian handicap with `HOME|AWAY`; LoL supports exact two-team series winner.
- No fuzzy match may become executable or visible as a cross-book row.
- Immediate movement compares consecutive accepted snapshots; no five-minute window.
- Rank by realized rounded worst-case profit, then immediate movement magnitude, then start time.
- Green requires two fresh `OPEN` books and worst-case profit `>= 20000 VND` from a `100000 VND` lower-odds base leg.
- Read-only; no wager submission.

---

### Task 1: Enforce exact, unambiguous cross-book intersections

**Files:**
- Modify: `apps/web/src/catalog/comparison.ts`
- Modify: `apps/web/src/catalog/comparison.test.ts`

**Interfaces:**
- `buildComparisonEvents(catalogs)` produces only `observedRows` whose cells contain at least two unique providers.
- Add `ComparisonDiagnostics` counts for single-provider events, unmatched events, unmatched markets, and ambiguous duplicate markets.
- A provider may contribute at most one cell per exact semantic row.

- [ ] **Step 1: Write failing tests** proving one-provider rows are absent, two exact providers remain visible without profit, mismatched lines/outcomes do not join, and duplicate same-provider semantic markets reject the provider row.
- [ ] **Step 2: Run** `npm.cmd test --workspace @tool-chenh/web -- --run src/catalog/comparison.test.ts` and confirm RED.
- [ ] **Step 3: Implement** provider-deduplicated event/market intersection and diagnostics without fuzzy fallback.
- [ ] **Step 4: Run** the focused tests and `npm.cmd run typecheck --workspace @tool-chenh/web`.
- [ ] **Step 5: Commit** with `git commit -m "fix: require exact cross-book ticket intersections"`.

### Task 2: Track immediate movement and deterministic priority

**Files:**
- Modify: `apps/web/src/watch/lag-signal-tracker.ts`
- Modify: `apps/web/src/watch/lag-signal-tracker.test.ts`
- Modify: `apps/web/src/catalog/comparison.ts`

**Interfaces:**
- Add per-row movement summary containing `absoluteDelta`, provider, selection, previous odds, current odds, and accepted timestamp.
- Sort signals by worst-case profit, then absolute immediate delta, then trigger time.
- Neutral comparison ordering uses immediate delta then event start.

- [ ] **Step 1: Write failing tests** for consecutive-snapshot delta, no five-minute wait, profit-first ordering, delta tie-break, and removal on stale/suspended/missing quotes.
- [ ] **Step 2: Run** tracker/comparison tests and confirm RED.
- [ ] **Step 3: Implement** exact Decimal delta recording and ranking while retaining the existing `5000 ms` freshness and `20000 VND` threshold.
- [ ] **Step 4: Run** focused tests and web typecheck.
- [ ] **Step 5: Commit** with `git commit -m "feat: rank exact tickets by executable gap"`.

### Task 3: Render only real cross-book tickets and clear diagnostics

**Files:**
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/components/match-watch-detail.tsx`
- Modify: `apps/web/src/components/match-watch-detail.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Main cards require `observedRows.length > 0` and two provider cells.
- Each row shows the exact market/line once and one real price cell per provider.
- The status strip shows category readiness and rejected/mapping-review counts.

- [ ] **Step 1: Write failing UI tests** for hiding one-book events, visible neutral two-book rates, exact provider labels, strongest row first, profitable green state, and ten-second toast.
- [ ] **Step 2: Run** focused page/detail tests and confirm RED.
- [ ] **Step 3: Implement** the cross-book-only hierarchy and diagnostic copy; do not render provider-only fallback rows.
- [ ] **Step 4: Run** all web tests and typecheck.
- [ ] **Step 5: Commit** with `git commit -m "feat: focus monitor on exact cross-book tickets"`.

### Task 4: Verify provider category routing and live behavior

**Files:**
- Modify when required by a failing regression: `apps/api/src/providers/**`
- Modify: `docs/operator/live-session-setup.md`

**Interfaces:**
- Every selected account reports category-ready versus category-unavailable explicitly.
- Catalog requests preserve provider identity and requested Football/LoL category.

- [ ] **Step 1: Add failing API/provider tests** for Football versus LoL routing and for a selected but unavailable category.
- [ ] **Step 2: Run** the focused API/provider tests and confirm RED only where routing is defective.
- [ ] **Step 3: Apply** the smallest extraction/routing fix supported by captured provider evidence.
- [ ] **Step 4: Run** `npm.cmd run verify`, `npm.cmd run build`, and `git diff --check`.
- [ ] **Step 5: Inspect** `/api/accounts` and selected live catalogs without printing tokens; confirm cross-book rows only when exact intersections exist.
- [ ] **Step 6: Update** operator documentation with the strict visibility, ranking, and diagnostics rules.
- [ ] **Step 7: Commit** with `git commit -m "docs: explain strict cross-book monitoring"`.

