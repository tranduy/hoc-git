# All Exact Two-Way Football Markets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect, normalize, map, rank, and display every evidenced exact two-way Football market except exact score and three-way markets.

**Architecture:** Extend the existing typed market pipeline one settlement family at a time. Provider collectors hydrate detail data through authenticated read-only endpoints where available; strict normalizers publish canonical period/statistic/line/outcome identities, and the existing comparison engine consumes only identities proven equivalent.

**Tech Stack:** TypeScript, Chrome MV3 extension, Fastify, Zod, React, Vitest.

## Global Constraints

- OBSERVE/read-only only; never click an odds selection or submit a wager.
- Exclude exact score, 1X2/draw, and every ambiguous or non-mutually-exhaustive market.
- Require exact event, period, statistic, line, outcome domain, and settlement profile across providers.
- Retain quarter-unit non-integer Asian lines including `.25`, `.5`, and `.75` families.
- No production decoder branch without a failing regression test first.

---

### Task 1: First-half Asian markets

**Files:**
- Modify: `packages/adapters/src/saba/saba-football-normalizer.ts`
- Modify: `packages/adapters/src/sbobet/sbobet-normalizer.ts`
- Modify: `apps/api/src/providers/im/im-football-catalog-source.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Test: corresponding `*.test.ts` files

**Interfaces:**
- Produces: `FH_AH/FIRST_HALF/HOME|AWAY` and `FH_TOTAL/FIRST_HALF/OVER|UNDER` rows.

- [x] Change existing exclusion tests into exact accepted-output tests and run them RED.
- [x] Implement SABA bet types `7/8`, SBOBET groups `6/4`, and IM `gp=2` normalization.
- [x] Request both full-time and first-half IM game periods.
- [x] Add wrong-period/domain/line rejection tests and run focused suites GREEN.

### Task 2: Detail-market evidence collection

**Files:**
- Modify provider direct-catalog extractors under `apps/api/src/providers/`.
- Modify refresh expressions in `apps/chrome-extension/src/network-observer.ts`.
- Test each provider extractor and refresh boundary.

**Interfaces:**
- Produces: sanitized structural evidence and exact provider market/selection IDs for hidden markets.

- [x] Add RED fixtures for hidden detail responses while proving exact-score payloads are excluded.
- [x] Hydrate BTI event detail in a six-event rotating window and expand only bounded structural controls elsewhere; never interact with odds.
- [x] Record only exact event/market/selection IDs whose period, statistic, line, opposing domain, and team labels are structurally proven.
- [x] Cover detail expiry, empty-detail deletion, virtualized-control reuse, request bounds, and forbidden odds/bet-slip interaction.

### Task 3: Corners, cards, and other evidenced binary families

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Modify provider normalizers and tests.
- Modify: `apps/web/src/catalog/comparison.ts`

**Interfaces:**
- Produces: distinct typed statistic families with exact canonical settlement identities.

- [x] Add RED schema and decoder tests per proven provider code.
- [x] Add distinct market types/scopes/settlement profiles; never reuse goal-market identities.
- [x] Add exact outcome domains and labels.
- [x] Add cross-statistic, cross-period, cross-line, and reversed-orientation rejection tests.

### Task 4: Full verification and live coverage

**Files:**
- Modify: `proccess.md`
- Test: contracts, adapters, API, extension, web, integration.

**Interfaces:**
- Produces: provider/type coverage report and verified live catalog behavior.

- [x] Run all package typechecks, tests, and builds.
- [x] Query the live catalog and report event/market counts by provider and market type.
- [x] Verify exact score and three-way markets never enter comparison or ranking.
- [x] Record proven support and remaining provider-specific gaps without claiming unsupported coverage.

### Verified provider coverage (2026-08-18)

- SABA: full-time and first-half Asian handicap/total (`1/3/7/8`); exact `- CORNERS` and `- BOOKING(S)` pseudo-events are normalized to distinct corner/card settlement families, while ordinal derivatives such as `1st Corner` remain rejected.
- IM: full-time, first-half, and second-half Asian handicap/total (`bti=1/2`, `gp=1/2/3`).
- SBOBET/K-Sports and APSPORT/T-Sports: full-time, first-half, second-half, corner and card Asian handicap/total groups whose numeric semantics are covered by decoder regressions.
- BTI: full-time/first-half handicap and total from list/detail codes; detail labels also admit evidenced second-half, corner, and card families only when both exact opposing outcomes are present.
- CMD: full-time/first-half handicap and total plus full-time/first-half pseudo-event corner/card groups (`1/3/7/8`) proven by the DOM normalizer; the reader now revisits reused virtual rows instead of permanently skipping their hidden controls.
- Exact score, 1X2/draw, integer push-capable lines, incomplete domains, and unknown provider codes remain excluded.
