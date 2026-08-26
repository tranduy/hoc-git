# Five-Worker Realtime Recovery Reset Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:systematic-debugging` first. Use `superpowers:test-driven-development` only after the first failing runtime boundary is proven. No worker may implement more than one confirmed blocker at a time.

**Goal:** Establish a safe base for five external Codex workers, then prove real end-to-end realtime odds for SABA, CMD, and APSPORT/TSPORT in that exact order before unlocking IM or SBOBET/KSPORT.

**Architecture:** All five workers use the same checkout and branch at `F:\0. PROJECT\tool-chenh`; no worktree is allowed. Root is only the coordinator/integrator. Exactly one provider worker may hold an edit lease at a time, and every provider passes a local RED/GREEN gate plus live native-to-API price acceptance before the next provider is unlocked.

**Tech Stack:** TypeScript, Node.js, Vitest, Chrome MV3 extension, Chrome DevTools Protocol, Fastify API, five-provider coordinator scripts.

**Spec:** `proccess.md` and `docs/superpowers/tasks/five-provider/{ownership,integrator,saba,cmd,apsport,im,sbobet}.md`

## Global Constraints

- This document is planning only. No source implementation, build, restart, extension reload, provider navigation, or deployment begins until root receives an explicit execution order.
- Priority order is fixed: `SABA -> CMD -> APSPORT/TSPORT`. IM and SBOBET/KSPORT remain `WAITING`; BTI is only a stability guard.
- The five workers are five external Codex sessions opened from the prompts in `proccess.md`. Internal root subagents do not count as those workers.
- Preserve the current dirty checkout. Do not reset, stash, delete, checkout, commit, or rewrite user changes without separate authority.
- A status flag is not completion. `LIVE`, `ACTIVE`, `FRESH`, passing unit tests, and `LOCAL_GREEN` are supporting evidence only.
- Realtime completion requires the exact chain `provider-native evidence -> extension envelope -> bridge -> adapter -> catalog -> semantic price/status revision` on the current build.
- One provider, one hypothesis, one RED, one minimal fix, one review. No unrelated refactor or infrastructure work while a provider blocker is open.
- Provider workers never build, restart the stack, reload the extension, or deploy. Root alone performs those operations after a provider reaches `LOCAL_GREEN`.
- All logs and evidence must omit credentials, URLs containing auth material, raw provider payloads, and installation keys.

---

### Task 0: Freeze and inventory the current mixed checkout

**Files:**
- Read: all tracked changes reported by `git status --short`
- Create during execution: ignored evidence `.run/five-provider/reset/current-tree-manifest.json`
- Do not modify source files

**Produces:** An immutable manifest that maps every changed hunk to `SABA`, `CMD`, `APSPORT`, `IM`, `SBOBET`, `ROOT_SHARED`, or `UNRELATED_USER_CHANGE`.

- [ ] **Step 1: Prove there are no live edit/deploy/acceptance leases**

  Run:

  ```powershell
  node scripts/five-provider-coordinator.mjs status
  ```

  Expected: no edit, deployment, or acceptance lease. If any lease exists, stop and resolve it before continuing.

- [ ] **Step 2: Record the exact dirty-tree inventory without changing it**

  Run:

  ```powershell
  git status --short
  git diff --numstat
  git diff --name-only
  ```

  Expected starting evidence: approximately 55 modified/deleted tracked files and roughly `+6804/-2412` lines. A mismatch is recorded, not corrected.

- [ ] **Step 3: Attribute every changed hunk**

  Inspect each diff with `git diff -- <path>`. Shared files such as `network-observer.ts`, `server.ts`, data-plane/controller files, and deployment scripts are split by hunk, not assigned wholesale.

- [ ] **Step 4: Stop on unattributable or overlapping hunks**

  No provider work begins until every hunk has one owner and unrelated user changes are explicitly preserved. Do not solve attribution by reverting files.

**Gate 0:** `TREE_INVENTORIED`; current changes remain byte-for-byte intact.

---

### Task 1: Make the actual base for five external workers

**Files:**
- Modify after execution approval: `proccess.md`
- Review: `docs/superpowers/tasks/five-provider/ownership.md`
- Review: `docs/superpowers/tasks/five-provider/integrator.md`
- Test: `scripts/five-provider-coordinator.test.mjs`

**Produces:** Five copy-paste prompts, one role per external Codex window, with sequential provider unlocking and unambiguous ownership.

- [ ] **Step 1: Replace the conflicting parallel rule**

  Change the current rule that all five workers diagnose/edit in parallel. All five sessions may open and read their role, but only the provider named by root may edit. Initial unlock is SABA.

- [ ] **Step 2: Freeze Priority 2 explicitly**

  IM and SBOBET/KSPORT reply `BASE_READY ... WAITING` and perform no edits, runtime recovery, or acceptance until all three Priority-1 providers pass the same combined acceptance build.

- [ ] **Step 3: Require a base receipt from every worker**

  Exact receipt format:

  ```text
  BASE_READY <PROVIDER> <PRIORITY> <EXACT_ROOT> <BRANCH> <ROLE_SPEC> <WHITELIST> WAITING
  ```

  Each receipt must confirm the exact shared root, no worktree, role mapping, allowed files, prohibited deployment actions, and the meaning of `DONE`.

- [ ] **Step 4: Lock root's role**

  Root may review, resolve an evidenced shared seam, and perform a combined deployment. Root may not silently take over provider diagnosis or count internal subagents as provider workers.

- [ ] **Step 5: Verify coordinator and prompt consistency**

  Run:

  ```powershell
  npm.cmd test -- scripts/five-provider-coordinator.test.mjs
  rg -n "BASE_READY|SABA -> CMD -> APSPORT|WAITING|no worktree|LIVE.*ACTIVE.*FRESH" proccess.md
  ```

  Expected: coordinator tests pass; prompt text contains sequential order and states that status flags alone cannot yield `DONE`.

**Gate 1:** `FIVE_WORKER_BASE_READY`; five external workers acknowledge their roles, but only SABA is unlocked.

---

### Task 2: SABA — restore the missing source and prove current-stream authority

**Files initially read-only:**
- `apps/chrome-extension/src/source-tab-recovery.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/api/src/server.ts`
- `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- `apps/api/src/providers/saba/saba-push-decoder.ts`
- Corresponding focused tests

**Current known failure:** The SABA tab/source is absent after targeted recovery. A safe single-tab restore patch is locally green but undeployed; the API restore-first path in `server.ts` is present in the dirty tree but its final full verification was interrupted.

**Produces:** One proven first failing boundary and, only then, one bounded SABA patch.

- [ ] **Step 1: Establish current SABA facts read-only**

  Record whether an exact SABA tab exists, whether a `chrome:SABA:<tab>` bridge source exists, and whether the current catalog has a post-action baseline. Do not reload, restore, or create a tab during diagnosis.

- [ ] **Step 2: Trace the chain in order**

  Check exactly: tab restoration/creation -> Socket.IO `OPEN` -> `reset` -> football `data` -> `done` -> extension WS envelopes -> adapter authoritative baseline -> nonempty catalog.

- [ ] **Step 3: Name the first failing boundary**

  Write one statement: `SABA_ROOT_CAUSE: <boundary> because <sanitized evidence>`. If evidence cannot distinguish two boundaries within 15 minutes, add one sanitized counter at their boundary; do not patch either hypothesis.

- [ ] **Step 4: Write one failing regression**

  The test must reproduce the exact first failing boundary. Run it before production edits and record the expected failure.

- [ ] **Step 5: Apply one minimal SABA fix and run focused gates**

  Run only the tests and typechecks affected by the confirmed root cause, followed by scoped `git diff --check` and a sensitive-literal scan. An unrelated failure stops this provider; it is not fixed opportunistically.

- [ ] **Step 6: Root reviews and deploys one candidate build**

  Root verifies the SABA-owned diff plus any exact shared seam, then performs one managed API build/restart and one extension reload only if the extension hash changed.

- [ ] **Step 7: Run real SABA acceptance**

  Run:

  ```powershell
  node scripts/verify-saba-runtime.mjs 120000 .run/five-provider/saba-runtime-evidence.json
  node scripts/verify-saba-ui-runtime.mjs
  node scripts/verify-saba-direct-price.mjs
  ```

  Require a current authoritative baseline, at least three provider-native evidence advances, an actual price/status change mirrored by the API when the provider changes, one exact targeted recovery yielding a newer generation, and no source change for CMD/APSPORT/IM/SBOBET/BTI. If no live price changes occur in 120 seconds, extend observation up to 10 minutes; do not pass on flags alone.

**Gate 2:** `LIVE_ACCEPTED SABA`. If it fails, remain on SABA; CMD stays locked.

---

### Task 3: CMD — verify the real odds path before deciding whether code is needed

**Files initially read-only:**
- `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/api/src/chrome-bridge/cmd-http-adapter.ts`
- Corresponding focused tests

**Current known state:** CMD has recently reported `LIVE/ACTIVE/FRESH`, but that does not prove authenticated `fc=1` baselines and real price revisions reach the API correctly.

- [ ] **Step 1: Run acceptance before editing CMD**

  Run:

  ```powershell
  node scripts/verify-cmd-runtime.mjs 120000 .run/five-provider/cmd-runtime-evidence.json
  node scripts/verify-cmd-ui-runtime.mjs
  ```

- [ ] **Step 2: Verify the authoritative chain**

  Require a current-document authenticated `fc=1` baseline, correct frame/loader/session binding, at least three native cursor advances, nonempty catalog, and real semantic price/status revisions when CMD changes.

- [ ] **Step 3: Choose exactly one branch**

  - If every gate passes, make no CMD code change and record `LIVE_ACCEPTED CMD`.
  - If a gate fails, trace to the first failing boundary, create one RED, apply one minimal fix, review, deploy, and rerun the full acceptance from Step 1.

**Gate 3:** `LIVE_ACCEPTED CMD`. If it fails, remain on CMD; APSPORT stays locked.

---

### Task 4: APSPORT/TSPORT — prove DOM identity plus fresh WebSocket coverage

**Files initially read-only:**
- `apps/chrome-extension/src/tsport-dom-snapshot.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- `apps/chrome-extension/src/network-observer.ts`
- `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- Corresponding focused tests

**Current known failure:** The bridge is `LIVE` but authority remains `CANDIDATE`; the catalog is stale. No authoritative TSPORT WebSocket baseline has been proven.

- [ ] **Step 1: Trace the proof chain without editing**

  Record: completed visible DOM expected set -> exact current TSPORT socket `OPEN` -> buffered/current WS records -> normalized event/market/quote coverage -> authoritative baseline.

- [ ] **Step 2: Identify the first missing proof**

  Distinguish among incomplete DOM sweep, missing fresh socket OPEN, and incomplete normalized WS coverage. Do not modify all three paths.

- [ ] **Step 3: Write one RED and one minimal fix**

  The regression must match the exact missing proof from Step 2. Run focused adapter/observer tests, affected typechecks, diff check, and review before deployment.

- [ ] **Step 4: Run real APSPORT acceptance**

  Run:

  ```powershell
  node scripts/verify-apsport-runtime.mjs 120000 .run/five-provider/apsport-runtime-evidence.json
  node scripts/verify-apsport-ui-runtime.mjs
  node scripts/verify-apsport-direct-price.mjs
  ```

  Require a current fresh WS baseline covering the completed quoteable DOM set, at least three native evidence advances, actual price/status propagation, one exact recovery to a newer generation, and no other-provider source change.

**Gate 4:** `LIVE_ACCEPTED APSPORT`. If it fails, remain on APSPORT.

---

### Task 5: Priority-1 combined acceptance

**Files:**
- Read runtime scripts and generated ignored evidence only
- No source edits during acceptance

- [ ] **Step 1: Freeze the accepted Priority-1 tree**

  Require SABA, CMD, and APSPORT local gates green and zero edit/acceptance/deployment leases.

- [ ] **Step 2: Root performs one combined deployment**

  Build once, restart once, reload the exact extension once only if its bundle changed, and publish one build identity.

- [ ] **Step 3: Run the three 120-second samplers concurrently**

  Each provider must retain its exact source/build binding and pass its native evidence, semantic change, baseline, and targeted recovery gates. BTI must remain stable as a guard.

- [ ] **Step 4: Run a 10-minute read-only soak**

  Reject on authority reset, stale catalog, false zero, source churn, cross-provider mutation, or loss of semantic price propagation.

**Gate 5:** `PRIORITY1_DONE SABA CMD APSPORT <BUILD_IDENTITY>`.

---

### Task 6: Unlock Priority 2 sequentially

Only after Gate 5:

- [ ] Unlock IM and repeat the same diagnose -> RED -> minimal fix -> local green -> live acceptance cycle.
- [ ] After IM passes, unlock SBOBET/KSPORT and repeat it.
- [ ] Run one final five-provider combined acceptance on one build.

KSPORT work before Gate 5 is out of scope.

---

## Stop-Loss Rules

- Diagnosis timebox: 15 minutes to name the first failing boundary. If not isolated, add one boundary counter and stop; do not guess.
- Fix timebox: one confirmed hypothesis and one minimal patch. Two failed hypotheses return to root-cause tracing. A third attempted fix requires an explicit architecture review before any edit.
- No provider may accumulate a second open blocker. Finish or explicitly block the current blocker first.
- No restart/deployment/tooling/security/CPU work while a provider correctness blocker is open unless evidence proves that layer is the first failing boundary.
- Progress states are only `WAITING`, `DIAGNOSED`, `RED`, `LOCAL_GREEN`, `DEPLOYED`, `LIVE_ACCEPTED`, and `DONE`. Never report percentages.

## Completion Definition

The task is complete only when all five external provider workers report `DONE` for the same accepted build, backed by provider-native evidence and semantic price/status propagation. `LIVE/ACTIVE/FRESH` without that trace is not completion.
