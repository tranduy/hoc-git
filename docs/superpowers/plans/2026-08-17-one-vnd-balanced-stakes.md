# One-VND Balanced Stakes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Balance the two outcome profits to the nearest whole VND in the read-only calculator.

**Architecture:** Keep the exact-opposing-pair validation unchanged. Change only the display calculator's stake granularity and make candidate selection explicitly minimize outcome-profit imbalance before tie-breaking on worst-case profit.

**Tech Stack:** TypeScript, React, Decimal.js, Vitest.

## Global Constraints

- Do not weaken exact event, market, line, settlement, or opposing-selection validation.
- Executable provider constraints remain fail-closed.
- Calculated display stakes are whole VND values.

---

### Task 1: Whole-VND balancing

**Files:**
- Modify: `apps/web/src/watch/fixed-base-stake.ts`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/components/ranked-ticket-table.tsx`
- Test: `apps/web/src/watch/fixed-base-stake.test.ts`
- Test: `apps/web/src/components/ranked-ticket-table.test.tsx`

**Interfaces:**
- Consumes: `FixedBaseStakePolicy`, `buildObservedAnchoredStakeEstimate`.
- Produces: the existing `FixedBaseStakePlan` with whole-VND stakes and minimum profit imbalance.

- [x] **Step 1: Write failing calculator and input-step tests**
- [x] **Step 2: Run focused tests and verify the expected 1,000-VND rounding failure**
- [x] **Step 3: Set display stake step to 1 VND and rank candidates by absolute profit difference**
- [x] **Step 4: Run focused tests, full web tests, typecheck, and production build**
