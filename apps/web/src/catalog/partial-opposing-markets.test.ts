import { expect, it } from "vitest";
import type { ProviderId } from "@tool-chenh/contracts";
import { resultCatalog } from "./result-opposition.fixture.js";
import { buildComparisonEvents } from "./comparison.js";
import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";
import { summarizeComparisonCounts } from "./comparison-counts.js";
import { buildObservedFixedBaseStakeEstimate, enumerateOpposingLegPairs } from "../watch/fixed-base-stake.js";
import { PriceMovementTracker } from "../watch/price-movement-tracker.js";

function binary(provider: ProviderId, selections: readonly string[], odds = "2", id = "offer") {
  const source = resultCatalog(provider, false, selections);
  const market = { ...source.markets[0]!, providerMarketId: `${provider}-${id}`, marketType: "FT_BTTS" as const,
    settlementProfile: "football-btts-regulation" };
  return { ...source, markets: [market], quotes: source.quotes.map(quote => ({ ...quote,
    marketType: market.marketType, providerMarketId: market.providerMarketId,
    providerSelectionId: `${market.providerMarketId}-${quote.selection}`, rawOdds: odds })) };
}
const selected = new Set<ProviderId>(["BTI", "CMD"]);
const policy = { currency: "VND", baseStake: "100000", minStake: "1", maxStake: "1000000",
  stakeStep: "1", balance: "1000000" };

it("pairs separately offered YES/NO native legs without manufacturing their missing outcomes", () => {
  const events = buildComparisonEvents([binary("BTI", ["YES"]), binary("CMD", ["NO"])]);
  expect(events.flatMap(event => event.rows)).toHaveLength(1);
  const row = events[0]!.rows[0]!;
  expect(row.cells.map(cell => cell.quotes.length)).toEqual([1, 1]);
  expect(enumerateOpposingLegPairs(row, selected)).toHaveLength(1);
  expect(buildObservedFixedBaseStakeEstimate(row, selected, policy)?.worstCaseProfit).toBe("0");
  expect(summarizeComparisonCounts(events)).toEqual({ matchedContractCount: 1,
    crossBookPairCount: 1, matchedSourceMarketCount: 2 });
});

it("retains a higher priced singleton beside the existing complete offer and uses its exact native identity", () => {
  const complete = binary("BTI", ["YES", "NO"], "1.8", "complete"), partial = binary("BTI", ["YES"], "3", "partial");
  const merged = { ...complete, markets: [...complete.markets, ...partial.markets], quotes: [...complete.quotes, ...partial.quotes] };
  const events = buildComparisonEvents([merged, binary("CMD", ["NO"])]), row = events[0]!.rows[0]!;
  expect(row.cells).toHaveLength(3);
  expect(enumerateOpposingLegPairs(row, selected)).toHaveLength(2);
  const plan = buildObservedFixedBaseStakeEstimate(row, selected, policy)!;
  expect(plan.legs.find(leg => leg.provider === "BTI")).toMatchObject({ decimalOdds: "3",
    providerMarketId: partial.markets[0]!.providerMarketId, providerSelectionId: partial.quotes[0]!.providerSelectionId });
  expect(Number(plan.worstCaseProfit)).toBeGreaterThan(0);
  expect(summarizeComparisonCounts(events)).toEqual({ matchedContractCount: 1,
    crossBookPairCount: 2, matchedSourceMarketCount: 3 });
});

it("retains an older but still available complete native offer and prices its better opposing leg", () => {
  const newer = binary("BTI", ["YES", "NO"], "1.8", "newer");
  const older = binary("BTI", ["YES", "NO"], "3", "older");
  const merged = { ...newer, markets: [...newer.markets, ...older.markets], quotes: [
    ...newer.quotes.map(quote => ({ ...quote, receivedMonotonicMs: 2 })), ...older.quotes] };
  const events = buildComparisonEvents([merged, binary("CMD", ["YES", "NO"])]);
  const rows = events.flatMap(event => event.rows);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.cells).toHaveLength(3);
  expect(enumerateOpposingLegPairs(rows[0]!, selected)).toHaveLength(4);
  expect(buildObservedFixedBaseStakeEstimate(rows[0]!, selected, policy)!.legs.find(leg => leg.provider === "BTI"))
    .toMatchObject({ decimalOdds: "3", providerMarketId: older.markets[0]!.providerMarketId });
  expect(summarizeComparisonCounts(events)).toEqual({ matchedContractCount: 1,
    crossBookPairCount: 2, matchedSourceMarketCount: 3 });
});

it("rejects conflicting complete offers sharing a native market identity", () => {
  const first = binary("BTI", ["YES", "NO"]);
  const conflict = { ...first, markets: [...first.markets, first.markets[0]!],
    quotes: [...first.quotes, ...first.quotes.map(quote => ({ ...quote, rawOdds: "3" }))] };
  expect(buildComparisonEvents([conflict, binary("CMD", ["YES", "NO"])]).flatMap(event => event.rows)).toEqual([]);
});

it("retains distinct singleton offers without ever treating two offers on one book as a hedge", () => {
  const first = binary("BTI", ["YES"], "3", "one"), second = binary("BTI", ["YES"], "2.8", "two");
  const merged = { ...first, markets: [...first.markets, ...second.markets], quotes: [...first.quotes, ...second.quotes] };
  const rows = buildComparisonEvents([merged, binary("CMD", ["NO"])]).flatMap(event => event.rows);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.cells).toHaveLength(3);
  const pairs = enumerateOpposingLegPairs(rows[0]!, selected);
  expect(pairs).toHaveLength(2);
  expect(pairs.every(pair => pair.first.provider !== pair.second.provider)).toBe(true);
  const tracker = new PriceMovementTracker();
  const events = buildComparisonEvents([merged, binary("CMD", ["NO"])]);
  expect(tracker.update(events, 1)).toEqual([]);
  expect(tracker.update(events, 2)).toEqual([]);
  const ownNo = binary("BTI", ["NO"], "3", "no");
  expect(buildComparisonEvents([{ ...merged, markets: [...merged.markets, ...ownNo.markets],
    quotes: [...merged.quotes, ...ownNo.quotes] }]).flatMap(event => event.rows)).toEqual([]);
});

it("rejects conflicting same-native-identity quotes and noncomplementary partial offers", () => {
  const bti = binary("BTI", ["YES"]), cmd = binary("CMD", ["NO"]);
  const conflict = { ...bti, quotes: [...bti.quotes, { ...bti.quotes[0]!, rawOdds: "3" }] };
  expect(buildComparisonEvents([conflict, cmd]).flatMap(event => event.rows)).toEqual([]);
  expect(buildComparisonEvents([bti, binary("CMD", ["YES"])]).flatMap(event => event.rows)).toEqual([]);
});

it("publishes the current singleton through the worker instead of replaying a removed native outcome", () => {
  const engine = new ComparisonWorkerEngine(), complete = binary("BTI", ["YES", "NO"]), cmd = binary("CMD", ["NO"]);
  engine.apply({ type: "RESET", generation: 1, catalogs: [complete, cmd], staleAccountIds: [] });
  const partial = binary("BTI", ["YES"], "3");
  const output = engine.apply({ type: "UPSERT", generation: 2, catalog: partial, stale: false });
  for (const events of [output.displayEvents, output.freshEvents]) {
    const cell = events.flatMap(event => event.rows).flatMap(row => row.cells).find(cell => cell.provider === "BTI")!;
    expect(cell.quotes.map(quote => [quote.selection, quote.rawOdds])).toEqual([["YES", "3"]]);
  }
});

it("keeps an OPEN leg when its other native outcome is suspended, with the suspended source quote retained", () => {
  const engine = new ComparisonWorkerEngine(), bti = binary("BTI", ["YES", "NO"]), cmd = binary("CMD", ["NO"]);
  engine.apply({ type: "RESET", generation: 1, catalogs: [bti, cmd], staleAccountIds: [] });
  const mixed = { ...bti, quotes: bti.quotes.map(quote => ({ ...quote, sequence: 2,
    status: quote.selection === "YES" ? "OPEN" as const : "SUSPENDED" as const,
    rawOdds: quote.selection === "YES" ? "3" : quote.rawOdds })) };
  const output = engine.apply({ type: "UPSERT", generation: 2, catalog: mixed, stale: false });
  for (const events of [output.displayEvents, output.freshEvents]) {
    const rows = events.flatMap(event => event.rows);
    expect(rows).toHaveLength(1);
    const cell = rows[0]!.cells.find(cell => cell.provider === "BTI")!;
    expect(cell.quotes.map(quote => [quote.selection, quote.rawOdds])).toEqual([["YES", "3"]]);
    expect(cell.sourceQuotes?.map(quote => [quote.selection, quote.status])).toEqual([["YES", "OPEN"], ["NO", "SUSPENDED"]]);
  }
  const inconsistent = { ...mixed, quotes: mixed.quotes.map((quote, index) => ({ ...quote, sequence: index + 2 })) };
  expect(buildComparisonEvents([inconsistent, cmd]).flatMap(event => event.rows)).toEqual([]);
});
