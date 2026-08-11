# Stable Fast SABA Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed-delay SABA/CMD DOM sampling with condition-based stable sampling and publish only exact two-outcome half-goal handicap markets.

**Architecture:** A pure orchestration helper owns probe/select/wait decisions and is injected into the Playwright reader. The extractor filters unsupported bet types at the DOM boundary, while normalization performs the final half-goal check. The React page uses a 250 ms non-overlapping refresh loop.

**Tech Stack:** TypeScript, Playwright, React, Vitest.

## Global Constraints

- Observe-only: never click odds or wager controls.
- Never publish an empty or structurally changing snapshot.
- Stale data is display-only and signal-ineligible.
- No new dependency.

---

### Task 1: Stable condition-based catalog sampling

**Files:**
- Modify: `apps/api/src/providers/cmd/cmd-browser-manager.ts`
- Test: `apps/api/src/providers/cmd/cmd-browser-manager.test.ts`

**Interfaces:**
- Produces: `readStableFootballCatalog({ read, select, wait }, options)` returning the newest structurally stable `CmdCatalogInputRecord[]`.

- [x] Write tests proving an already usable table is not clicked and a staged table is accepted only after structural stability.
- [x] Run the focused test and record RED.
- [x] Implement structural fingerprints, 75 ms condition polling, two stable samples and one category selection. Reuse a previously verified fingerprint for a one-probe hot path and coalesce concurrent reads per session.
- [x] Run the focused test and record GREEN.

### Task 2: Focus the provider boundary on required tickets

**Files:**
- Modify: `apps/api/src/providers/browser-protocol-inspector.ts`
- Modify: `apps/api/src/providers/cmd/cmd-observed-catalog.ts`
- Test: `apps/api/src/providers/cmd/cmd-observed-catalog.test.ts`
- Test: `apps/api/src/providers/saba/saba-observed-catalog.test.ts`

**Interfaces:**
- `extractCmdCatalogRecords(..., allowedBetTypeIds)` returns only groups whose exact `data-bt` is allowed.
- `CmdObservedCatalogReader.read()` publishes only market type `FT_AH` with an exact `.5` line.

- [x] Write tests rejecting totals, 1X2 and quarter-goal handicap markets.
- [x] Run focused tests and record RED.
- [x] Add source filtering and final normalized half-goal filtering.
- [x] Run focused tests and record GREEN.

### Task 3: Faster non-overlapping monitoring

**Files:**
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Test: `apps/web/src/pages/live-catalog-page.test.tsx`

**Interfaces:**
- The page starts another refresh every 250 ms only when `refreshInFlight` is false.

- [x] Change the polling regression to expect a second sample at 250 ms and record RED.
- [x] Change the interval constant to 250 ms.
- [x] Run focused web tests and record GREEN.

### Task 4: Verification and live probe

**Files:**
- No production files.

- [x] Run API and web focused tests and typechecks.
- [x] Run `npm.cmd run verify` and `npm.cmd run build`.
- [x] Restart only the validated localhost API process if required.
- [x] Sample SABA repeatedly and verify no empty catalog publication, stable event structure and improved latency.
- [x] Commit the implementation without credentials, tokens, profiles or local vault data.
