# Durable Live Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the last verified Football and LoL catalogs visible through provider failures and API restarts while automatically refreshing sources and keeping every stale snapshot ineligible for executable signals.

**Architecture:** A fail-soft disk store persists only validated provider catalogs with atomic replacement. The catalog route owns one background refresh loop per resolved provider source, restores persisted data as `STALE`, and promotes it to `FRESH` only after a successful live read. The web comparison surface may render retained stale rows, but its signal, movement, ranking, preflight, toast, and green-state pipelines consume fresh catalogs only.

**Tech Stack:** TypeScript, Fastify, React, Vitest, Node filesystem APIs.

## Global Constraints

- No real bet submission.
- Provider failures must never delete the last verified snapshot.
- Disk failures must never interrupt live collection.
- Restored snapshots are always `STALE` until a new provider read succeeds.
- Only `FRESH` catalogs can produce executable signals, preflight evidence, green cards, sounds, or profit toasts.

---

### Task 1: Durable catalog store

**Files:**
- Create: `apps/api/src/catalog/durable-catalog-store.ts`
- Test: `apps/api/src/catalog/durable-catalog-store.test.ts`

- [ ] Write failing tests for atomic save/load, corrupt-file fail-soft behavior, and source-key isolation.
- [ ] Run the focused test and confirm the missing store fails.
- [ ] Implement validated, atomic, best-effort persistence under the configured local application data directory.
- [ ] Run the focused test and API typecheck.

### Task 2: Background source collector and restart restore

**Files:**
- Modify: `apps/api/src/routes/catalog.ts`
- Modify: `apps/api/src/routes/catalog.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`

- [ ] Write failing route tests proving restored data is returned immediately as `STALE`, collection continues without another HTTP request, failed refresh retains data, and Fastify close stops timers.
- [ ] Run focused route tests and confirm failures are caused by missing persistence/collector behavior.
- [ ] Inject the store, start one coalesced refresh loop per source after discovery, persist every successful read, apply bounded retry backoff, and stop loops on application close.
- [ ] Run focused route tests and API typecheck.

### Task 3: Strict stale display-only boundary

**Files:**
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`

- [ ] Write failing UI regressions proving stale paired rows remain visible but cannot rank green, preflight, move, toast, or play sound.
- [ ] Run the focused web test and confirm the unsafe behavior fails.
- [ ] Separate display comparisons from fresh executable comparisons at the page boundary.
- [ ] Run focused web tests and web typecheck.

### Task 4: Restart and recovery verification

**Files:**
- Modify: `proccess.md`

- [ ] Run API catalog/store tests, web page tests, API/web typechecks, and builds.
- [ ] Restart the local API and confirm `/football-live` and `/lol-live` can render restored stale catalogs immediately, then become fresh after successful reads without manual reload.
- [ ] Run a bounded recovery soak and confirm one provider timeout does not blank other providers or stop later refreshes.
- [ ] Record exact evidence and remaining external provider limitations in `proccess.md`.
