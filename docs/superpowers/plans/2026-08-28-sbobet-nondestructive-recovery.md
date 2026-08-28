# SBOBET Non-Destructive Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent SBOBET automatic recovery from navigating its provider tab and make KSPORT same-tab recovery rebuild a replayable catalog baseline.

**Architecture:** Keep the provider-specific destructive-recovery guard at the web API boundary, where AUTO and MANUAL are already distinguished. Tighten KSPORT readiness at the extension retention boundary so the existing tab-selection recovery runs whenever replayable Live/Today evidence is missing.

**Tech Stack:** TypeScript, Vitest, Chrome extension CDP observer, React web client

**Spec:** `docs/superpowers/specs/2026-08-28-sbobet-nondestructive-recovery-design.md`

## Global Constraints

- Do not change collectors or recovery behavior for the other five providers.
- Do not automatically navigate the SBOBET/KSPORT tab.
- Preserve the existing manual hard-refresh endpoint and UI cooldown.
- Use TDD: observe each new regression test fail before production changes.

---

### Task 1: Guard SBOBET automatic recovery

**Files:**
- Modify: `apps/web/src/api/provider-source-recovery.test.ts`
- Modify: `apps/web/src/api/provider-source-recovery.ts`

**Interfaces:**
- Consumes: `ProviderSourceRecoveryApi.recover(provider, mode)`
- Produces: SBOBET AUTO snapshot-only recovery; unchanged MANUAL hard refresh

- [x] **Step 1: Write the failing test**

Add a test whose attached KSPORT snapshot response lacks `baseline`, assert `recover("SBOBET", "AUTO")` rejects with `FRESH_BASELINE_NOT_CONFIRMED`, and assert the fetcher was called exactly twice.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @tool-chenh/web -- --run apps/web/src/api/provider-source-recovery.test.ts`

Expected: the test fails because current code makes a third hard-refresh request and resolves.

- [x] **Step 3: Write minimal implementation**

In `recover`, rethrow an automatic snapshot error for `SBOBET`; preserve hard fallback for other providers and all MANUAL calls.

- [x] **Step 4: Run test to verify it passes**

Run the same focused web test and expect PASS.

### Task 2: Require a replayable KSPORT baseline

**Files:**
- Modify: `apps/chrome-extension/src/network-observer.test.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`

**Interfaces:**
- Consumes: `NetworkObserver.hasCompleteKsportBaseline(sourceId)` and `ensureCompleteKsportBaseline(source)`
- Produces: readiness derived from retained current-generation frames; missing-partition provider tab selection

- [x] **Step 1: Write the failing test**

Create a complete Live/Today KSPORT stream, add enough attributed catalog deltas to evict the original full Live snapshot, assert readiness becomes false, then call `ensureCompleteKsportBaseline` and assert it selects Live.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @tool-chenh/chrome-extension -- --run apps/chrome-extension/src/network-observer.test.ts`

Expected: readiness incorrectly remains true and no period is selected.

- [x] **Step 3: Write minimal implementation**

Require both tracker completion and `ksportFramesContainCompleteBaseline` for readiness. In `ensureCompleteKsportBaseline`, derive partition state from retained frames so an evicted partition is selected again.

- [x] **Step 4: Run test to verify it passes**

Run the same focused extension test and expect PASS.

### Task 3: Build and runtime verification

Before building, cover the production KSPORT dedicated-worker topology: add regression tests for pre-existing worker discovery, worker-first socket recovery, bound worker HTTP results, replaced-worker rejection, authenticated native Live/Today fallback and its eight-second retry bound. No recovery path may issue `Page.reload`.

**Files:**
- Generated: `apps/chrome-extension/dist/**`
- Generated: `apps/web/dist/**`

**Interfaces:**
- Consumes: updated web and extension source
- Produces: deployable local builds and verified SBOBET runtime evidence

- [x] **Step 1: Run focused and full package checks**

Run both focused tests, package tests and package typechecks.

- [x] **Step 2: Build deployable artifacts**

Run the web and chrome-extension builds.

- [x] **Step 3: Verify runtime**

Reload the extension/runtime as required, request an SBOBET in-page snapshot, and inspect pipeline diagnostics for a new baseline, decoded events/markets and fresh catalog timestamps. Do not claim recovery from tab traffic alone.

- [x] **Step 4: Review and commit**

Review the diff for provider isolation, then commit the tested fix.
