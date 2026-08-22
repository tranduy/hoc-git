# Fail-Closed Opposing Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block ambiguous live-event pairs and prevent unverified/stale estimates from being presented or alerted as safe opportunities.

**Architecture:** Tighten the existing comparison boundary before rows are constructed, then enforce verified/fresh state at ranking and alert boundaries. Keep observation rows visible but neutral.

**Tech Stack:** TypeScript, React, Vitest, Decimal.js.

## Global Constraints

- Fail closed when independent live-event identity is missing.
- Do not change real-money execution; the application remains read-only.
- Preserve exact half-goal complementary-domain validation.

---

### Task 1: Live event identity

**Files:**
- Modify: `apps/web/src/catalog/comparison.ts`
- Test: `apps/web/src/catalog/comparison.test.ts`

- [x] Add a regression in which live events share participants but have missing score/period, different competitions, and incompatible kickoff evidence; assert two separate groups and no cross-book row.
- [x] Run the focused test and record the expected failure because the existing matcher accepts every live kickoff.
- [x] Add normalized competition and independent-evidence checks to `compatibleEventOrientation`.
- [x] Run the comparison suite and confirm valid exact kickoff, discriminator, and complete score/period cases still pass.

### Task 2: Verified-only opportunity signaling

**Files:**
- Modify: `apps/web/src/watch/ranked-tickets.ts`
- Modify: `apps/web/src/watch/profit-alert-tracker.ts`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Test: `apps/web/src/watch/ranked-tickets.test.ts`
- Test: `apps/web/src/watch/profit-alert-tracker.test.ts`

- [x] Change tests so observation tickets sort by event time, never alert, and stale verified tickets never alert.
- [x] Run the focused tests and record failures against the current ROI-based observation ranking and observation alert behavior.
- [x] Rank verified evidence ahead of observation without using observation ROI as opportunity priority.
- [x] Apply profitable UI tone only to verified states and require `VERIFIED_PROFIT` plus fresh provider accounts before alerting.
- [x] Run focused ranking, alert, and page tests.

### Task 3: Verification

**Files:**
- Test only.

- [x] Run focused Web comparison/stake/ranking/alert/component suites.
- [x] Run adapter and observed-catalog source suites.
- [x] Audit current live comparison rows for exact domain, line, settlement, provenance, distinct providers, and complementary outcomes.
- [x] Run typecheck and `git diff --check` before reporting status.
