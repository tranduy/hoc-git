# Five-Provider Parallel Runtime Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:systematic-debugging`, `superpowers:test-driven-development`, and `superpowers:verification-before-completion`. Provider workers execute only their assigned task file; the integrator executes shared integration and live acceptance.

**Goal:** Complete SABA, CMD, APSPORT, IM, and SBOBET realtime authority in parallel on one branch, then build and prove all six providers including BTI in the main application.

**Architecture:** Five workers own mutually exclusive provider-local adapters/tests. One integrator exclusively owns every shared bridge/authority file, Git history/index, build output, application processes, Chrome extension, browser tabs, debugger, and runtime acceptance. Workers communicate shared requirements through isolated reports rather than editing shared state.

**Tech Stack:** TypeScript 5.9, Node.js, Fastify, Chrome MV3/CDP, Zod, Vitest, npm workspaces, PowerShell.

**Spec:** `docs/superpowers/specs/2026-08-24-five-provider-parallel-runtime-design.md`

**Code foundation:** `6c440e8` (`fix(extension): recover authenticated SABA launches`)

## Global Constraints

- Use only `F:\0. PROJECT\tool-chenh\.worktrees\six-provider-realtime-feed` on branch `feat/six-provider-realtime-feed`.
- Keep the five provider pages in five separate Chrome tabs.
- Only the integrator may touch Git, builds, `dist`, runtime processes, extension reload, browser automation, DevTools, CDP, `chrome.debugger`, or live recovery.
- A worker may edit only its exact whitelist in `ownership.md` and its own report.
- All provider workers write failing tests before implementation and run focused tests only.
- Provider workers do not claim live success. The integrator performs all live proof from the built main application.
- No tracked file may contain launch URLs, operator/session tokens, cookies, authorization material, raw provider bodies, raw frame/loader identifiers, or credential values.
- Generic tab heartbeat, replay, unchanged DOM, and control acknowledgement cannot make a source live.
- Authority remains fail-closed until a complete current-generation provider baseline commits.
- SABA, CMD, and APSPORT receive shared integration and live acceptance before IM and SBOBET.
- BTI remains the untouched live regression control.

## Static Ownership

Canonical rules:

- `docs/superpowers/tasks/five-provider/common.md`
- `docs/superpowers/tasks/five-provider/ownership.md`

Provider instructions:

- `docs/superpowers/tasks/five-provider/saba.md`
- `docs/superpowers/tasks/five-provider/cmd.md`
- `docs/superpowers/tasks/five-provider/apsport.md`
- `docs/superpowers/tasks/five-provider/im.md`
- `docs/superpowers/tasks/five-provider/sbobet.md`

Integrator instructions:

- `docs/superpowers/tasks/five-provider/integrator.md`

---

### Task 1: Freeze and Verify the Common Foundation

**Owner:** Integrator

**Files:**

- Existing SABA extension integration files committed at `6c440e8`
- This design, plan, common rules, ownership matrix, provider tasks, and integrator task
- Ignored local `.auth/runtime-provider-launches.json` for exact live launches

- [x] Preserve each provider launch only in ignored local auth storage.
- [x] Verify the SABA common extension change with focused tests.
- [x] Run the complete extension suite, extension typecheck, and extension build.
- [x] Commit the SABA common foundation separately.
- [x] Commit this coordination plan and publish its local commit hash to every worker prompt.
- [x] Confirm the tracked worktree is clean before workers start.

### Task 2: SABA Provider-Local Authority

**Owner:** SABA worker

**Files:** Exact SABA whitelist in `ownership.md`.

- [ ] Read common, ownership, design, and `saba.md` completely.
- [ ] Capture focused RED for current-stream baseline, empty completion, retired-stream rejection, and same-epoch rebaseline.
- [ ] Implement the minimal SABA adapter fix.
- [ ] Run focused GREEN and diff/secret checks.
- [ ] Write only `docs/superpowers/reports/five-provider/saba.md` and stop.

### Task 3: CMD Provider-Local Baseline and Recovery State

**Owner:** CMD worker

**Files:** Exact CMD whitelist in `ownership.md`.

- [ ] Read common, ownership, design, and `cmd.md` completely.
- [ ] Capture focused RED for pre-baseline delta cursor poisoning.
- [ ] Capture focused RED for bounded acknowledgement-versus-completion recovery state.
- [ ] Implement the minimal adapter and isolated recovery-state changes.
- [ ] Run focused GREEN and diff/secret checks.
- [ ] Write the exact observer session/loader/correlation integration request in `cmd.md`'s report path and stop.

### Task 4: APSPORT/TSPORT Provider-Local WS Authority

**Owner:** APSPORT worker

**Files:** Exact APSPORT whitelist in `ownership.md`.

- [ ] Read common, ownership, design, and `apsport.md` completely.
- [ ] Capture focused RED proving DOM-only and partial WS coverage cannot establish authority.
- [ ] Capture focused RED proving complete new-stream WS coverage emits one WS-only baseline and later deltas.
- [ ] Implement the minimal adapter/assembler change.
- [ ] Run focused GREEN and diff/secret checks.
- [ ] Write the exact shared socket-reconnect/data-plane integration request and stop.

### Task 5: IM Odds Normalization and Atomic GetSE Baseline

**Owner:** IM worker

**Files:** Exact IM whitelist in `ownership.md`.

- [ ] Read common, ownership, design, and `im.md` completely.
- [ ] Capture focused RED for valid positive Hong Kong odds and invalid zero/non-finite values.
- [ ] Capture focused RED for mixed cutoffs and poisoned malformed generations.
- [ ] Implement the minimal boundary normalization and atomic partition behavior.
- [ ] Run focused GREEN and diff/secret checks.
- [ ] Write only `docs/superpowers/reports/five-provider/im.md` and stop.

### Task 6: SBOBET/KSPORT Explicit Baseline Generation

**Owner:** SBOBET worker

**Files:** Exact SBOBET whitelist in `ownership.md`.

- [ ] Read common, ownership, design, and `sbobet.md` completely.
- [ ] Capture focused RED proving different receipt sequences can belong to one explicit recovery generation.
- [ ] Capture focused RED for mixed-generation rejection, overlap ordering, delta buffering, and recovery after loss.
- [ ] Implement the minimal generation/adapter behavior.
- [ ] Run focused GREEN and diff/secret checks.
- [ ] Write the exact shared metadata integration request if needed and stop.

### Task 7: Integrate SABA, CMD, and APSPORT Shared Requests

**Owner:** Integrator

**Files:** Shared extension/authority/data-plane files plus the completed provider-local files.

- [ ] Wait for the three priority provider reports and verify every changed path is owned by its worker.
- [ ] Re-run each provider's focused suite before accepting its report.
- [ ] Apply SABA shared wiring first and write integration RED/GREEN for one current-stream baseline and targeted recovery.
- [ ] Apply CMD session/loader/outcome correlation second and write integration RED/GREEN for one complete bound `fc=1` promotion.
- [ ] Apply APSPORT targeted socket reconnect and candidate-promotion wiring third and write integration RED/GREEN for DOM-nonauthority plus WS coverage.
- [ ] Commit exact reviewed files per provider; do not stage unfinished worker files.

### Task 8: Integrate IM and SBOBET Shared Requests

**Owner:** Integrator

- [ ] Wait for both reports and verify ownership boundaries.
- [ ] Re-run each focused suite.
- [ ] Apply any IM shared metadata/wiring through integration RED/GREEN.
- [ ] Apply SBOBET explicit recovery-generation metadata/wiring through integration RED/GREEN.
- [ ] Commit exact reviewed files per provider.

### Task 9: Full Static Verification and Build

**Owner:** Integrator

- [ ] Run all five provider adapter suites together.
- [ ] Run authority/coordinator, registry, data-plane, recovery, route/control, and server regression suites.
- [ ] Run the complete contracts and extension suites.
- [ ] Run contracts, API, extension, and web typechecks.
- [ ] Run contracts, API, extension, and web builds.
- [ ] Run `git diff --check` and a scoped secret/raw-body scan.
- [ ] Confirm the worktree contains only intentional integration/report edits, then commit them.

### Task 10: Main Application Runtime Acceptance

**Owner:** Integrator

- [ ] Resolve and record exact current build paths and hashes without exposing secrets.
- [ ] Sync the built extension once to the exact Chrome-loaded unpacked directory.
- [ ] Reload that one extension once and confirm its artifact hash matches the current worktree.
- [ ] Restart the main API/web stack once from the current worktree and prove process command lines and ports point to it.
- [ ] Address provider pages by exact tab ID; never rely on the active tab.
- [ ] Accept SABA, CMD, and APSPORT in that order, then IM and SBOBET.
- [ ] For each provider prove `ACTIVE`, `LIVE/FRESH`, one current authoritative baseline, and at least three provider-evidence advances.
- [ ] Observe a real semantic price/status delta when emitted; never synthesize a change.
- [ ] Confirm BTI remains active and advancing.
- [ ] Inject one targeted recovery at a time and prove the other providers are unchanged.
- [ ] Restart API once and reload the extension once; require new authoritative baselines rather than replay.
- [ ] Run the final ten-minute six-provider soak and record a redacted acceptance report.

## Final Handoff

The integrator reports exact commits, test/build counts, loaded artifact identity, per-provider authority/freshness/evidence results, recovery results, and any external provider failure. No worker's focused GREEN is presented as proof that the live main application is working.
