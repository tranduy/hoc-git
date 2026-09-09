import { describe, expect, it } from "vitest";
import type { ProviderId } from "@tool-chenh/contracts";
import { resultCatalog } from "./result-opposition.fixture.js";
import { buildComparisonEvents } from "./comparison.js";
import { summarizeComparisonCounts } from "./comparison-counts.js";
import { buildObservedFixedBaseStakeEstimate, enumerateOpposingLegPairs } from "../watch/fixed-base-stake.js";

const policy = { currency: "VND", baseStake: "100000", minStake: "1", maxStake: "1000000",
  stakeStep: "1", balance: "1000000" };
const providers = new Set<ProviderId>(["BTI", "CMD", "IM"]);


describe("native result versus double-chance opposing selections", () => {
  it.each(["FT", "FH", "SH"] as const)("pairs all three exhaustive %s partitions without duplicating source markets", period => {
    const result = resultCatalog("BTI", false, undefined, period);
    const dc = resultCatalog("CMD", true, undefined, period);
    const groups = buildComparisonEvents([result, dc]);
    const rows = groups.flatMap(group => group.rows);
    expect(rows).toHaveLength(3);
    expect(rows.map(row => enumerateOpposingLegPairs(row, providers).map(pair =>
      [pair.first.quote.selection, pair.second.quote.selection].sort().join("|"))).flat().sort())
      .toEqual(["AWAY|HOME_DRAW", "DRAW|HOME_AWAY", "DRAW_AWAY|HOME"].sort());
    expect(summarizeComparisonCounts(groups)).toEqual({ matchedContractCount: 3,
      crossBookPairCount: 1, matchedSourceMarketCount: 2 });
    for (const row of rows) {
      const plan = buildObservedFixedBaseStakeEstimate(row, providers, policy);
      expect(plan?.worstCaseProfit).toBe("0");
      expect(plan?.roi).toBe("0");
      expect(row.margin).toBe(0);
      for (const cell of row.cells) {
        const original = cell.provider === "BTI" ? result : dc;
        expect(cell.sourceMarket).toBe(original.markets[0]);
        expect(cell.quotes).toHaveLength(1);
        expect(original.quotes).toContain(cell.quotes[0]);
      }
    }
  });

  it("accepts one available native selection per book and counts only actual complementary routes", () => {
    const groups = buildComparisonEvents([resultCatalog("BTI", false, ["HOME"]),
      resultCatalog("CMD", false, ["HOME"]), resultCatalog("IM", true, ["DRAW_AWAY"])]);
    expect(groups.flatMap(group => group.rows)).toHaveLength(1);
    expect(summarizeComparisonCounts(groups)).toEqual({ matchedContractCount: 1,
      crossBookPairCount: 2, matchedSourceMarketCount: 3 });
  });

  it("retains both native offers of a book without ever hedging that book against itself", () => {
    const first = resultCatalog("BTI", false), extra = resultCatalog("BTI", true);
    const merged = { ...first, markets: [...first.markets, ...extra.markets], quotes: [...first.quotes, ...extra.quotes] };
    expect(buildComparisonEvents([merged]).flatMap(group => group.rows)).toEqual([]);
    const groups = buildComparisonEvents([merged, resultCatalog("CMD", false)]);
    expect(groups.flatMap(group => group.rows)).toHaveLength(3);
    for (const row of groups.flatMap(group => group.rows)) {
      const pairs = enumerateOpposingLegPairs(row, providers);
      expect(pairs).toHaveLength(1);
      expect(pairs[0]!.first.provider).not.toBe(pairs[0]!.second.provider);
      expect(buildObservedFixedBaseStakeEstimate(row, providers, policy)).not.toBeNull();
    }
  });

  it("preserves distinct native DC offers for the same side and selects the better source price", () => {
    const result = resultCatalog("BTI", false, ["HOME"]), dc = resultCatalog("CMD", true, ["DRAW_AWAY"]);
    const betterMarket = { ...dc.markets[0]!, providerMarketId: "CMD-second-dc-offer" };
    const betterQuote = { ...dc.quotes[0]!, providerMarketId: betterMarket.providerMarketId,
      providerSelectionId: "CMD-better-dc-selection", rawOdds: "3" };
    const merged = { ...dc, markets: [...dc.markets, betterMarket], quotes: [...dc.quotes, betterQuote] };
    const events = buildComparisonEvents([result, merged]), rows = events.flatMap(event => event.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells).toHaveLength(3);
    expect(enumerateOpposingLegPairs(rows[0]!, providers)).toHaveLength(2);
    const plan = buildObservedFixedBaseStakeEstimate(rows[0]!, providers, policy)!;
    expect(plan.legs.find(leg => leg.provider === "CMD")).toMatchObject({ decimalOdds: "3",
      providerMarketId: betterMarket.providerMarketId, providerSelectionId: betterQuote.providerSelectionId });
    expect(summarizeComparisonCounts(events)).toEqual({ matchedContractCount: 1,
      crossBookPairCount: 2, matchedSourceMarketCount: 3 });
  });

  it("swaps 1X and X2 without changing native selection identity", () => {
    const dc = resultCatalog("CMD", true, ["HOME_DRAW"]);
    const reversed = { ...dc, events: dc.events.map(event => ({ ...event,
      participantA: event.participantB, participantB: event.participantA })) };
    const rows = buildComparisonEvents([resultCatalog("IM", false, ["HOME"]), reversed]).flatMap(group => group.rows);
    expect(rows).toHaveLength(1);
    const leg = rows[0]!.cells.find(cell => cell.provider === "CMD")!;
    expect(leg.quotes[0]!.selection).toBe("DRAW_AWAY");
    expect(leg.sourceQuotes![0]!.selection).toBe("HOME_DRAW");
    expect(leg.quotes[0]!.providerSelectionId).toBe(dc.quotes[0]!.providerSelectionId);
  });

  it("does not invent a hedge between two result selections or mismatched periods/rules", () => {
    const result = resultCatalog("BTI", false, ["HOME"]);
    const dc = resultCatalog("CMD", true, ["DRAW_AWAY"]);
    const invalids = [resultCatalog("CMD", false, ["AWAY"]), resultCatalog("CMD", true, ["HOME_DRAW"]),
      resultCatalog("CMD", true, ["DRAW_AWAY"], "FH"),
      { ...dc, markets: dc.markets.map(market => ({ ...market, settlementProfile: "extra-time-included" })) },
      { ...dc, quotes: dc.quotes.map(quote => ({ ...quote, sequence: null })) },
      { ...dc, quotes: dc.quotes.map(quote => ({ ...quote, providerMarketId: "wrong-market" })) },
      { ...dc, quotes: dc.quotes.map(quote => ({ ...quote, status: "CLOSED" as const })) }];
    for (const invalid of invalids) expect(buildComparisonEvents([result, invalid]).flatMap(group => group.rows)).toEqual([]);
  });
});
