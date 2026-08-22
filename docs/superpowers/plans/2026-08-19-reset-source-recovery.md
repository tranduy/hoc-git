# Reset Source Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Reset sàn` detect, reload, or reopen every configured Chrome provider source and verify fresh catalogs from all six providers.

**Architecture:** Add an installation-scoped `ENSURE_SOURCE` bridge control. Resolve fresh launch URLs in the API, let the extension navigate or create the requested provider tab, then require post-reset catalog timestamps from all configured providers.

**Tech Stack:** TypeScript, Zod, Fastify WebSocket, Chrome Extensions MV3, React, Vitest

**Spec:** `docs/superpowers/specs/2026-08-19-reset-source-recovery-design.md`

## Global Constraints

- Never persist or log provider launch URLs.
- Never close or modify unrelated user tabs.
- Only open credential-free HTTPS URLs recognized for the requested lobby.
- Reset success requires fresh CMD, IM, SABA, SBOBET, APSPORT, and BTI catalogs.

---

### Task 1: Installation-level ensure-source protocol

**Files:**
- Modify: `packages/contracts/src/chrome-bridge.ts`
- Test: `packages/contracts/src/chrome-bridge.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-control-plane.ts`
- Test: `apps/api/src/chrome-bridge/chrome-bridge-control-plane.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-route.ts`
- Test: `apps/api/src/chrome-bridge/chrome-bridge-route.test.ts`

**Interfaces:**
- Produces: `ENSURE_SOURCE { version: 1; lobby: ChromeLobbyId; url: string }`
- Produces: `ChromeBridgeControlPlane.ensureLobby(lobby, url): number`

- [ ] Add failing schema and control-plane tests for installation-level delivery with no attached source.
- [ ] Run the focused tests and verify failure.
- [ ] Implement the strict message and installation socket registration/deduplicated delivery.
- [ ] Run the focused tests and verify success.

### Task 2: Extension tab recovery

**Files:**
- Modify: `apps/chrome-extension/src/local-bridge.ts`
- Test: `apps/chrome-extension/src/local-bridge.test.ts`
- Create: `apps/chrome-extension/src/source-tab-recovery.ts`
- Test: `apps/chrome-extension/src/source-tab-recovery.test.ts`
- Modify: `apps/chrome-extension/src/background.ts`

**Interfaces:**
- Consumes: `ENSURE_SOURCE`
- Produces: `ensureSourceTab(lobby, url)` which navigates, adopts, or creates an inactive provider tab and attaches the observer.

- [ ] Add failing bridge dispatch and navigate/adopt/create recovery tests.
- [ ] Run the focused tests and verify failure.
- [ ] Implement URL validation and tab recovery, then connect it to the background bridge.
- [ ] Run the focused tests and verify success.

### Task 3: Full six-source reset orchestration

**Files:**
- Modify: `apps/api/src/chrome-bridge/provider-source-refresh.ts`
- Test: `apps/api/src/chrome-bridge/provider-source-refresh.test.ts`
- Modify: `apps/api/src/sessions/session-services.ts`
- Modify: `apps/api/src/catalog-refresh.ts`
- Test: `apps/api/src/catalog-refresh.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: fresh Fabet launch resolver and JIT CMD launch resolver.
- Produces: ensure commands for CMD, IM, SABA, KSPORT, TSPORT, and BTI.

- [ ] Add failing tests requiring missing tabs to receive ensure commands and requiring fresh CMD status.
- [ ] Run the focused tests and verify failure.
- [ ] Resolve all launch URLs before commands, send ensure commands, and restore CMD to the required status set.
- [ ] Run the focused tests and verify success.

### Task 4: Immediate reset UI and deployment verification

**Files:**
- Modify: `apps/web/src/components/maintenance-controls.tsx`
- Test: `apps/web/src/components/maintenance-controls.test.tsx`

**Interfaces:**
- Produces: one-click reset with immediate progress feedback.

- [ ] Replace the confirmation-flow test with a failing one-click progress test.
- [ ] Run the component test and verify failure.
- [ ] Start reset directly from the button and retain visible failure/status reporting.
- [ ] Run focused tests, typecheck, build, and full relevant test suites.
- [ ] Deploy the stack, activate the rebuilt extension, close one owned source tab, invoke reset, and verify the source is reopened with a fresh catalog.

