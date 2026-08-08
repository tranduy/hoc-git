# Arbitrage Foundation and Fixture Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a locally runnable, read-only Football + LoL arbitrage application whose strict mapping, odds normalization, stake calculation, freshness gates, realtime API, and friendly dashboard are fully testable against redacted fixtures.

**Architecture:** Use an npm-workspaces TypeScript monorepo with focused contracts, core, API, and React web packages. The hot path stays in memory: provider adapters emit raw events and quotes, core modules normalize and map them, the opportunity engine emits only VERIFIED and fresh opportunities, and the API broadcasts snapshots to the UI. This foundation deliberately uses fixture adapters; authenticated live adapters and any execution mode belong to later plans after protocol fixtures exist.

**Tech Stack:** Node.js 22+, npm workspaces, TypeScript 5.9+, Zod 4, Decimal.js, Fastify 5, React 19, Vite 7, Vitest 3+, fast-check 4+, Playwright 1.54+.

## Global Constraints

- Categories are exactly FOOTBALL and LOL and remain separate in navigation, filtering, normalization, and tests.
- Only mapping status VERIFIED may enter the arbitrage calculator.
- REVIEW_REQUIRED and REJECTED data may be displayed for diagnosis but can never create an opportunity.
- Supported phase-one Football markets: full-time and first-half 1X2, Asian Handicap, and Total Goals.
- Supported phase-one LoL markets: Series Winner, Map Winner, Map Total Kills, Map Kill Handicap, and Map Duration.
- First Blood, First Dragon, First Baron, corners, cards, player props, virtual sports, and esoccer are observe-only.
- All calculations use effective Decimal odds after fees and FX.
- A stale, suspended, out-of-order, sequence-gap, or schema-unknown quote is ineligible.
- This plan creates no real bet submission path and stores no credentials or session tokens.
- The source DOCX remains unmodified and untracked.
- Windows commands use npm.cmd because PowerShell script execution blocks npm.ps1.

## Scope decomposition

The approved specification contains three independently reviewable systems:

1. This plan: deterministic core, fixture ingestion, realtime API, and read-only UI.
2. A later live-ingestion plan: authenticated browser sessions and four SABA/IM adapters, written from redacted captures produced by this foundation.
3. A later execution plan: PAPER, ASSISTED, preflight, receipts, reconciliation, and only then gated AUTO, written after bet-specific fields are supplied.

This plan ends with useful software: an operator can load representative Football and LoL fixtures, inspect strict mapping evidence, see live/stale quote behavior, and verify exact stake and worst-case profit calculations through the UI.

## File structure

~~~text
.
├─ package.json                         workspace commands only
├─ package-lock.json                    exact dependency lock
├─ tsconfig.base.json                   shared strict TypeScript settings
├─ .gitignore                           generated files and secrets
├─ .env.example                         non-secret local ports
├─ apps/
│  ├─ api/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ app.ts                      Fastify composition
│  │     ├─ server.ts                   process entry point
│  │     ├─ runtime.ts                  in-memory pipeline orchestration
│  │     ├─ routes/health.ts            health and provider status
│  │     ├─ routes/snapshot.ts          current read model
│  │     └─ realtime/opportunity-ws.ts  WebSocket snapshot broadcast
│  └─ web/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ vite.config.ts
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx                    React entry
│        ├─ app.tsx                     navigation and routes
│        ├─ styles.css                  design tokens and responsive layout
│        ├─ api/client.ts               snapshot and WebSocket client
│        ├─ components/
│        │  ├─ status-strip.tsx         provider/freshness summary
│        │  ├─ event-table.tsx          stable event/market rows
│        │  ├─ opportunity-card.tsx     odds, stakes, worst-case profit
│        │  └─ mapping-evidence.tsx     hard-gate evidence
│        └─ pages/
│           ├─ dashboard-page.tsx
│           ├─ category-page.tsx
│           ├─ opportunities-page.tsx
│           └─ mappings-page.tsx
├─ packages/
│  ├─ contracts/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ domain.ts                   shared enums and records
│  │     ├─ schemas.ts                  Zod ingress/read-model schemas
│  │     └─ index.ts                    public exports
│  ├─ core/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ odds/convert.ts
│  │     ├─ odds/effective.ts
│  │     ├─ identity/normalize-name.ts
│  │     ├─ identity/canonical-key.ts
│  │     ├─ mapping/event-mapper.ts
│  │     ├─ mapping/market-mapper.ts
│  │     ├─ quotes/quote-book.ts
│  │     ├─ arbitrage/calculate.ts
│  │     ├─ arbitrage/optimize-stakes.ts
│  │     ├─ opportunities/engine.ts
│  │     └─ index.ts
│  └─ adapters/
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ src/
│        ├─ provider-adapter.ts          live-adapter contract
│        ├─ fixture-adapter.ts           deterministic replay
│        ├─ redaction.ts                 secret-safe capture utility
│        └─ index.ts
├─ fixtures/
│  ├─ football/saba-snapshot.json
│  ├─ football/im-snapshot.json
│  ├─ lol/saba-snapshot.json
│  └─ lol/im-snapshot.json
└─ tests/
   ├─ integration/pipeline.test.ts
   └─ e2e/dashboard.spec.ts
~~~

---

### Task 1: Workspace bootstrap and domain contracts

**Files:**
- Create: package.json
- Create: tsconfig.base.json
- Create: .gitignore
- Create: .env.example
- Create: packages/contracts/package.json
- Create: packages/contracts/tsconfig.json
- Create: packages/contracts/src/domain.ts
- Create: packages/contracts/src/schemas.ts
- Create: packages/contracts/src/index.ts
- Test: packages/contracts/src/schemas.test.ts

**Interfaces:**
- Consumes: none.
- Produces: Category, MappingStatus, MarketType, Scope, QuoteStatus, ProviderEvent, ProviderMarket, ProviderQuote, MappingEvidence, CanonicalEvent, CanonicalMarket, Opportunity, StakeLeg, AppSnapshot and their Zod schemas.

- [ ] **Step 1: Create the workspace manifests and strict compiler settings**

Create the root package.json with these scripts:

~~~json
{
  "name": "tool-chenh",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "dev": "npm run dev --workspace @tool-chenh/api",
    "dev:web": "npm run dev --workspace @tool-chenh/web",
    "test": "npm run test --workspaces --if-present",
    "test:integration": "vitest run tests/integration",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "verify": "npm run typecheck && npm test && npm run test:integration"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
~~~

Create tsconfig.base.json with target ES2023, module NodeNext, moduleResolution NodeNext, strict true, noUncheckedIndexedAccess true, exactOptionalPropertyTypes true, useUnknownInCatchVariables true, declaration true, sourceMap true, and skipLibCheck true.

Create .gitignore containing node_modules, dist, coverage, playwright-report, test-results, .env, .auth, browser-profiles, captures/raw, and every file matching *.session.json.

Create .env.example with API_HOST=127.0.0.1, API_PORT=4310, WEB_PORT=4311, and FIXTURE_REPLAY_SPEED=1.

- [ ] **Step 2: Write failing schema tests**

Create schemas.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { ProviderQuoteSchema } from "./schemas.js";

describe("ProviderQuoteSchema", () => {
  it("accepts a complete quote", () => {
    const result = ProviderQuoteSchema.safeParse({
      provider: "SABA",
      category: "LOL",
      providerEventId: "event-1",
      providerMarketId: "market-1",
      providerSelectionId: "selection-1",
      marketType: "MAP_WINNER",
      scope: "MAP_3",
      selection: "navi",
      line: null,
      rawOdds: "1.26",
      rawFormat: "HK",
      status: "OPEN",
      isLive: true,
      sourceTimestampMs: 1000,
      receivedMonotonicMs: 1100,
      sequence: 7
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const result = ProviderQuoteSchema.safeParse({
      provider: "SABA",
      category: "TENNIS"
    });
    expect(result.success).toBe(false);
  });
});
~~~

- [ ] **Step 3: Run the test and verify red**

Run: npm.cmd install && npm.cmd test --workspace @tool-chenh/contracts

Expected: FAIL because the workspace package and ProviderQuoteSchema do not exist.

- [ ] **Step 4: Implement exact domain types and schemas**

In domain.ts define string unions, not numeric enums:

~~~ts
export type Category = "FOOTBALL" | "LOL";
export type MappingStatus = "VERIFIED" | "REVIEW_REQUIRED" | "REJECTED";
export type QuoteStatus = "OPEN" | "SUSPENDED" | "CLOSED";
export type OddsFormat = "DECIMAL" | "HK" | "AMERICAN";
export type MarketType =
  | "FT_1X2" | "FT_AH" | "FT_TOTAL"
  | "FH_1X2" | "FH_AH" | "FH_TOTAL"
  | "SERIES_WINNER" | "MAP_WINNER"
  | "MAP_TOTAL_KILLS" | "MAP_KILL_HANDICAP" | "MAP_DURATION"
  | "OBSERVE_ONLY";

export type Scope =
  | "FULL_TIME" | "FIRST_HALF" | "SERIES"
  | "MAP_1" | "MAP_2" | "MAP_3" | "MAP_4" | "MAP_5";

export interface ProviderQuote {
  provider: string;
  category: Category;
  providerEventId: string;
  providerMarketId: string;
  providerSelectionId: string;
  marketType: MarketType;
  scope: Scope;
  selection: string;
  line: string | null;
  rawOdds: string;
  rawFormat: OddsFormat;
  status: QuoteStatus;
  isLive: boolean;
  sourceTimestampMs: number | null;
  receivedMonotonicMs: number;
  sequence: number | null;
}
~~~

Define the remaining interfaces with readonly fields. MappingEvidence contains gate, passed, expected, actual and reason. Opportunity contains canonicalMarketId, category, legs, inverseSum, netMargin, worstCaseProfit, roi, quoteAgeMs, mappingEvidence, and executionConfidence fixed to HIGH or BLOCKED.

In schemas.ts define Zod schemas matching every ingress and read-model type. Use z.strictObject so unknown critical fields are rejected instead of silently ignored.

- [ ] **Step 5: Run tests and typecheck**

Run: npm.cmd test --workspace @tool-chenh/contracts && npm.cmd run typecheck --workspace @tool-chenh/contracts

Expected: PASS.

- [ ] **Step 6: Commit**

~~~powershell
git add package.json package-lock.json tsconfig.base.json .gitignore .env.example packages/contracts
git commit -m "feat: establish arbitrage domain contracts"
~~~

---

### Task 2: Odds conversion, fee, and FX normalization

**Files:**
- Create: packages/core/package.json
- Create: packages/core/tsconfig.json
- Create: packages/core/src/odds/convert.ts
- Create: packages/core/src/odds/effective.ts
- Create: packages/core/src/odds/convert.test.ts
- Create: packages/core/src/odds/effective.test.ts
- Create: packages/core/src/index.ts

**Interfaces:**
- Consumes: OddsFormat from @tool-chenh/contracts.
- Produces: toDecimal(raw: string, format: OddsFormat): Decimal; effectiveDecimal(decimal: Decimal, fee: FeeModel): Decimal; convertStake(amount: Decimal, fx: FxModel): Decimal.

- [ ] **Step 1: Write failing conversion tests**

~~~ts
import { describe, expect, it } from "vitest";
import { toDecimal } from "./convert.js";

describe("toDecimal", () => {
  it.each([
    ["1.26", "HK", "2.26"],
    ["2.054", "DECIMAL", "2.054"],
    ["+126", "AMERICAN", "2.26"],
    ["-150", "AMERICAN", "1.6666666666666666667"]
  ] as const)("converts %s %s", (raw, format, expected) => {
    expect(toDecimal(raw, format).toSignificantDigits(20).toString()).toBe(expected);
  });

  it("rejects zero-or-lower decimal odds", () => {
    expect(() => toDecimal("0", "DECIMAL")).toThrow("decimal odds must be greater than 1");
  });
});
~~~

- [ ] **Step 2: Run conversion tests and verify red**

Run: npm.cmd test --workspace @tool-chenh/core -- convert.test.ts

Expected: FAIL because toDecimal does not exist.

- [ ] **Step 3: Implement conversion with Decimal.js**

Use Decimal.clone with precision 40 and ROUND_HALF_EVEN. Reject NaN, Infinity, decimal odds less than or equal to 1, HK odds less than or equal to 0, and American odds between -100 and +100 excluding the unsupported zero case.

~~~ts
export function toDecimal(raw: string, format: OddsFormat): Decimal {
  const value = new Decimal(raw.replace(/^\+/, ""));
  if (!value.isFinite()) throw new Error("odds must be finite");
  if (format === "DECIMAL") {
    if (value.lte(1)) throw new Error("decimal odds must be greater than 1");
    return value;
  }
  if (format === "HK") {
    if (value.lte(0)) throw new Error("HK odds must be greater than 0");
    return value.plus(1);
  }
  if (value.gte(100)) return value.div(100).plus(1);
  if (value.lte(-100)) return new Decimal(100).div(value.abs()).plus(1);
  throw new Error("American odds must be at least +100 or at most -100");
}
~~~

- [ ] **Step 4: Write failing effective-odds tests**

Cover NONE, PROFIT, PAYOUT and FX spread. Assert decimal 2.00 with 10% PROFIT fee becomes 1.90. Assert an unsupported WITHDRAWAL-only model throws and cannot be used for opportunity calculation.

- [ ] **Step 5: Implement fee and FX models**

~~~ts
export type FeeModel =
  | { type: "NONE" }
  | { type: "PROFIT"; rate: Decimal.Value }
  | { type: "PAYOUT"; rate: Decimal.Value };

export interface FxModel {
  sourceCurrency: string;
  baseCurrency: string;
  rate: Decimal.Value;
  spreadRate: Decimal.Value;
}
~~~

Validate all rates: fee and spread are within 0 inclusive and 1 exclusive; FX rate is positive. Return new Decimal values and never use JavaScript number arithmetic in odds, fee, FX, stake, payout, or profit code.

- [ ] **Step 6: Run core tests and commit**

Run: npm.cmd test --workspace @tool-chenh/core && npm.cmd run typecheck --workspace @tool-chenh/core

Expected: PASS.

~~~powershell
git add packages/core package.json package-lock.json
git commit -m "feat: normalize odds fees and FX"
~~~

---

### Task 3: Canonical identity and alias registry

**Files:**
- Create: packages/core/src/identity/normalize-name.ts
- Create: packages/core/src/identity/canonical-key.ts
- Create: packages/core/src/identity/identity.test.ts

**Interfaces:**
- Consumes: ProviderEvent and Category.
- Produces: normalizeName(value: string): string; resolveAlias(value: string, aliases: AliasRegistry): AliasResolution; buildFootballEventKey(input: FootballIdentity): string; buildLolEventKey(input: LolIdentity): string.

- [ ] **Step 1: Write failing identity tests**

~~~ts
it("normalizes accents, punctuation, and whitespace", () => {
  expect(normalizeName("  Natus  Vincere™ ")).toBe("natus_vincere");
});

it("resolves an explicit LoL alias without fuzzy auto-confirm", () => {
  const aliases = { LOL: { navi: "natus_vincere" }, FOOTBALL: {} };
  expect(resolveAlias("NAVI", aliases)).toEqual({
    normalized: "navi",
    canonical: "natus_vincere",
    source: "EXPLICIT_ALIAS"
  });
});

it("uses home-away order in Football identity", () => {
  expect(buildFootballEventKey({
    competition: "epl",
    seasonStage: "2026_regular",
    kickoffUtc: "2026-08-09T12:00:00.000Z",
    home: "arsenal",
    away: "chelsea",
    eventScope: "REGULAR"
  })).not.toBe(buildFootballEventKey({
    competition: "epl",
    seasonStage: "2026_regular",
    kickoffUtc: "2026-08-09T12:00:00.000Z",
    home: "chelsea",
    away: "arsenal",
    eventScope: "REGULAR"
  }));
});
~~~

- [ ] **Step 2: Run tests and verify red**

Run: npm.cmd test --workspace @tool-chenh/core -- identity.test.ts

Expected: FAIL because identity functions do not exist.

- [ ] **Step 3: Implement deterministic normalization and keys**

Use Unicode NFKD, remove combining marks, lowercase, replace ampersand with and, remove punctuation, collapse whitespace and underscores. Alias lookup is exact after normalization. Do not use edit distance to produce a canonical identity.

Football keys retain home/away order. LoL keys sort participants only for candidate lookup, while selection mapping retains provider side orientation in separate evidence.

- [ ] **Step 4: Add collision tests**

Verify two rematches with different kickoff times have different keys. Verify LoL BO3 and BO5 have different keys. Verify missing competition, stage, kickoff, participant, or BO throws CanonicalIdentityError rather than producing a partial key.

- [ ] **Step 5: Run tests and commit**

Run: npm.cmd test --workspace @tool-chenh/core && npm.cmd run typecheck --workspace @tool-chenh/core

Expected: PASS.

~~~powershell
git add packages/core/src/identity
git commit -m "feat: add canonical event identity"
~~~

---

### Task 4: Strict event and market mapping

**Files:**
- Create: packages/core/src/mapping/event-mapper.ts
- Create: packages/core/src/mapping/market-mapper.ts
- Create: packages/core/src/mapping/event-mapper.test.ts
- Create: packages/core/src/mapping/market-mapper.test.ts

**Interfaces:**
- Consumes: normalized ProviderEvent, ProviderMarket, AliasRegistry and MappingPolicy.
- Produces: mapEvents(left, right, policy): EventMappingResult; mapMarkets(eventMapping, left, right): MarketMappingResult. Both results contain status and complete MappingEvidence arrays.

- [ ] **Step 1: Write failing Football hard-gate tests**

Test an EPL fixture with matching competition, season, home/away and kickoff within 120 seconds returns VERIFIED. Then independently change category to virtual, reverse home/away, move kickoff by 10 minutes, change period, change score, or remove settlement profile and assert the result is not VERIFIED.

~~~ts
const result = mapEvents(sabaFootball, imFootball, {
  prematchToleranceMs: 120_000,
  liveClockToleranceMs: 20_000
});
expect(result.status).toBe("VERIFIED");
expect(result.evidence.every((item) => item.passed)).toBe(true);
~~~

- [ ] **Step 2: Run Football tests and verify red**

Run: npm.cmd test --workspace @tool-chenh/core -- event-mapper.test.ts

Expected: FAIL because mapEvents does not exist.

- [ ] **Step 3: Implement Football and LoL event gates**

Implement named pure gate functions so failures remain inspectable:

~~~ts
type EventGate = (
  left: NormalizedEvent,
  right: NormalizedEvent,
  policy: MappingPolicy
) => MappingEvidence;

const footballGates: readonly EventGate[] = [
  sameCategory,
  sameNonVirtualSport,
  sameCompetitionAndStage,
  sameHomeAway,
  compatibleKickoff,
  compatibleLiveState,
  compatibleEventScope
];
~~~

LoL gates include same LoL PC game, tournament/stage, teams through explicit aliases, kickoff, BO, series score, current map and live state. Missing a hard field returns REVIEW_REQUIRED; contradictory fields return REJECTED.

- [ ] **Step 4: Write failing market-gate tests**

Cover these non-negotiable rejects:

- Full-time versus first-half.
- SERIES_WINNER versus MAP_WINNER.
- MAP_2 versus MAP_3.
- Total 28.5 versus 29.5.
- Asian Handicap -1.5 versus -2.5.
- Different settlement profile hashes.
- OPEN versus SUSPENDED.

Also verify reversed selection order maps to the same outcomes using canonical participant IDs.

- [ ] **Step 5: Implement canonical market IDs**

Normalize line with Decimal, including equivalent strings such as 1.50 and 1.5. Canonical market ID includes event ID, scope, market type, line-or-none and settlement profile. OBSERVE_ONLY never receives executionConfidence HIGH.

- [ ] **Step 6: Run tests and commit**

Run: npm.cmd test --workspace @tool-chenh/core && npm.cmd run typecheck --workspace @tool-chenh/core

Expected: PASS.

~~~powershell
git add packages/core/src/mapping
git commit -m "feat: enforce strict event and market mapping"
~~~

---

### Task 5: Arbitrage calculation and constrained stake optimization

**Files:**
- Create: packages/core/src/arbitrage/calculate.ts
- Create: packages/core/src/arbitrage/optimize-stakes.ts
- Create: packages/core/src/arbitrage/calculate.test.ts
- Create: packages/core/src/arbitrage/optimize-stakes.test.ts
- Create: packages/core/src/arbitrage/optimize-stakes.property.test.ts

**Interfaces:**
- Consumes: effective Decimal odds and StakeConstraint records.
- Produces: calculateArbitrage(odds): ArbitrageResult; optimizeStakes(input): StakePlan | null.

- [ ] **Step 1: Write failing two- and three-outcome tests**

~~~ts
it("finds a two-outcome surebet", () => {
  const result = calculateArbitrage(["2.10", "2.05"]);
  expect(result.isArbitrage).toBe(true);
  expect(result.inverseSum.toFixed(12)).toBe("0.963995354239");
});

it("rejects the LoL document example", () => {
  const result = calculateArbitrage(["2.26", "1.714"]);
  expect(result.isArbitrage).toBe(false);
  expect(result.inverseSum.gt(1)).toBe(true);
});
~~~

- [ ] **Step 2: Run tests and verify red**

Run: npm.cmd test --workspace @tool-chenh/core -- calculate.test.ts

Expected: FAIL because calculateArbitrage does not exist.

- [ ] **Step 3: Implement N-outcome inverse-sum math**

Return inverseSum, theoreticalMargin, isArbitrage and equalized fractions. Reject fewer than two outcomes and any effective odds less than or equal to 1.

- [ ] **Step 4: Write failing stake-constraint tests**

Use a base bankroll of 1,000, two providers with stake steps 1 and 5, minimum stakes 10, maximum stakes 600, and odds 2.10/2.05. Assert:

- every stake respects step/min/max;
- total does not exceed bankroll;
- worst-case profit is positive;
- returned worstCaseProfit equals the minimum outcome payout minus total base-currency stake.

Add a case where a maximum stake is too low and assert null.

- [ ] **Step 5: Implement discrete max-min optimization**

Start from equal-payout continuous stakes, generate floor/ceiling candidates for each stake step in a bounded neighborhood, evaluate Cartesian candidates, and select by:

1. highest worstCaseProfit;
2. then highest ROI;
3. then lowest total stake.

The function must cap candidate count and throw StakeSearchSpaceError if configuration would exceed 50,000 combinations.

- [ ] **Step 6: Add fast-check properties**

Generate decimal odds from 1.01 to 20, bankroll from 10 to 100,000 and legal stake steps. For every non-null plan assert all constraints hold and reported worstCaseProfit is no greater than every outcome profit. Assert no plan with non-positive worst-case profit is marked executable.

- [ ] **Step 7: Run tests and commit**

Run: npm.cmd test --workspace @tool-chenh/core && npm.cmd run typecheck --workspace @tool-chenh/core

Expected: PASS.

~~~powershell
git add packages/core/src/arbitrage package.json package-lock.json
git commit -m "feat: optimize constrained arbitrage stakes"
~~~

---

### Task 6: Quote book, freshness, and opportunity engine

**Files:**
- Create: packages/core/src/quotes/quote-book.ts
- Create: packages/core/src/quotes/quote-book.test.ts
- Create: packages/core/src/opportunities/engine.ts
- Create: packages/core/src/opportunities/engine.test.ts

**Interfaces:**
- Consumes: verified canonical market mappings, normalized quotes, SourceFreshnessPolicy and stake constraints.
- Produces: QuoteBook.apply(update): ApplyResult; QuoteBook.snapshot(nowMs): QuoteSnapshot; OpportunityEngine.evaluate(snapshot, context): readonly Opportunity[].

- [ ] **Step 1: Write failing quote-order tests**

Cover:

- higher sequence accepted;
- duplicate/lower sequence ignored;
- a sequence gap marks market NEEDS_SNAPSHOT;
- SUSPENDED immediately invalidates the provider selection;
- WebSocket quote expires at its configured TTL;
- polling quote expires at its independently configured TTL;
- source timestamp in the future beyond clock-skew policy blocks the quote.

- [ ] **Step 2: Run tests and verify red**

Run: npm.cmd test --workspace @tool-chenh/core -- quote-book.test.ts

Expected: FAIL because QuoteBook does not exist.

- [ ] **Step 3: Implement QuoteBook without wall-clock globals**

Inject nowMs into every time-sensitive method. Index by provider, providerEventId, providerMarketId and providerSelectionId. Never use Date.now inside core code. Return explicit rejection reasons such as OUT_OF_ORDER, SEQUENCE_GAP, STALE, SUSPENDED and CLOCK_SKEW.

- [ ] **Step 4: Write failing opportunity policy tests**

Construct a verified mapped market with fresh quotes and assert one opportunity. Then independently set mapping REVIEW_REQUIRED, one quote stale, one market suspended, effective margin below threshold, unavailable balance, low max stake, or OBSERVE_ONLY and assert zero executable opportunities with a visible blocked reason in diagnostics.

- [ ] **Step 5: Implement ranking and fail-closed evaluation**

Rank by net margin descending, worst-case profit descending, maximum quote age ascending, then canonical market ID for deterministic UI ordering. Emit executionConfidence HIGH only if every gate passes; blocked diagnostics are stored separately and never mixed into executable opportunities.

- [ ] **Step 6: Run tests and commit**

Run: npm.cmd test --workspace @tool-chenh/core && npm.cmd run typecheck --workspace @tool-chenh/core

Expected: PASS.

~~~powershell
git add packages/core/src/quotes packages/core/src/opportunities
git commit -m "feat: gate fresh verified opportunities"
~~~

---

### Task 7: Adapter contract, redaction, and deterministic fixtures

**Files:**
- Create: packages/adapters/package.json
- Create: packages/adapters/tsconfig.json
- Create: packages/adapters/src/provider-adapter.ts
- Create: packages/adapters/src/redaction.ts
- Create: packages/adapters/src/fixture-adapter.ts
- Create: packages/adapters/src/redaction.test.ts
- Create: packages/adapters/src/fixture-adapter.test.ts
- Create: packages/adapters/src/index.ts
- Create: fixtures/football/saba-snapshot.json
- Create: fixtures/football/im-snapshot.json
- Create: fixtures/lol/saba-snapshot.json
- Create: fixtures/lol/im-snapshot.json

**Interfaces:**
- Consumes: strict ProviderEventSchema, ProviderMarketSchema and ProviderQuoteSchema.
- Produces: ProviderAdapter.start(sink, signal): Promise<void>; ProviderSink methods onEvent, onMarket, onQuote, onStatus, onSchemaError; redactCapture(value): unknown.

- [ ] **Step 1: Write failing redaction tests**

Create a nested object containing token, access_token, cookie, authorization, accountId, memberCode, session URL parameters and ordinary provider IDs. Assert secret values become REDACTED while providerEventId, providerMarketId, selection IDs, odds and timestamps remain unchanged.

- [ ] **Step 2: Run tests and verify red**

Run: npm.cmd test --workspace @tool-chenh/adapters -- redaction.test.ts

Expected: FAIL because redactCapture does not exist.

- [ ] **Step 3: Implement recursive key and URL redaction**

Redact case-insensitive secret keys and strip sensitive query parameters from URL strings. Detect circular structures with WeakSet. The redactor must not log input on error.

- [ ] **Step 4: Create realistic synthetic fixtures**

Each file contains:

- provider status CONNECTED;
- at least two events;
- one verified-compatible event across providers;
- one deliberately ambiguous/rejected event;
- at least two supported markets;
- open, changed and suspended quote updates;
- monotonic fixture offsets instead of real account timestamps;
- no session, member, IP, account or bet data.

Football fixture includes an FT Total 2.5 and FT 1X2. LoL fixture includes Series Winner and Map 3 Winner. At least one pair produces a small positive post-fee opportunity and another produces no arbitrage.

- [ ] **Step 5: Write failing replay tests**

Use a fake scheduler. Assert FixtureAdapter emits records in offset order, validates every record through strict Zod schemas, supports replay speed, aborts through AbortSignal, and reports SCHEMA_ERROR rather than emitting malformed data.

- [ ] **Step 6: Implement fixture adapter**

~~~ts
export interface ProviderSink {
  onEvent(event: ProviderEvent): void;
  onMarket(market: ProviderMarket): void;
  onQuote(quote: ProviderQuote): void;
  onStatus(status: ProviderConnectionStatus): void;
  onSchemaError(error: AdapterSchemaError): void;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly categories: readonly Category[];
  start(sink: ProviderSink, signal: AbortSignal): Promise<void>;
}
~~~

- [ ] **Step 7: Run tests and commit**

Run: npm.cmd test --workspace @tool-chenh/adapters && npm.cmd run typecheck --workspace @tool-chenh/adapters

Expected: PASS.

~~~powershell
git add packages/adapters fixtures package.json package-lock.json
git commit -m "feat: add safe fixture adapter"
~~~

---

### Task 8: Runtime pipeline and integration coverage

**Files:**
- Create: apps/api/package.json
- Create: apps/api/tsconfig.json
- Create: apps/api/src/runtime.ts
- Create: apps/api/src/runtime.test.ts
- Create: tests/integration/pipeline.test.ts

**Interfaces:**
- Consumes: ProviderAdapter, mappers, QuoteBook and OpportunityEngine.
- Produces: Runtime.start(signal), Runtime.getSnapshot(), Runtime.subscribe(listener), Runtime.getDiagnostics().

- [ ] **Step 1: Write a failing full-pipeline integration test**

Start four FixtureAdapter instances against a fake clock. Advance through initial events and quotes. Assert:

- snapshot has separate FOOTBALL and LOL counts;
- one compatible pair is VERIFIED;
- ambiguous pair is REVIEW_REQUIRED or REJECTED;
- only the verified fresh pair creates an opportunity;
- advancing beyond TTL removes the opportunity;
- replaying a fresh quote restores it;
- a suspended update removes it immediately.

- [ ] **Step 2: Run integration test and verify red**

Run: npm.cmd run test:integration -- pipeline.test.ts

Expected: FAIL because Runtime does not exist.

- [ ] **Step 3: Implement single-process runtime**

Runtime owns adapter abort controllers, canonical candidate indexes, mapping results, QuoteBook and OpportunityEngine. Recompute only markets touched by an update. Publish immutable AppSnapshot values with a monotonically increasing revision.

No database is added in this foundation plan. The runtime exposes audit-shaped diagnostics so the later persistence plan can subscribe without changing core interfaces.

- [ ] **Step 4: Add error-path tests**

Assert one adapter schema error quarantines only that adapter/category, marks its quotes ineligible and leaves the other category observable. Assert Runtime never throws raw payloads or secrets in error messages.

- [ ] **Step 5: Run tests and commit**

Run: npm.cmd test --workspace @tool-chenh/api && npm.cmd run test:integration && npm.cmd run typecheck --workspace @tool-chenh/api

Expected: PASS.

~~~powershell
git add apps/api tests/integration package.json package-lock.json
git commit -m "feat: compose read-only arbitrage runtime"
~~~

---

### Task 9: Fastify snapshot and realtime API

**Files:**
- Create: apps/api/src/app.ts
- Create: apps/api/src/server.ts
- Create: apps/api/src/routes/health.ts
- Create: apps/api/src/routes/snapshot.ts
- Create: apps/api/src/realtime/opportunity-ws.ts
- Create: apps/api/src/app.test.ts

**Interfaces:**
- Consumes: Runtime.
- Produces: buildApp(runtime): FastifyInstance; GET /api/health; GET /api/snapshot; WS /api/realtime.

- [ ] **Step 1: Write failing API tests**

Use Fastify inject to assert:

- /api/health returns status, revision and all four provider statuses;
- /api/snapshot validates against AppSnapshotSchema;
- response headers include cache-control no-store;
- invalid category query returns 400;
- health remains 200 in observe mode when one provider is degraded, but executionReady is false.

- [ ] **Step 2: Run tests and verify red**

Run: npm.cmd test --workspace @tool-chenh/api -- app.test.ts

Expected: FAIL because buildApp does not exist.

- [ ] **Step 3: Implement routes and safe logging**

Fastify logger serializers must redact authorization, cookie, set-cookie, token-like query values and request bodies. Bind to 127.0.0.1 by default. Do not enable CORS for arbitrary origins; allow only the configured local Vite origin.

- [ ] **Step 4: Implement WebSocket snapshots**

On connection send a full snapshot. Thereafter send messages shaped as:

~~~ts
type RealtimeMessage =
  | { type: "SNAPSHOT"; revision: number; data: AppSnapshot }
  | { type: "HEARTBEAT"; revision: number; serverTimeMs: number };
~~~

Drop slow clients rather than buffering unlimited revisions. Reconnect clients always recover with a fresh full snapshot.

- [ ] **Step 5: Add WebSocket tests**

Open a test socket, assert initial snapshot, advance fixture clock, assert a higher revision, disconnect and reconnect, and assert the new full snapshot matches Runtime.getSnapshot().

- [ ] **Step 6: Run tests and commit**

Run: npm.cmd test --workspace @tool-chenh/api && npm.cmd run typecheck --workspace @tool-chenh/api

Expected: PASS.

~~~powershell
git add apps/api/src package.json package-lock.json
git commit -m "feat: expose realtime opportunity API"
~~~

---

### Task 10: Friendly React shell and category views

**Files:**
- Create: apps/web/package.json
- Create: apps/web/tsconfig.json
- Create: apps/web/vite.config.ts
- Create: apps/web/index.html
- Create: apps/web/src/main.tsx
- Create: apps/web/src/app.tsx
- Create: apps/web/src/styles.css
- Create: apps/web/src/api/client.ts
- Create: apps/web/src/components/status-strip.tsx
- Create: apps/web/src/components/event-table.tsx
- Create: apps/web/src/pages/dashboard-page.tsx
- Create: apps/web/src/pages/category-page.tsx
- Test: apps/web/src/app.test.tsx

**Interfaces:**
- Consumes: AppSnapshot and RealtimeMessage from contracts.
- Produces: accessible routes /, /football, /lol, /opportunities and /mappings.

- [ ] **Step 1: Write failing UI navigation tests**

With Testing Library render App using a fixture snapshot. Assert navigation contains Dashboard, Football, LoL, Opportunities and Mapping Review. Clicking Football shows only FOOTBALL events; clicking LoL shows only LOL events. Assert provider state is expressed with text and icon labels, not color alone.

- [ ] **Step 2: Run tests and verify red**

Run: npm.cmd test --workspace @tool-chenh/web -- app.test.tsx

Expected: FAIL because the web workspace does not exist.

- [ ] **Step 3: Implement local API client**

Fetch /api/snapshot once, connect /api/realtime, replace state only with a greater revision, reconnect with exponential delays capped at 10 seconds, and expose connection state CONNECTING, LIVE or DISCONNECTED. Do not persist snapshots or session data in localStorage.

- [ ] **Step 4: Implement responsive visual system**

Use CSS custom properties for dark neutral background, high-contrast text, provider accent colors, positive/blocked/warning states, 8px spacing rhythm and 44px minimum interactive targets. Use a fixed navigation rail on wide screens and bottom navigation on narrow screens. Respect prefers-reduced-motion.

The event table keeps stable row order from the API. Odds updates may highlight a cell for 800ms but must not reorder the row while the pointer or keyboard focus is inside it.

- [ ] **Step 5: Implement dashboard and category pages**

Dashboard cards show four adapter states, Football/LoL event counts, VERIFIED/REVIEW_REQUIRED/REJECTED counts, opportunity count and maximum quote age. CategoryPage takes category as an explicit prop and filters live/pre-match, competition, market type and mapping status.

- [ ] **Step 6: Run tests and commit**

Run: npm.cmd test --workspace @tool-chenh/web && npm.cmd run typecheck --workspace @tool-chenh/web && npm.cmd run build --workspace @tool-chenh/web

Expected: PASS.

~~~powershell
git add apps/web package.json package-lock.json
git commit -m "feat: add friendly football and lol dashboard"
~~~

---

### Task 11: Opportunity and mapping evidence UI

**Files:**
- Create: apps/web/src/components/opportunity-card.tsx
- Create: apps/web/src/components/mapping-evidence.tsx
- Create: apps/web/src/pages/opportunities-page.tsx
- Create: apps/web/src/pages/mappings-page.tsx
- Create: apps/web/src/pages/opportunities-page.test.tsx
- Create: apps/web/src/pages/mappings-page.test.tsx

**Interfaces:**
- Consumes: Opportunity, MappingEvidence and blocked diagnostics from AppSnapshot.
- Produces: read-only opportunity cards and mapping inspection UI. No arm, submit or credential controls exist.

- [ ] **Step 1: Write failing opportunity-card tests**

Assert a card renders:

- category, event and canonical market;
- full-time/first-half/series/map scope;
- line and settlement profile;
- both provider names and effective Decimal odds;
- quote age;
- exact stake per leg;
- payout for every outcome;
- worst-case profit and ROI;
- min/max constraints;
- HIGH execution confidence;
- a visible READ ONLY badge.

Assert negative or blocked diagnostics do not render as opportunity cards.

- [ ] **Step 2: Run tests and verify red**

Run: npm.cmd test --workspace @tool-chenh/web -- opportunities-page.test.tsx

Expected: FAIL because opportunity components do not exist.

- [ ] **Step 3: Implement cards with stable numeric formatting**

Use Intl.NumberFormat only at the display boundary. Preserve exact decimal strings in title attributes and accessible descriptions. Quote age updates from a local display timer but eligibility comes only from server snapshots.

- [ ] **Step 4: Write and implement mapping page tests**

Assert filters for VERIFIED, REVIEW_REQUIRED and REJECTED. Each row expands to every hard gate with expected, actual, pass/fail and reason. There is no control to mark a mapping VERIFIED in this phase, preventing unaudited alias changes.

- [ ] **Step 5: Add empty, loading, disconnected and stale states**

Every state names the reason and next safe action. A disconnected banner states that all opportunities are ineligible until fresh snapshots return.

- [ ] **Step 6: Run tests and commit**

Run: npm.cmd test --workspace @tool-chenh/web && npm.cmd run typecheck --workspace @tool-chenh/web

Expected: PASS.

~~~powershell
git add apps/web/src
git commit -m "feat: visualize verified opportunities and evidence"
~~~

---

### Task 12: End-to-end verification and protocol-capture handoff

**Files:**
- Create: playwright.config.ts
- Create: tests/e2e/dashboard.spec.ts
- Create: scripts/start-fixture-stack.mjs
- Create: docs/operator/fixture-mode.md
- Create: docs/protocol/capture-contract.md
- Modify: package.json

**Interfaces:**
- Consumes: built API/web apps and fixture runtime.
- Produces: npm run dev:fixture, npm run test:e2e, operator instructions and the exact safe capture contract needed by the next live-ingestion plan.

- [ ] **Step 1: Add fixture-stack script**

The script starts API on 127.0.0.1:4310 and Vite on 127.0.0.1:4311, waits for /api/health, forwards termination signals and exits nonzero if either child fails. It passes no credentials and loads only repository fixtures.

- [ ] **Step 2: Write failing Playwright journey**

~~~ts
test("operator can inspect separate Football and LoL opportunities", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("link", { name: "Football" }).click();
  await expect(page.getByRole("heading", { name: "Football" })).toBeVisible();
  await expect(page.getByText("FULL_TIME")).toBeVisible();
  await page.getByRole("link", { name: "LoL" }).click();
  await expect(page.getByRole("heading", { name: "LoL" })).toBeVisible();
  await expect(page.getByText("MAP_3")).toBeVisible();
  await page.getByRole("link", { name: "Opportunities" }).click();
  await expect(page.getByText("READ ONLY")).toBeVisible();
});
~~~

- [ ] **Step 3: Run E2E and verify red**

Run: npm.cmd run test:e2e

Expected: FAIL because the root test:e2e script and Playwright configuration do not exist.

- [ ] **Step 4: Wire root scripts and make E2E green**

Add dev:fixture and test:e2e scripts. Configure Playwright webServer to call npm.cmd run dev:fixture, reuseExistingServer false in CI, and baseURL http://127.0.0.1:4311.

- [ ] **Step 5: Document fixture operation**

fixture-mode.md contains exact Windows commands:

~~~powershell
npm.cmd install
npm.cmd run verify
npm.cmd run dev:fixture
~~~

It explains all pages, fixture replay controls, READ ONLY status and why no bet action exists yet.

- [ ] **Step 6: Document the live capture contract**

capture-contract.md requires the next plan to capture, redact and validate these message families:

- SABA Football: bootstrap metadata, Socket.IO connect/subscribe, full event snapshot, odds patch, suspend, heartbeat and reconnect.
- SABA LoL: the same plus series/map index and live state.
- IM Football: full live event list, event/selection delta, market suspend, pagination/lazy-load boundary and session refresh.
- IM LoL: index match, match details, repeat poll, market suspend and session refresh.

Every captured fixture must pass redactCapture, strict Zod parse and a no-secret regex scan before it can enter fixtures/captured. The document explicitly forbids CAPTCHA bypass, trader-only domains and raw credential capture.

- [ ] **Step 7: Run the complete verification suite**

Run:

~~~powershell
npm.cmd run verify
npm.cmd run build
npm.cmd run test:e2e
git status --short
~~~

Expected: all typechecks, unit tests, property tests, integration tests, builds and E2E tests pass. Git status shows only intended plan/build changes and the original untracked DOCX.

- [ ] **Step 8: Commit**

~~~powershell
git add playwright.config.ts tests/e2e scripts docs/operator docs/protocol package.json package-lock.json
git commit -m "test: verify fixture arbitrage dashboard"
~~~

## Plan self-review

### Spec coverage delivered by this plan

- Category separation: Tasks 1, 8, 10 and 12.
- Strict event/market mapping and evidence: Tasks 3 and 4.
- Odds, fees, FX and exact stake math: Tasks 2 and 5.
- Freshness, suspend, sequence and opportunity ranking: Task 6.
- Provider abstraction, redaction and schema quarantine: Task 7.
- Working realtime backend and friendly UI: Tasks 8 through 11.
- Unit, property, contract-style fixture, integration and E2E tests: Tasks 1 through 12.
- Safe preparation for live adapters: Task 12 capture contract.

### Intentionally deferred to later scoped plans

- Authenticated SABA/IM browser sessions and real network adapters.
- PostgreSQL audit persistence.
- Mapping-review writes and versioned alias approval.
- PAPER, ASSISTED and AUTO execution.
- Bet preflight, receipt parsing and reconciliation.

These are not hidden gaps: they require authenticated, redacted protocol fixtures or bet-specific fields and each produces an independently reviewable system.

### Type consistency

All adapters emit contracts from @tool-chenh/contracts. Runtime is the only orchestration owner. Core modules are pure and do not import Fastify, React, browser automation or filesystem APIs. Web consumes only AppSnapshot and RealtimeMessage. No later task calls an interface not produced by an earlier task.
