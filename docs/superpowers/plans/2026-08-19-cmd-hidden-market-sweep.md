# CMD Hidden Market Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and then automate complete read-only hidden-market hydration for every current CMD Football event.

**Architecture:** Use the already authenticated FABET-owned CMD page. First probe one exact provider event while capturing sanitized HTTP/WebSocket evidence, then prefer a discovered detail endpoint or subscription; use bounded DOM detail navigation only when no protocol exists. Track event-level completion so catalog counts can never be mistaken for full coverage.

**Tech Stack:** TypeScript, Playwright/CDP, Fastify, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-all-exact-two-way-football-markets-design.md`

## Global Constraints

- OBSERVE/read-only only; never click `.c-odds`, a selection, ticket, bet-slip, stake, or submit control.
- Every action is scoped to one exact `providerEventId` and has a hard timeout.
- Captured evidence is sanitized to request host/path class, transport direction, and structural market IDs; no token, cookie, header, query, or payload secret is returned or persisted.
- No full CMD sweep until one-event before/after evidence proves how detail markets are loaded.
- No production behavior without a failing regression test first.

---

### Task 1: One-event CMD protocol probe

**Files:**
- Create: `apps/api/src/providers/cmd/cmd-hidden-market-probe.ts`
- Create: `apps/api/src/providers/cmd/cmd-hidden-market-probe.test.ts`
- Create: `apps/api/src/routes/cmd-hidden-market-probe.ts`
- Create: `apps/api/src/routes/cmd-hidden-market-probe.test.ts`
- Modify: `apps/api/src/sessions/session-services.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Produces: `CmdHiddenMarketProbe.probe(providerEventId)` returning sanitized before/after market IDs, safe control descriptors, and HTTP/WebSocket evidence.

- [ ] Write failing tests proving exact event selection, unsafe-control exclusion, local-only route validation, and bounded capture.
- [ ] Run focused tests and confirm RED for the missing probe.
- [ ] Implement the minimal read-only probe and wire it to the existing FABET CMD page.
- [ ] Run focused tests GREEN, restart the API, and probe one current CMD event.
- [ ] Record which endpoint/subscription or DOM-only transition actually loads hidden markets.

### Task 2: Provider-native CMD detail hydrator

**Files:**
- Create: `apps/api/src/providers/cmd/cmd-hidden-market-sweeper.ts`
- Create: `apps/api/src/providers/cmd/cmd-hidden-market-sweeper.test.ts`
- Modify the CMD bridge adapter/extractor selected by Task 1 evidence.

**Interfaces:**
- Consumes: the exact endpoint, sent WebSocket subscription, or bounded DOM transition proven in Task 1.
- Produces: one-event `COMPLETE | RETRY | UNSUPPORTED` hydration with exact raw market evidence.

- [ ] Write a failing sanitized regression fixture from the one-event probe.
- [ ] Implement the smallest endpoint/subscription replay, falling back to safe fixed-point DOM expansion only if Task 1 proves DOM-only loading.
- [ ] Prove no odds/ticket controls can be selected and all waits/concurrency are bounded.
- [ ] Run focused and provider adapter suites GREEN.

### Task 3: CMD-first coverage coordinator

**Files:**
- Create: `apps/api/src/catalog/hidden-market-coverage.ts`
- Create: `apps/api/src/catalog/hidden-market-coverage.test.ts`
- Modify: `apps/api/src/sessions/session-services.ts`
- Modify: `apps/api/src/routes/catalog.ts`

**Interfaces:**
- Produces: CMD event states `DISCOVERED -> QUEUED -> FETCHING -> COMPLETE`, retry/failure reasons, and a local coverage report.

- [ ] Write failing tests for CMD priority, one in-flight CMD detail job, two stable census passes, retry bounds, and restart checkpoint recovery.
- [ ] Implement the coordinator without opening additional tabs.
- [ ] Run until the current census reports `complete == total`, `queued == 0`, and `unknownCodes == 0`, or report exact unsupported events/reasons.
- [ ] Run API, extension, contracts, adapters, web tests, typechecks, and root build before claiming completion.
