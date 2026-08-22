# ROI Profit Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alert once per exact two-book ticket when estimated ROI is greater than 5%.

**Architecture:** Keep threshold and deduplication in `ProfitAlertTracker`; keep rendering, expiry, click handling, and audio invocation in `ProfitToastStack`. The page supplies current catalog freshness without removing stale informational alerts.

**Tech Stack:** TypeScript, React, Decimal, Vitest, Web Audio.

## Global Constraints

- ROI threshold is strictly greater than 5%.
- One alert per exact ticket identity per mounted dashboard session.
- Toast duration is 10 seconds and stale evidence is labelled display-only.
- Alert and audio failures cannot interrupt catalog monitoring.

---

### Task 1: ROI alert tracker

**Files:**
- Modify: `apps/web/src/watch/profit-alert-tracker.ts`
- Test: `apps/web/src/watch/profit-alert-tracker.test.ts`

- [ ] Add failing tests for the strict 5% boundary, observation alerts, and permanent session deduplication.
- [ ] Run the focused test and confirm the expected failures.
- [ ] Implement ROI filtering, freshness metadata, and seen-identity retention.
- [ ] Run the focused test and confirm it passes.

### Task 2: Toast lifetime and presentation

**Files:**
- Modify: `apps/web/src/components/profit-toast-stack.tsx`
- Test: `apps/web/src/components/profit-toast-stack.test.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`

- [ ] Add failing tests for 10-second expiry and fresh/stale copy.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Render freshness, keep alerts through stale transitions, and expire after 10 seconds.
- [ ] Run web tests, typecheck, and build.
