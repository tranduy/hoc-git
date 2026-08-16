# Ticket Controls And Resource Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm ROI/stake/copy/HK theo từng vé và đảm bảo log, extension queue, tab/browser do tool quản lý không tăng tài nguyên vô hạn.

**Architecture:** Giữ exact-market gate hiện tại, bổ sung pure calculation helpers cho odds và stake để UI chỉ render kết quả đã kiểm chứng. Tách resource retention thành script helper có root allowlist và thay extension queue từ backpressure promise vô hạn sang bounded coalescing. Stack shutdown dùng ownership marker, không đụng Chrome mặc định.

**Tech Stack:** TypeScript, React 19, Vitest, Node.js scripts/tests, Chrome Extension MV3, Fastify.

## Global Constraints

- Không gửi lệnh cược thật.
- Chỉ vé exact hai cửa đối nghịch mới được tính.
- Stake tính theo VND và làm tròn bước 1.000 VND.
- Không kill Chrome profile mặc định hoặc tab người dùng.
- Tất cả ghi file/cleanup là best-effort và không được làm hỏng luồng realtime.

---

### Task 1: HK odds and anchored stake calculation

**Files:**
- Modify: `apps/web/src/catalog/comparison.ts`
- Modify: `apps/web/src/catalog/comparison.test.ts`
- Modify: `apps/web/src/watch/fixed-base-stake.ts`
- Modify: `apps/web/src/watch/fixed-base-stake.test.ts`

**Interfaces:**
- Produces: `decimalOdds(quote)` accepts `HK`; `buildAnchoredStakeEstimate(row, providers, anchor)` returns a fail-closed per-ticket plan.

- [ ] Add failing tests for HK `0.95 -> 1.95`, rejection of zero/negative/non-finite HK, anchoring either leg, 1.000 VND rounding and both outcome profits.
- [ ] Run `npm.cmd test --workspace @tool-chenh/web -- --run src/catalog/comparison.test.ts src/watch/fixed-base-stake.test.ts` and confirm the new assertions fail for missing behavior.
- [ ] Implement the minimum pure conversion and anchored calculation while preserving exact provenance/domain validation.
- [ ] Re-run the focused tests and keep all previous exact-opposing regressions green.

### Task 2: Per-ticket controls and compact detail UI

**Files:**
- Modify: `apps/web/src/components/match-watch-detail.tsx`
- Modify: `apps/web/src/components/match-watch-detail.test.tsx`
- Modify: `apps/web/src/components/ranked-ticket-table.tsx`
- Modify: `apps/web/src/components/ranked-ticket-table.test.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: anchored stake helper from Task 1.
- Produces: independent ticket stake state, two copy buttons, per-ticket ROI/profit and stable 40/60 workspace.

- [ ] Add failing component tests for one copy button per team, independent two-input editing, per-ticket ROI/profits and event-card best ROI.
- [ ] Add a failing layout assertion/smoke check that detail has no horizontal overflow at desktop and narrow widths.
- [ ] Run the focused component/page tests and record the expected failures.
- [ ] Implement ticket-local state keyed by exact ticket identity, compact rows and 40/60 CSS without changing list selection semantics.
- [ ] Re-run focused tests and `node scripts/football-layout-smoke.mjs` against the local stack.

### Task 3: Bounded logs and owned artifact retention

**Files:**
- Create: `scripts/resource-retention.mjs`
- Create: `scripts/resource-retention.test.mjs`
- Modify: `scripts/start-live-stack.mjs`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `enforceResourceRetention({ roots, maxAgeMs, maxFileBytes, maxFiles })` that only touches allowlisted project roots.

- [ ] Add failing tests proving oversized managed logs rotate, old tool-owned browser profiles/artifacts are removed, recent files survive and paths outside allowlisted roots are untouched.
- [ ] Add a failing API test proving routine poll requests do not emit info access logs in live mode while errors remain loggable.
- [ ] Run script/API tests and confirm failures are caused by missing retention/log policy.
- [ ] Implement startup retention and Fastify logging policy; keep capture disabled by default.
- [ ] Remove only confirmed stale oversized log files and tool-owned test profiles after resolving their absolute paths inside `.run`/`artifacts`.

### Task 4: Non-blocking extension queue and owned-tab cleanup

**Files:**
- Modify: `apps/chrome-extension/src/local-bridge.ts`
- Modify: `apps/chrome-extension/src/local-bridge.test.ts`
- Modify: `apps/chrome-extension/src/tab-registry.ts`
- Modify: `apps/chrome-extension/src/tab-registry.test.ts`
- Modify: `apps/chrome-extension/src/background.ts`
- Modify: `scripts/automation-browser-cleanup.mjs`
- Modify: `scripts/automation-browser-cleanup.test.mjs`

**Interfaces:**
- Produces: bounded enqueue semantics with deterministic coalescing; cleanup returns only owned tab/process IDs.

- [ ] Add failing tests for disconnected queue saturation without unresolved promises, newest full snapshot retention, diagnostics eviction and reconnection flush.
- [ ] Add failing tests proving only tabs/processes bearing the tool ownership marker are closed and user Chrome remains untouched.
- [ ] Run extension/script tests and verify the regressions fail for the expected reason.
- [ ] Implement bounded coalescing and best-effort shutdown cleanup without creating or reloading unrelated tabs.
- [ ] Re-run focused tests and inspect extension output for absence of `BRIDGE_QUEUE_FULL` promise errors.

### Task 5: Full verification and runtime resource smoke

**Files:**
- Modify: `proccess.md` only to record verified completion and measured resource evidence.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: reproducible verification evidence, no product behavior.

- [ ] Run web, API, chrome-extension and script focused suites.
- [ ] Run `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`.
- [ ] Restart the managed stack once and verify API/web health, queue reconnect and UI layout.
- [ ] Compare `.run`/`artifacts` size and tool-owned process counts before/after; verify no new tool browser profile/process survives shutdown.
- [ ] Run `git diff --check` and document exact pass/fail counts without claiming provider freshness that was not observed.
