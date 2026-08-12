# Exact First-Half Market Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and, only if proven, compare exact first-half two-outcome Football markets from SABA and SBOBET.

**Architecture:** Add a private structural probe for SBOBET `getEvent`, collect live evidence without persisting raw payload, then extend provider normalizers and the existing focus predicate through TDD. Unsupported or ambiguous shapes remain invisible to ranking and alerts.

**Tech Stack:** TypeScript, Playwright, Vitest, normalized provider contracts, React comparison pipeline.

## Global Constraints

- Read-only inspection only; never select a ticket, enter stake, submit, or call provider history.
- Never output or persist raw authenticated payload, URL, headers, cookies, tokens, participant names, prices, or provider selection IDs.
- Enable only `FH_AH / FIRST_HALF / x.5 / HOME|AWAY` and/or `FH_TOTAL / FIRST_HALF / x.5 / OVER|UNDER` proven by both providers.
- Preserve all existing fail-closed mapping, freshness, settlement, preflight, green-state, and alert gates.
- Do not create or renumber schedule task IDs.

---

### Task 1: SBOBET structural market evidence

**Files:**
- Modify: `apps/api/src/providers/sbobet/sbobet-direct-catalog.ts`
- Modify: `apps/api/src/providers/sbobet/sbobet-direct-catalog.test.ts`
- Modify: `apps/api/src/providers/inspect-launch.ts`

**Interfaces:**
- Produces: `inspectSbobetMarketGroups(body: unknown): readonly SbobetMarketGroupShape[]` containing only group key, row token count, and token-kind sequence.

- [ ] Add a failing test proving the structural output excludes scalar values and exposes only numeric group keys plus token kinds.
- [ ] Run the focused test and record the expected failure because the inspector function is absent.
- [ ] Implement the bounded depth/row/token structural inspector.
- [ ] Add `--sbobet-market-shapes` to the private launch inspector and restrict capture to `/api/v2/getEvent`.
- [ ] Run the probe against the current SBOBET Football launch and record the evidenced first-half keys/shapes in `proccess.md`.

### Task 2: Exact provider normalization

**Files:**
- Modify only the SABA/SBOBET normalizers and tests required by the evidence from Task 1.

**Interfaces:**
- Produces: normalized `FH_AH` and/or `FH_TOTAL` markets with `scope="FIRST_HALF"` and exact two-outcome quotes.

- [ ] Add one RED test per evidenced market type using sanitized structural fixtures derived from the live probe.
- [ ] Prove integer, quarter, missing, duplicate, wrong-domain, and wrong-scope inputs remain rejected.
- [ ] Implement the minimum decoder branches supported by the evidence.
- [ ] Run full adapter and focused API reader tests.

### Task 3: Comparison, presentation, and verification

**Files:**
- Modify: `apps/web/src/catalog/comparison.ts`
- Modify: `apps/web/src/catalog/comparison.test.ts`
- Modify UI label tests/components only where the existing label mapping needs the new normalized type.
- Modify: `F:/0. PROJECT/tool-chenh/proccess.md`

**Interfaces:**
- Consumes: exact normalized first-half rows from at least two providers.
- Produces: horizontal prices, stake/profit calculations, top-five ranking, verified green state, and alerts through the existing pipeline.

- [ ] Add RED comparison tests for exact same event/type/scope/line/domain and fail-closed near misses.
- [ ] Extend the focus predicate and Vietnamese labels only for evidenced market types.
- [ ] Run full adapters, API, Web tests, typechecks, builds, and `git diff --check`.
- [ ] Append the source evidence, supported types, exclusions, test counts, and OBSERVE-only status to `proccess.md`.
- [ ] Commit only files owned by this market-expansion task.

