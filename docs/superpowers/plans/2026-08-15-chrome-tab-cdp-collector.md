# Chrome Tab Traffic Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Observe the seven authenticated sportsbook tabs in the user's current Chrome profile, decode fresh football odds, and feed exact two-book comparisons into the existing dashboard without launching provider headless browsers.

**Architecture:** A local Manifest V3 extension attaches to user-selected tabs through `chrome.debugger`, redacts CDP Network traffic, and sends bounded envelopes to a loopback-only Fastify WebSocket. The API fingerprints and decodes each lobby through isolated adapters, maintains per-source freshness, converts accepted records into existing provider catalogs, and disables each legacy headless source only after live acceptance.

**Tech Stack:** Chrome Manifest V3, Chrome Debugger/CDP Network domain, TypeScript 5.9, Fastify 5, `@fastify/websocket`, Zod, Vitest, React 19.

## Global Constraints

- Branch: `feat/chrome-tab-cdp-collector`.
- Football only; LoL collection remains disabled.
- Read only: never click an odds element, open a bet slip, submit a wager, automate login, or handle CAPTCHA.
- Runtime secrets from `sảnh.md` never enter code, fixtures, logs, snapshots, or error strings.
- Observe only explicitly attached tabs; extension installation and first attachment remain user-visible Chrome actions.
- Signal TTL is 20 seconds; remove quotes not refreshed for 45 seconds.
- Only exactly mapped two-outcome Asian Handicap quarter/half-line tickets may rank or alert.
- Stale or ambiguous data can be displayed diagnostically but cannot become green, rank as profitable, or emit a toast.
- Never fabricate matches to meet the seven-row dashboard target.
- New code follows RED/GREEN TDD; no production behavior is added before its failing test.
- Do not stage, revert, or rewrite unrelated existing worktree changes.

---

### Task 1: Shared bridge protocol and secret redaction

**Files:**
- Create: `packages/contracts/src/chrome-bridge.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Test: `packages/contracts/src/chrome-bridge.test.ts`
- Create: `apps/chrome-extension/package.json`
- Create: `apps/chrome-extension/tsconfig.json`
- Create: `apps/chrome-extension/src/redactor.ts`
- Test: `apps/chrome-extension/src/redactor.test.ts`

**Interfaces:**
- Produces: `ChromeLobbyId`, `ChromeBridgeEnvelope`, `ChromeBridgeControlMessage`, their strict Zod schemas, and `redactNetworkEnvelope(value): RedactedNetworkEnvelope`.
- Consumes: existing `Category` and `ProviderId` contracts.

- [ ] **Step 1: Write failing strict-schema tests**

```ts
it("rejects an unknown lobby and an envelope containing raw URL query data", () => {
  expect(ChromeBridgeEnvelopeSchema.safeParse({ ...validEnvelope, lobby: "UNKNOWN" }).success).toBe(false);
  expect(ChromeBridgeEnvelopeSchema.safeParse({ ...validEnvelope,
    request: { hostname: "example.test", pathnameClass: "/feed", query: "token=secret" }
  }).success).toBe(false);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm test --workspace @tool-chenh/contracts -- chrome-bridge.test.ts`

Expected: FAIL because the bridge schemas do not exist.

- [ ] **Step 3: Implement the strict discriminated protocol**

Define lobby IDs `IM`, `BTI`, `TSPORT`, `KSPORT`, `SABA`, `CMD`, and `SBO`; envelope transports `WS_FRAME`, `HTTP_RESPONSE`, and `TAB_STATE`; bounded payload encoding; source/tab sequence; wall and monotonic timestamps; sanitized hostname/pathname class; and control messages `HELLO`, `ACK`, `REJECT`, and `SOURCE_STATE`.

- [ ] **Step 4: Write and run failing redaction tests**

```ts
it.each(["token", "operatorToken", "cookie", "authorization", "session", "loginname"])(
  "removes %s recursively and from URLs", (secretKey) => {
    expect(JSON.stringify(redactNetworkEnvelope(secretFixture(secretKey)))).not.toMatch(/super-secret/u);
  }
);
```

Run: `npm test --workspace @tool-chenh/chrome-extension -- redactor.test.ts`

Expected: FAIL because `redactNetworkEnvelope` does not exist.

- [ ] **Step 5: Implement recursive redaction and size limits**

The returned value contains only hostname, normalized pathname class, allow-listed response metadata, and sanitized payload. It drops query/hash/user-info, headers, cookies, and token-like keys case-insensitively and rejects payloads over 256 KiB before serialization.

- [ ] **Step 6: Verify Task 1**

Run:

```powershell
npm test --workspace @tool-chenh/contracts -- chrome-bridge.test.ts
npm test --workspace @tool-chenh/chrome-extension -- redactor.test.ts
npm run typecheck --workspace @tool-chenh/contracts
npm run typecheck --workspace @tool-chenh/chrome-extension
```

Expected: all commands exit 0 and the tests prove raw secrets are absent.

- [ ] **Step 7: Commit Task 1 files only**

```powershell
git add packages/contracts/src/chrome-bridge.ts packages/contracts/src/chrome-bridge.test.ts packages/contracts/src/index.ts packages/contracts/src/schemas.ts apps/chrome-extension/package.json apps/chrome-extension/tsconfig.json apps/chrome-extension/src/redactor.ts apps/chrome-extension/src/redactor.test.ts
git commit -m "feat: define secure Chrome traffic bridge"
```

---

### Task 2: Manifest V3 tab attachment and bounded network observer

**Files:**
- Create: `apps/chrome-extension/public/manifest.json`
- Create: `apps/chrome-extension/public/popup.html`
- Create: `apps/chrome-extension/src/lobby-signatures.ts`
- Create: `apps/chrome-extension/src/tab-registry.ts`
- Create: `apps/chrome-extension/src/network-observer.ts`
- Create: `apps/chrome-extension/src/local-bridge.ts`
- Create: `apps/chrome-extension/src/background.ts`
- Create: `apps/chrome-extension/src/popup.ts`
- Create: `apps/chrome-extension/scripts/build.mjs`
- Test: `apps/chrome-extension/src/lobby-signatures.test.ts`
- Test: `apps/chrome-extension/src/tab-registry.test.ts`
- Test: `apps/chrome-extension/src/network-observer.test.ts`
- Test: `apps/chrome-extension/src/local-bridge.test.ts`

**Interfaces:**
- Consumes: Task 1 bridge contracts and `redactNetworkEnvelope`.
- Produces: an unpacked extension in `apps/chrome-extension/dist`, `TabRegistry`, `NetworkObserver`, and `LocalBridge`.

- [ ] **Step 1: Write failing lobby recognition tests**

Use sanitized host fixtures derived from `sảnh.md`; prove query tokens never participate in matching and that domain hints alone produce `CANDIDATE`, not `TRUSTED`.

Run: `npm test --workspace @tool-chenh/chrome-extension -- lobby-signatures.test.ts`

Expected: FAIL because recognition is absent.

- [ ] **Step 2: Implement domain-hint recognition**

Store only hostname/path patterns. Do not copy full URLs from `sảnh.md`. Return lobby candidates with a required traffic-fingerprint confirmation flag.

- [ ] **Step 3: Write failing attachment lifecycle tests**

Cover explicit attach, duplicate attach idempotence, detach on tab close/navigation, automatic reattach after navigation, and no attachment to unmatched tabs.

Run: `npm test --workspace @tool-chenh/chrome-extension -- tab-registry.test.ts`

Expected: FAIL because `TabRegistry` is absent.

- [ ] **Step 4: Implement the tab registry and popup**

The popup lists seven lobbies with `FOUND`, `ATTACHED`, `LIVE`, `STALE`, or `ERROR`; its Attach button calls `chrome.debugger.attach` only for the selected tab. Persist only lobby-to-tab preference and never persist a URL containing a query.

- [ ] **Step 5: Write failing Network event tests**

Cover WebSocket text/binary frames, XHR/fetch response retrieval only after `loadingFinished`, response-body failure isolation, focus/lifecycle commands, nested-scroll discovery without odds clicking, and bounded event size.

Run: `npm test --workspace @tool-chenh/chrome-extension -- network-observer.test.ts`

Expected: FAIL because `NetworkObserver` is absent.

- [ ] **Step 6: Implement the observer**

Enable `Network`, apply focus/lifecycle emulation, forward `webSocketFrameReceived`, and retrieve allow-listed XHR/fetch bodies. Scrolling and collapsed-league expansion must use DOM predicates and explicit non-odds selectors; no coordinate click is permitted.

- [ ] **Step 7: Write failing backpressure/reconnect tests**

Prove one connection, ordered sequence, a 1 MiB total queue limit, oldest diagnostic-frame eviction before quote frames, reconnect backoff, ACK removal, and full resync after reconnect.

Run: `npm test --workspace @tool-chenh/chrome-extension -- local-bridge.test.ts`

Expected: FAIL because `LocalBridge` is absent.

- [ ] **Step 8: Implement the localhost bridge and build output**

Connect only to `ws://127.0.0.1:4310/api/chrome-bridge`; require the locally configured installation key; copy the manifest/popup into `dist`; emit ES modules without inline secrets.

- [ ] **Step 9: Verify and commit Task 2**

Run:

```powershell
npm test --workspace @tool-chenh/chrome-extension
npm run typecheck --workspace @tool-chenh/chrome-extension
npm run build --workspace @tool-chenh/chrome-extension
rg -n "operatorToken=|token=|loginname=|Tesqedix" apps/chrome-extension/dist
```

Expected: tests/build pass and `rg` returns no secret match.

Commit only Task 2 files with `git commit -m "feat: observe authenticated Chrome sportsbook tabs"`.

---

### Task 3: Loopback ingestion, source lifecycle, and sanitized capture/replay

**Files:**
- Create: `apps/api/src/chrome-bridge/chrome-bridge-registry.ts`
- Create: `apps/api/src/chrome-bridge/chrome-bridge-route.ts`
- Create: `apps/api/src/chrome-bridge/capture-store.ts`
- Create: `apps/api/src/chrome-bridge/replay.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/chrome-bridge/chrome-bridge-registry.test.ts`
- Test: `apps/api/src/chrome-bridge/chrome-bridge-route.test.ts`
- Test: `apps/api/src/chrome-bridge/capture-store.test.ts`
- Create: `scripts/chrome-bridge-diag.mjs`

**Interfaces:**
- Consumes: strict Task 1 envelopes.
- Produces: `ChromeBridgeRegistry.ingest(envelope)`, `listSources()`, `subscribe(listener)`, loopback WebSocket `/api/chrome-bridge`, diagnostics GET `/api/chrome-bridge/sources`, and sanitized replay fixtures.

- [ ] **Step 1: Write failing route/security tests**

Test loopback/origin/key rejection, malformed/oversized envelopes, duplicate/lower sequence, gap quarantine, source-isolated failure, ACK, and reconnect baseline recovery.

Run: `npm test --workspace @tool-chenh/api -- chrome-bridge-route.test.ts`

Expected: FAIL because the route is absent.

- [ ] **Step 2: Implement ingestion and per-source lifecycle**

Use a maximum 256 KiB frame, constant-time installation-key comparison, per-tab sequence state, and statuses `ATTACHED`, `LIVE`, `STALE`, `ERROR`, `DISCONNECTED`. No rejected envelope mutates accepted state.

- [ ] **Step 3: Write failing capture-store tests**

Prove best-effort writes cannot fail ingestion, captures are redacted again server-side, filenames contain no source URL, rotation is bounded, and replay preserves ordering/timestamps without secrets.

Run: `npm test --workspace @tool-chenh/api -- capture-store.test.ts`

Expected: FAIL because capture storage is absent.

- [ ] **Step 4: Implement bounded sanitized captures and diagnostics**

Write JSONL only when recon mode is explicitly enabled. Keep runtime traffic in a bounded in-memory ring. `chrome-bridge-diag.mjs` prints per-lobby frame counts, decoder counts, last age, and rejection reason without payload values.

- [ ] **Step 5: Verify and commit Task 3**

Run API focused tests, API typecheck, and a secret scan over generated test captures. Commit Task 3 files only as `feat: ingest Chrome traffic on loopback bridge`.

---

### Task 4: Adapter fingerprinting and normalized catalog pipeline

**Files:**
- Create: `apps/api/src/chrome-bridge/adapter.ts`
- Create: `apps/api/src/chrome-bridge/adapter-router.ts`
- Create: `apps/api/src/chrome-bridge/chrome-catalog-reader.ts`
- Create: `apps/api/src/chrome-bridge/quote-lifecycle.ts`
- Modify: `apps/api/src/catalog/live-catalog-bridge.ts`
- Test: `apps/api/src/chrome-bridge/adapter-router.test.ts`
- Test: `apps/api/src/chrome-bridge/chrome-catalog-reader.test.ts`
- Test: `apps/api/src/chrome-bridge/quote-lifecycle.test.ts`

**Interfaces:**
- Produces: `ChromeTrafficAdapter`, `AdapterFingerprint`, `DecodedCatalogUpdate`, and a catalog reader compatible with the current `ObservedProviderCatalog` pipeline.
- Consumes: Task 3 accepted envelopes and existing provider event/market/quote schemas.

- [ ] **Step 1: Write failing fingerprint-routing tests**

Prove that hostname alone cannot activate an adapter; hostname plus protocol/schema markers can; conflicting fingerprints quarantine only that tab; same-family K-SPORT/SBO sources cannot form a cross-book pair.

- [ ] **Step 2: Implement strict adapter routing**

Maintain distinct lobby source IDs while mapping to canonical provider/family identities. Require a stable fingerprint before emitting any catalog update.

- [ ] **Step 3: Write failing quote lifecycle tests**

Cover snapshot replacement, ordered delta application, gap quarantine, market removal, suspended odds, 20-second signal TTL, 45-second deletion, and live/prematch stream separation.

- [ ] **Step 4: Implement normalized catalog publication**

Publish only schema-valid events/markets/quotes. Preserve source IDs in catalog metadata so the UI can display all seven lobbies while the core blocks same-family pairing.

- [ ] **Step 5: Verify and commit Task 4**

Run focused tests plus contracts/core/API typechecks. Commit as `feat: normalize Chrome traffic into live catalogs`.

---

### Task 5: Seven replay-backed football adapters

**Files:**
- Create: `apps/api/src/chrome-bridge/adapters/saba.ts`
- Create: `apps/api/src/chrome-bridge/adapters/im.ts`
- Create: `apps/api/src/chrome-bridge/adapters/bti.ts`
- Create: `apps/api/src/chrome-bridge/adapters/tsport.ts`
- Create: `apps/api/src/chrome-bridge/adapters/ksport.ts`
- Create: `apps/api/src/chrome-bridge/adapters/cmd.ts`
- Create: `apps/api/src/chrome-bridge/adapters/sbo.ts`
- Test: one adjacent `.test.ts` per adapter
- Create: sanitized fixtures under `fixtures/chrome-bridge/<lobby>/`

**Interfaces:**
- Each adapter implements `ChromeTrafficAdapter.decode(envelope): readonly DecodedCatalogUpdate[]`.
- Each update provides stable event/market/selection IDs, participant names, competition, start time, live state, score/clock evidence, Asian Handicap period/signed line, raw display line, decimal odds, status, source timestamp, and update kind/sequence.

- [ ] **Step 1: Capture a sanitized initial snapshot and at least one change for every open lobby**

Run:

```powershell
node scripts/chrome-bridge-diag.mjs --capture --seconds 90
```

Expected: each available attached lobby reports frames and writes only redacted fixtures. A lobby with no traffic is explicitly recorded as `NO_TRAFFIC`; it is not declared implemented.

- [ ] **Step 2: Implement SABA and IM through separate RED/GREEN cycles**

Each failing test must assert exact decoded event ID, real participant names, market identity, signed line, two selections, decimal odds, and a later price/status change from its own sanitized capture.

- [ ] **Step 3: Implement BTI and T-SPORT through separate RED/GREEN cycles**

Use their own schema declaration or response shape; never infer positional field meanings without evidence from the capture.

- [ ] **Step 4: Implement K-SPORT and SBO through separate RED/GREEN cycles**

Prove their bookmaker-family identity and prevent K-SPORT/SBO from being treated as independent books when the settlement family is the same.

- [ ] **Step 5: Implement CMD through its own RED/GREEN cycle**

Cover its current schema rather than reusing hard-coded historic field positions. If the server sends a schema declaration, decode records against that declaration.

- [ ] **Step 6: Add cross-adapter invariant tests**

Reject exact score, 1X2 draw markets, unsupported lines, fewer/more than two selections, non-football categories, non-decimal normalized odds, contradictory event lifecycle evidence, and payloads with unknown schema revisions.

- [ ] **Step 7: Verify and commit Task 5**

Run all seven adapter replay suites, API typecheck, and a recursive secret scan over fixtures. Commit only adapters/tests/redacted fixtures as `feat: decode seven live football lobby feeds`.

---

### Task 6: Exact source-aware comparison and dashboard cutover

**Files:**
- Modify: `apps/web/src/api/catalog-sources.ts`
- Modify: `apps/web/src/api/catalog.ts`
- Modify: `apps/web/src/catalog/comparison.ts`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/components/ranked-ticket-table.tsx`
- Modify: `apps/web/src/components/profit-toast-stack.tsx`
- Modify: `apps/web/src/styles.css`
- Test: corresponding existing web test files
- Modify: `apps/api/src/sessions/session-services.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/sessions/session-services.test.ts`

**Interfaces:**
- Consumes: fresh source-aware catalogs from Task 4/5.
- Produces: source health cards, up to 25 ROI-sorted exact pairs, a minimum-seven shortfall diagnostic, and 10-second profitable toasts.

- [ ] **Step 1: Write failing source-aware comparison tests**

Prove all seven lobby labels can appear independently, exact same event/period/type/signed line is required, same-family sources never pair, stale sources never rank, and results sort by worst-case ROI descending.

- [ ] **Step 2: Implement source-aware comparison without weakening mapping**

Retain canonical provider identity for settlement rules while using source ID for columns and tab health. Never match solely because one participant token overlaps.

- [ ] **Step 3: Write failing UI tests**

Cover fresh/stale/error/disconnected diagnostics, fewer-than-seven real rows, 25-row cap, decimal display capped at five places, negative red cards, positive upcoming neutral cards, positive live green cards, hover/click detail selection, and 10-second stacked toasts.

- [ ] **Step 4: Implement the compact dashboard cutover**

Remove legacy session/preflight execution controls from this detection screen. Do not show stale snapshots as current matches. Keep the existing base-stake calculation as read-only estimation.

- [ ] **Step 5: Disable legacy collectors per accepted Chrome source**

In session services, prefer the Chrome catalog for an accepted lobby and do not start its headless reader. Retain an explicit environment rollback switch `CHROME_BRIDGE_DISABLED=1`; never merge headless and Chrome updates for the same source.

- [ ] **Step 6: Verify and commit Task 6**

Run full web tests/typecheck/build and focused API session/catalog tests. Commit as `feat: cut football dashboard over to Chrome feeds`.

---

### Task 7: Live acceptance, resource bounds, and operator handoff

**Files:**
- Modify: `scripts/start-live-stack.mjs`
- Create: `scripts/chrome-bridge-soak.mjs`
- Modify: `run.md`
- Modify: `proccess.md`
- Modify: `HUONG-DAN-KY-THUAT.md`
- Test: `scripts/chrome-bridge-soak.test.mjs`

**Interfaces:**
- Produces: one command to start the API/web bridge, an unpacked-extension path, a 10-minute live soak report, and an explicit per-lobby acceptance matrix.

- [ ] **Step 1: Write failing stack/readiness tests**

Require API/web readiness plus bridge status without requiring a bookmaker tab. Prove detached startup does not spawn provider headless browsers when Chrome bridge is active.

- [ ] **Step 2: Implement startup and concise operator instructions**

`run.md` contains only the commands to start the stack, extension directory to load, and dashboard URL. The technical guide documents attach/detach and diagnostics without embedding current domains containing session material.

- [ ] **Step 3: Write and run the live soak**

For 10 minutes, record per-lobby frame/update counts, latest age, decoding failures, API RSS, Chrome extension queue size, exact mappings, and price changes. Assert no unbounded growth and no provider headless process owned by this project.

- [ ] **Step 4: Verify visible behavior against one live changing market**

Confirm the source page and dashboard show the same participants, market, signed line, two prices, and subsequent price/status transition. Confirm stale withdrawal within 20 seconds and deletion by 45 seconds.

- [ ] **Step 5: Run full verification**

```powershell
npm run typecheck
npm test
npm run test:integration
npm run build
node --test scripts/chrome-bridge-soak.test.mjs
git diff --check
```

Expected: every command exits 0. Separately report each lobby as `LIVE_ACCEPTED`, `ATTACHED_NO_TRAFFIC`, `SCHEMA_REJECTED`, or `TAB_MISSING`; do not call unavailable lobbies complete.

- [ ] **Step 6: Commit Task 7 files only**

```powershell
git add scripts/start-live-stack.mjs scripts/chrome-bridge-soak.mjs scripts/chrome-bridge-soak.test.mjs run.md proccess.md HUONG-DAN-KY-THUAT.md
git commit -m "docs: hand off Chrome football collector"
```

## Plan self-review

- Every design requirement maps to one of Tasks 1–7.
- Source identity is separate from bookmaker family, preventing false same-book arbitrage.
- Installation, tab attachment, and unavailable traffic are explicit acceptance gates rather than hidden assumptions.
- Raw provider traffic cannot be used as a fixture until it passes extension and server redaction.
- The plan contains no automated wagering step.
- Legacy headless removal is incremental and reversible, not a global cutover before live evidence.
