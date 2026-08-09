# Multi-provider Comparison Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real selectable multi-provider comparison table that groups only verified equivalent events and markets, highlights the best eligible prices, and ranks realized positive-margin opportunities.

**Architecture:** Provider-specific browser sources normalize live observations into shared contracts. The API performs provider filtering, canonical mapping, eligibility checks, and opportunity calculation, then returns a presentation-ready comparison snapshot. React renders provider checkboxes, provider columns, exact market rows, and ranked opportunity cards without independently mapping events or calculating profit.

**Tech Stack:** TypeScript, Playwright, Fastify, Zod, React, Vitest, Testing Library, Playwright Test, existing `@tool-chenh/contracts`, `@tool-chenh/adapters`, and `@tool-chenh/core` packages.

## Global Constraints

- Live provider identity must be verified from runtime evidence; FABet labels and hostnames alone are insufficient.
- Events, market types, scopes, settlement profiles, outcome domains, and lines must match exactly before comparison.
- Missing, stale, suspended, closed, malformed, or quarantined quotes cannot become best prices or opportunities.
- Provider reads must execute concurrently and retain independent source/receive timestamps.
- Profit and ROI must use native stake rounding, fees, and FX conversion from the existing opportunity engine.
- No automatic bet placement is included.
- Fixture data must remain visibly identified and must never be presented as live provider evidence.

---

### Task 1: Correct provider identity and generalize the observed catalog contract

**Files:**
- Modify: `apps/api/src/sessions/fabet-browser.ts`
- Modify: `apps/api/src/sessions/fabet-browser.test.ts`
- Modify: `packages/adapters/src/cmd/cmd-normalizer.ts`
- Modify: `packages/adapters/src/cmd/cmd-normalizer.test.ts`
- Modify: `apps/api/src/providers/cmd/cmd-observed-catalog.ts`
- Modify: `apps/web/src/api/catalog.ts`

**Interfaces:**
- Produces: `normalizeObservedFootballCatalog(provider, records, options)` returning provider-correct `ProviderEvent`, `ProviderMarket`, and `ProviderQuote` values.
- Produces: `ObservedProviderCatalog.provider: ProviderId` instead of the literal `CMD`.
- Preserves: `normalizeCmdCatalog(records, options)` as a compatibility wrapper.

- [ ] **Step 1: Write failing provider-identity tests**

Add literal assertions that `C-SPORTS` maps to `SABA`, `K-SPORTS` maps to `SBOBET`, and an unknown card remains `UNKNOWN`. Add a normalizer test invoking:

```ts
const result = normalizeObservedFootballCatalog("SABA", [record], options);
expect(new Set(result.events.map((event) => event.provider))).toEqual(new Set(["SABA"]));
expect(new Set(result.quotes.map((quote) => quote.provider))).toEqual(new Set(["SABA"]));
```

- [ ] **Step 2: Run RED verification**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/fabet-browser.test.ts
npm.cmd test --workspace @tool-chenh/adapters -- --run src/cmd/cmd-normalizer.test.ts
```

Expected: the K-Sports identity and provider-parameterized normalization assertions fail.

- [ ] **Step 3: Implement provider-correct normalization**

Add:

```ts
export function normalizeObservedFootballCatalog(
  provider: ProviderId,
  records: readonly CmdCatalogInputRecord[],
  options: CmdCatalogOptions
): NormalizedCmdCatalog
```

Use `provider` for every normalized event, market, and quote. Keep `normalizeCmdCatalog` delegating with `"CMD"`. Make API/web catalog response validation accept the supported `ProviderIdSchema` value while still requiring `FOOTBALL`.

- [ ] **Step 4: Run GREEN verification and typechecks**

Run the two focused suites plus:

```powershell
npm.cmd run typecheck --workspace @tool-chenh/adapters
npm.cmd run typecheck --workspace @tool-chenh/api
npm.cmd run typecheck --workspace @tool-chenh/web
```

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/sessions/fabet-browser.ts apps/api/src/sessions/fabet-browser.test.ts packages/adapters/src/cmd/cmd-normalizer.ts packages/adapters/src/cmd/cmd-normalizer.test.ts apps/api/src/providers/cmd/cmd-observed-catalog.ts apps/web/src/api/catalog.ts
git commit -m "fix: bind observed catalogs to verified providers"
```

---

### Task 2: Implement the live SABA source under the correct provider identity

**Files:**
- Create: `apps/api/src/providers/saba/saba-browser-manager.ts`
- Create: `apps/api/src/providers/saba/saba-browser-manager.test.ts`
- Create: `apps/api/src/providers/saba/saba-session-validator.ts`
- Create: `apps/api/src/providers/saba/saba-observed-catalog.ts`
- Create: `apps/api/src/providers/saba/saba-observed-catalog.test.ts`
- Modify: `apps/api/src/providers/browser-protocol-inspector.ts`
- Modify: `apps/api/src/providers/browser-protocol-inspector.test.ts`
- Modify: `apps/api/src/sessions/session-services.ts`

**Interfaces:**
- Produces: `SabaCatalogRecordReader.readCatalog({sessionId, launchUrl})`.
- Produces: `SabaSessionValidator.provider = "SABA"` using SABA runtime evidence.
- Produces: `SabaObservedCatalogReader.read(accountId): Promise<ObservedProviderCatalog>`.

- [ ] **Step 1: Write failing SABA identity and extraction tests**

Use controlled HTML representing the observed SABA structure: `.c-match[data-matchid]`, `.c-team-name`, `[data-bt='3']`, `[data-bt='5']`, and `.c-odds[data-moid]`. Assert that identity requires all of:

```ts
{
  sabaBundle: true,
  footballDom: true,
  authenticatedRuntime: true,
  apiBackend: true
}
```

Assert extraction retains event ID, teams, live period/clock, score, total line, selection IDs, prices, and locked state.

- [ ] **Step 2: Run RED verification**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/providers/saba src/providers/browser-protocol-inspector.test.ts
```

Expected: SABA classes/functions are missing.

- [ ] **Step 3: Implement SABA browser manager and catalog reader**

Move the SABA-specific DOM/runtime logic out of the incorrectly named CMD path. Validate launch URLs as HTTPS without embedded credentials. Keep one isolated persistent browser profile per session, one bounded reload/reopen recovery, and no click on odds or wager controls. Normalize with:

```ts
normalizeObservedFootballCatalog("SABA", records, {
  observedAtMs,
  receivedMonotonicMs,
  timezoneOffsetMinutes: 420,
  sequence
});
```

- [ ] **Step 4: Register SABA validator and catalog capability**

Add `SabaSessionValidator` to `SessionValidatorRegistry` construction and a SABA profile/catalog reader entry. Runtime evidence must reject a launch missing the SABA bundle or API backend even if the card label says SABA.

- [ ] **Step 5: Verify focused tests and typecheck**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run src/providers/saba src/providers/browser-protocol-inspector.test.ts src/sessions/session-services.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
```

- [ ] **Step 6: Commit**

```powershell
git add apps/api/src/providers/saba apps/api/src/providers/browser-protocol-inspector.ts apps/api/src/providers/browser-protocol-inspector.test.ts apps/api/src/sessions/session-services.ts
git commit -m "feat: add verified live SABA catalog"
```

---

### Task 3: Implement the independent live SBOBET/K-Sports source

**Files:**
- Create: `packages/adapters/src/sbobet/sbobet-normalizer.ts`
- Create: `packages/adapters/src/sbobet/sbobet-normalizer.test.ts`
- Modify: `packages/adapters/src/index.ts`
- Create: `apps/api/src/providers/sbobet/sbobet-browser-manager.ts`
- Create: `apps/api/src/providers/sbobet/sbobet-browser-manager.test.ts`
- Create: `apps/api/src/providers/sbobet/sbobet-session-validator.ts`
- Create: `apps/api/src/providers/sbobet/sbobet-observed-catalog.ts`
- Create: `apps/api/src/providers/sbobet/sbobet-observed-catalog.test.ts`
- Modify: `apps/api/src/sessions/session-services.ts`

**Interfaces:**
- Produces: `SbobetCatalogInputRecord` containing event ID, league, participants, start/live evidence, score, period/clock, and exact market rows.
- Produces: `normalizeSbobetCatalog(records, options)`.
- Produces: `SbobetObservedCatalogReader.read(accountId)`.

- [ ] **Step 1: Write failing SBOBET normalizer tests**

Create literal records based on the observed independent DOM IDs such as `odd-item-53888030030002005h`. Assert:

```ts
expect(result.events[0]).toMatchObject({
  provider: "SBOBET",
  participantA: "Kristiansund BK",
  participantB: "Molde",
  isLive: true,
  liveState: { period: "2H", scoreHome: 2, scoreAway: 0 }
});
expect(result.markets).toContainEqual(expect.objectContaining({
  marketType: "FT_TOTAL", line: "2.5"
}));
```

Cover split Asian lines (`2.5-3` normalizes to `2.75`), Malay prices, decimal 1X2 prices, missing selections, duplicate IDs, and locked odds.

- [ ] **Step 2: Run RED normalizer verification**

```powershell
npm.cmd test --workspace @tool-chenh/adapters -- --run src/sbobet/sbobet-normalizer.test.ts
```

- [ ] **Step 3: Implement SBOBET DOM extraction and normalization**

Extract only `.wrapper-match-component` entries with exactly two `.row-team-name` participants. Use the wrapper/event ID as provider event identity. Treat the first three `.un-promotion` columns as full-time handicap, total, and 1X2 only when their complete expected outcome domains and ID suffixes are present. Never click `.odd-item`.

- [ ] **Step 4: Write and run RED browser-manager tests**

Assert runtime identity requires the independent `sb21` API/WebSocket evidence plus the observed `.wrapper-match-component` DOM. A SABA page must be rejected by the SBOBET validator and vice versa.

- [ ] **Step 5: Implement SBOBET manager, validator, and observed reader**

Use isolated persistent profiles, bounded recovery, concurrent-safe opening, and explicit close. Register the validator and a catalog-only provider reader. Profile balance may remain unavailable until its separately validated profile API is implemented; this must not block read-only catalog comparison.

- [ ] **Step 6: Verify focused suites and commit**

```powershell
npm.cmd test --workspace @tool-chenh/adapters -- --run src/sbobet
npm.cmd test --workspace @tool-chenh/api -- --run src/providers/sbobet src/sessions/session-services.test.ts
npm.cmd run typecheck --workspace @tool-chenh/adapters
npm.cmd run typecheck --workspace @tool-chenh/api
git add packages/adapters/src/sbobet packages/adapters/src/index.ts apps/api/src/providers/sbobet apps/api/src/sessions/session-services.ts
git commit -m "feat: add verified live SBOBET catalog"
```

---

### Task 4: Add the selected-provider comparison snapshot API

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Modify: `packages/contracts/src/schemas.test.ts`
- Create: `apps/api/src/catalog/comparison-service.ts`
- Create: `apps/api/src/catalog/comparison-service.test.ts`
- Modify: `apps/api/src/routes/catalog.ts`
- Modify: `apps/api/src/routes/catalog.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Produces: `ComparisonSnapshotSchema` with provider states, canonical events, canonical markets, provider cells, ranked opportunities, and diagnostics.
- Produces: `GET /api/catalog/compare?category=FOOTBALL&providers=SABA,SBOBET`.

- [ ] **Step 1: Write failing strict contract tests**

Define exact response types including:

```ts
interface ComparisonMarketRow {
  canonicalMarketId: string;
  canonicalEventId: string;
  marketType: MarketType;
  scope: Scope;
  line: string | null;
  selections: readonly string[];
  cells: readonly ComparisonProviderCell[];
  bestBySelection: Readonly<Record<string, { provider: ProviderId; decimalOdds: string }>>;
  realizedNetMargin: string | null;
  eligible: boolean;
  reasons: readonly string[];
}
```

The strict schema must reject unknown fields, duplicate providers, provider/cell identity mismatch, and non-plain decimal strings.

- [ ] **Step 2: Run RED contracts verification**

```powershell
npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts
```

- [ ] **Step 3: Implement comparison service with concurrent reads**

Resolve selected accounts/providers, execute reads via `Promise.allSettled`, feed accepted values into existing event mapper, market mapper, QuoteBook, and OpportunityEngine, then build rows only from `VERIFIED` canonical mappings. Best prices must be chosen from eligible quotes only.

- [ ] **Step 4: Add adversarial API tests**

Tests must prove:

- `2.5` and `2.75` totals never merge.
- Same participants with contradictory score/period do not verify.
- A stale high price cannot win best-price highlighting.
- A suspended quote removes a previously published opportunity immediately.
- Provider selection excludes unselected providers from cells and calculations.
- Reads start concurrently and retain independent observation timestamps.

- [ ] **Step 5: Implement strict route parsing**

Reject fewer than two providers, duplicate/unknown providers, more than five providers, unsupported categories, and malformed query strings with HTTP 400. Return HTTP 200 with diagnostics when valid selected providers are disconnected.

- [ ] **Step 6: Verify and commit**

```powershell
npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts
npm.cmd test --workspace @tool-chenh/api -- --run src/catalog/comparison-service.test.ts src/routes/catalog.test.ts
npm.cmd run typecheck --workspace @tool-chenh/contracts
npm.cmd run typecheck --workspace @tool-chenh/api
git add packages/contracts/src/domain.ts packages/contracts/src/schemas.ts packages/contracts/src/schemas.test.ts apps/api/src/catalog apps/api/src/routes/catalog.ts apps/api/src/routes/catalog.test.ts apps/api/src/app.ts
git commit -m "feat: expose selected-provider comparison snapshots"
```

---

### Task 5: Build the checkbox selector and comparison matrix

**Files:**
- Modify: `apps/web/src/api/catalog.ts`
- Create: `apps/web/src/comparison/provider-selection.ts`
- Create: `apps/web/src/comparison/provider-selection.test.ts`
- Create: `apps/web/src/components/provider-selector.tsx`
- Create: `apps/web/src/components/provider-selector.test.tsx`
- Create: `apps/web/src/components/comparison-matrix.tsx`
- Create: `apps/web/src/components/comparison-matrix.test.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: `CatalogApi.readComparison(category, providers)`.
- Produces: `ProviderSelector` controlled by selected provider IDs.
- Produces: `ComparisonMatrix` consuming only a validated `ComparisonSnapshot`.

- [ ] **Step 1: Write failing selection-state tests**

Assert all connected providers are selected by default, disabled providers cannot be selected, at least two are required, and the selected list persists under a versioned local-storage key without storing secrets.

- [ ] **Step 2: Write failing matrix rendering tests**

Use a hand-built strict snapshot to assert:

- Column headers are `SABA` and `SBOBET`.
- One `FT_TOTAL · 2.5` row contains both providers' `OVER` and `UNDER` prices.
- Best eligible cells receive `comparison-cell--best`.
- Stale/suspended/missing cells show reasons and are never highlighted.
- A `2.75` market renders as a separate row.

- [ ] **Step 3: Run RED web tests**

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/comparison src/components/provider-selector.test.tsx src/components/comparison-matrix.test.tsx src/pages/live-catalog-page.test.tsx
```

- [ ] **Step 4: Implement selector, API client, and matrix**

Render provider checkboxes above the category controls. Replace single-account catalog cards with event sections containing the provider matrix. Use accessible table markup, sticky provider headers, compact mobile horizontal scrolling, and clear English/Vietnamese-neutral market identifiers already used by the app.

- [ ] **Step 5: Implement deterministic sorting and empty states**

Sort opportunity events first, then live events, then prematch start time. Within an event sort positive realized margin descending, then market type and numeric line. Render `Need at least two verified live providers` when appropriate and mapping diagnostics when no rows verify.

- [ ] **Step 6: Run GREEN tests, typecheck, and commit**

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/comparison src/components/provider-selector.test.tsx src/components/comparison-matrix.test.tsx src/pages/live-catalog-page.test.tsx
npm.cmd run typecheck --workspace @tool-chenh/web
git add apps/web/src/api/catalog.ts apps/web/src/comparison apps/web/src/components/provider-selector.tsx apps/web/src/components/provider-selector.test.tsx apps/web/src/components/comparison-matrix.tsx apps/web/src/components/comparison-matrix.test.tsx apps/web/src/pages/live-catalog-page.tsx apps/web/src/pages/live-catalog-page.test.tsx apps/web/src/styles.css
git commit -m "feat: add selectable multi-provider comparison matrix"
```

---

### Task 6: Add the ranked verified-opportunity panel

**Files:**
- Create: `apps/web/src/components/comparison-opportunity-list.tsx`
- Create: `apps/web/src/components/comparison-opportunity-list.test.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: `ComparisonOpportunityList` rendering server-calculated opportunities and financial assumptions.

- [ ] **Step 1: Write failing opportunity-card tests**

Assert each card displays event, market, exact line, provider/outcome for each leg, raw/decimal prices, native/base stakes, total base stake, worst-case profit, realized ROI, fee/FX assumptions, quote ages, and read-only/preflight status. Assert higher realized ROI appears first.

- [ ] **Step 2: Run RED test**

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/components/comparison-opportunity-list.test.tsx
```

- [ ] **Step 3: Implement the compact ranked panel**

Use existing opportunity contract values verbatim. Do not recalculate inverse sums or stakes in React. Show a visible warning when there are no verified positive-margin opportunities instead of hiding the panel.

- [ ] **Step 4: Verify and commit**

```powershell
npm.cmd test --workspace @tool-chenh/web -- --run src/components/comparison-opportunity-list.test.tsx src/pages/live-catalog-page.test.tsx
npm.cmd run typecheck --workspace @tool-chenh/web
git add apps/web/src/components/comparison-opportunity-list.tsx apps/web/src/components/comparison-opportunity-list.test.tsx apps/web/src/pages/live-catalog-page.tsx apps/web/src/styles.css
git commit -m "feat: rank verified cross-provider opportunities"
```

---

### Task 7: Verify the complete live and reconnect behavior

**Files:**
- Create: `tests/integration/live-comparison.test.ts`
- Modify: `tests/integration/pipeline.test.ts`
- Modify: `tests/e2e/operator-flow.spec.ts`
- Modify: `docs/operator-guide.md`

**Interfaces:**
- Consumes: live SABA and SBOBET catalog readers plus `ComparisonSnapshot` API/UI.
- Produces: repeatable verification evidence for two-source comparison and documented operator workflow.

- [ ] **Step 1: Add failing integration regressions**

Use independent adapter clocks and quote sequences. Assert reconnect hides cached opportunities until a fresh authoritative snapshot, provider failure invalidates its cells immediately, and a recovered full snapshot restores only exact markets.

- [ ] **Step 2: Add browser acceptance coverage**

Verify provider checkbox selection, reload persistence, stable columns, exact line separation, opportunity-first ordering, and disabled provider reasons. The fixture E2E must display `FIXTURE`; live smoke output must contain two independently validated provider identities.

- [ ] **Step 3: Run targeted RED/GREEN cycles and fix only reproduced failures**

```powershell
npm.cmd test --workspace @tool-chenh/api -- --run ../../tests/integration/live-comparison.test.ts
npm.cmd run test:e2e -- --grep "multi-provider comparison"
```

- [ ] **Step 4: Perform read-only live acceptance**

With valid SABA and SBOBET sessions, load the same live event concurrently for at least five samples. Record only redacted provider IDs, event/market IDs, timestamps, statuses, and odds changes. Do not place a bet. Acceptance requires at least one exact common market row; a positive opportunity is not required.

- [ ] **Step 5: Update operator documentation**

Document provider selection, disabled states, row semantics, best-price highlighting, opportunity financial fields, quote age, mapping review, and the requirement for a new preflight immediately before any future execution.

- [ ] **Step 6: Run full verification**

```powershell
npm.cmd run typecheck --workspaces --if-present
npm.cmd test --workspaces --if-present -- --run
npm.cmd run build --workspaces --if-present
npm.cmd run test:e2e
git diff --check
```

Expected: every command exits 0; no live test performs a wager; the working tree contains only intentional changes.

- [ ] **Step 7: Commit**

```powershell
git add tests/integration/live-comparison.test.ts tests/integration/pipeline.test.ts tests/e2e/operator-flow.spec.ts docs/operator-guide.md
git commit -m "test: verify live multi-provider comparison"
```
