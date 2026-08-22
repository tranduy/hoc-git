# Football Compact Dashboard Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Football the only primary dashboard, compact the ranked master/detail UI, and add a read-only action that focuses the exact provider ticket in an already attached Chrome tab without clicking an odd or creating a bet slip.

**Architecture:** Add a strict bridge control message carrying opaque provider identity, expose a gated API command, and let the Chrome extension perform an exact DOM lookup plus focus/scroll/highlight only. Keep ranking and comparison calculations unchanged; reshape only the Football presentation and navigation behavior. Fail closed whenever provider, event, market, or selection identity cannot be proven.

**Tech Stack:** TypeScript, React, Fastify, Chrome Extension APIs/CDP, Zod, Vitest.

---

## Task 1: Add the gated read-only provider-ticket command

**Files:**
- Modify: `packages/contracts/src/chrome-bridge.ts`
- Modify: `packages/contracts/src/chrome-bridge.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-route.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-route.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/chrome-bridge/chrome-bridge-route.test.ts`

- [x] Write failing contract tests for strict `FOCUS_SELECTION` controls with bounded source/provider/event/market/selection IDs.
- [x] Write failing API tests proving `ENABLE_OPEN_PROVIDER_TICKET=false` disables the feature and that unsupported/unattached providers fail closed.
- [x] Implement the strict message schema and a bridge connection registry that can target an attached source.
- [x] Add a read-only POST endpoint that sends the command and never performs wagering actions.
- [x] Expose feature availability to the web client without exposing credentials.
- [x] Run contracts and API focused tests/typechecks.

## Task 2: Focus and highlight an exact CMD ticket safely

**Files:**
- Modify: `apps/chrome-extension/src/local-bridge.ts`
- Modify: `apps/chrome-extension/src/local-bridge.test.ts`
- Modify: `apps/chrome-extension/src/background.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/chrome-extension/src/network-observer.test.ts`

- [x] Write failing extension tests for exact opaque-ID matching and unsupported-provider rejection.
- [x] Write a regression asserting the generated page action contains no `.click()` and does not dispatch pointer/mouse events.
- [x] Implement CMD-only tab activation and exact element lookup using captured provider IDs.
- [x] Scroll the proven selection into view and apply a temporary highlight; return a structured failure when it is absent or ambiguous.
- [x] Run extension focused tests/typecheck/build.

## Task 3: Replace the sidebar with the compact Football master/detail dashboard

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/components/ranked-ticket-table.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/styles.css`
- Modify: relevant tests under `apps/web/src/**/*.test.tsx`

- [x] Write failing UI tests proving the permanent sidebar is absent and `/` resolves to `/football-live`.
- [x] Write failing tests proving each entire ranked card opens detail and the redundant detail button/label is absent.
- [x] Write failing tests for compact card facts: teams, competition, providers, exact market/line, opposing odds, ROI, estimated profit, live/start time, and freshness.
- [x] Write failing tests for the gated `Mở kèo tại sàn` action and visible fail-closed feedback.
- [x] Implement a compact top control row and 58/42 master/detail layout with independent vertical scrolling and no page-level horizontal scrolling.
- [x] Wire the read-only focus action; never click an odd or submit a bet.
- [x] Run web tests/typecheck/build.

## Task 4: End-to-end verification and handoff

**Files:**
- Modify only if a verification regression requires a scoped fix.

- [x] Run workspace tests and typechecks for contracts, extension, API, and web.
- [x] Run production builds for all four workspaces.
- [x] Run `git diff --check` and inspect the final diff for credential leakage and accidental wagering actions.
- [x] Restart the local API/web processes and smoke-test `/football-live`.
- [x] Report exactly what is live, what is fail-closed, and whether Chrome must reload the unpacked extension once.
