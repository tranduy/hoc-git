# Direct Football Data Plane Implementation Plan

> Execute inside the existing `feature/arbitrage-foundation` worktree. Do not reset unrelated dirty files and do not enable Execution or LoL.

**Goal:** Complete the direct hot path for every provider that can be proven today, beginning with IM, and record exact blockers for the remaining providers.

**Architecture:** Provider-specific bootstrap is separated from a long-lived Node data plane. Public endpoints run without portal sessions; authenticated endpoints consume only an encrypted, validated transport lease and fail closed when it expires.

**Tech stack:** TypeScript, Node fetch/WebSocket transport, Vitest, existing observed catalog readers and adapters.

---

### Task 1: Classify current provider endpoints

**Files:**
- Modify: `proccess.md`
- Reference: provider browser managers under `apps/api/src/providers/`

1. Probe known provider endpoints without credentials and record only status/content-type/byte count.
2. Classify IM, BTI, SBOBET, SABA, APSPORT and CMD as `PUBLIC_DIRECT`, `AUTH_DIRECT` or `PENDING_PROTOCOL`.
3. Add the evidence under B3 in `proccess.md` without creating a new top-level step.

### Task 2: Implement the authenticated IM direct transport with TDD

**Files:**
- Create: `apps/api/src/providers/im/im-football-direct-transport.test.ts`
- Create: `apps/api/src/providers/im/im-football-direct-transport.ts`
- Modify: `apps/api/src/providers/im/im-football-browser-manager.ts`

1. Write a failing test for an allowlisted HTTPS host/path, bounded timeout, exact POST body, replayable provider headers, schema validation and secret-safe errors.
2. Run the focused test and confirm the expected missing-feature failure.
3. Implement the minimal direct transport.
4. Re-run focused tests.
5. Wire the IM manager to prefer direct transport after learning a verified authenticated request shape; retain the browser response listener only as bootstrap/renewal fallback.
6. Add a regression proving subsequent reads use the Node transport and do not reload/read DOM.

### Task 3: Verify live independence and document remaining sources

**Files:**
- Modify: `proccess.md`

1. Run IM provider tests, API typecheck and API build.
2. Run three live IM reads after a valid provider transport lease is captured and close the portal page between bootstrap and replay; record event/market/quote counts, latency and freshness only.
3. Mark only verified work complete. Leave B3 open if any required provider is still `AUTH_DIRECT` or `PENDING_PROTOCOL`.
4. Record tonight's continuation in B3: encrypted transport lease for BTI/SBOBET/SABA, APSPORT API discovery, and CMD protocol discovery.
