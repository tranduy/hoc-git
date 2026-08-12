# Exact Two-Way Market Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exact full-time totals to the existing two-book monitor while preserving fail-closed mapping, ranking, and preflight behavior.

**Architecture:** Keep provider decoders unchanged because SABA/SBOBET/APSPORT/BTI already expose normalized `FT_TOTAL` markets. Extend the single UI focus predicate to allow only full-time half-goal totals with the exact `OVER|UNDER` domain; the existing semantic row key, settlement grouping, ranker, stake planner, and preflight coordinator then consume the row unchanged.

**Tech Stack:** TypeScript, React, Vitest, Zod contracts, exact decimal stake planner.

## Global Constraints

- Never accept three-way markets, quarter lines, missing lines, duplicate semantic markets, mismatched settlement, stale/suspended quotes, or incomplete outcome domains.
- Football totals require `FT_TOTAL / FULL_TIME / x.5 / OVER|UNDER`.
- This change must not call execution, arm, submit, wager, or provider history APIs.
- Maximum five ranked tickets per event and 20,000 VND verified worst-case-profit gate remain unchanged.

---

### Task 1: Exact full-time total eligibility

**Files:**
- Modify: `apps/web/src/catalog/comparison.test.ts`
- Modify: `apps/web/src/catalog/comparison.ts`

**Interfaces:**
- Consumes: `isFocusedTwoWayTicket(cell: ComparisonCell): boolean`
- Produces: verified and observed `ComparisonRow` values for exact `FT_TOTAL` markets.

- [ ] Add a failing test asserting two providers with `FT_TOTAL`, `FULL_TIME`, line `2.5`, settlement `football-regulation-including-added-time`, and `OVER|UNDER` produce one observed row and one verified row.
- [ ] Add failing table cases proving line `2.25`, a missing line, `HOME|AWAY`, differing lines, and differing settlement profiles do not produce verified total rows.
- [ ] Run `npm.cmd test --workspace @tool-chenh/web -- src/catalog/comparison.test.ts` and verify the valid-total case fails because `rows` is empty.
- [ ] Extend the Football branch of `isFocusedTwoWayTicket` with exactly two allowed shapes: existing `FT_AH/HOME|AWAY` and new `FT_TOTAL/OVER|UNDER`; both require `FULL_TIME` and `isHalfGoalLine(line)`.
- [ ] Run the focused comparison test and verify all cases pass.
- [ ] Commit only the comparison source/test changes with message `feat: compare exact full-time totals`.

### Task 2: End-to-end ranking and presentation regression

**Files:**
- Modify: `apps/web/src/watch/ranked-tickets.test.ts`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/components/match-watch-detail.tsx`

**Interfaces:**
- Consumes: exact `ComparisonRow` with `marketType="FT_TOTAL"` and `OVER|UNDER` quotes.
- Produces: Vietnamese total label, current provider prices, calculated stakes/profits, and unchanged verified-green/toast gates.

- [ ] Add a failing component regression with one exact shared `FT_TOTAL 2.5` row and assert the page shows `Tài/Xỉu toàn trận`, both provider columns, both current odds, and neutral state before preflight.
- [ ] Add a ranking regression proving a verified profitable total sorts ahead of a larger unverified movement and still counts toward the five-row limit.
- [ ] Run the two focused test files and verify the label/presentation assertion fails.
- [ ] Replace the Football-only hard-coded `Chấp toàn trận` labels with a pure label mapping: `FT_AH -> Chấp toàn trận`, `FT_TOTAL -> Tài/Xỉu toàn trận`, `SERIES_WINNER -> Thắng series`; unknown types display their normalized market type but cannot enter the focused row pipeline.
- [ ] Run comparison, ranking, live catalog, alert, fixed-stake, and coordinator focused tests.
- [ ] Commit source/tests with message `feat: show exact total price gaps`.

### Task 3: Verification and schedule checkpoint

**Files:**
- Modify: `F:/0. PROJECT/tool-chenh/proccess.md`

- [ ] Run full web tests: `npm.cmd test --workspace @tool-chenh/web -- --run`.
- [ ] Run `npm.cmd run typecheck --workspace @tool-chenh/web`.
- [ ] Run `npm.cmd run build --workspace @tool-chenh/web`.
- [ ] Run `git diff --check` and inspect `git status --short` without touching unrelated BTI/history work.
- [ ] Append a checkpoint to `proccess.md` recording exact supported markets, exclusions, test counts, and that no live execution was enabled.
- [ ] Commit the checkpoint and any remaining owned changes without staging unrelated work.
