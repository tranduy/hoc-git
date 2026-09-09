import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import { footballBinaryMarketSpec, footballCategoricalMarketSpec, type MarketType } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";
import { summarizeComparisonCounts } from "./comparison-counts.js";

function catalog(provider: "BTI" | "APSPORT", marketType: MarketType, swapped = false,
  categoricalSelections?: readonly string[]): LiveCatalogResponse {
  const binary = footballBinaryMarketSpec(marketType);
  const spec = binary ?? footballCategoricalMarketSpec(marketType)!;
  const result = normalizeSbobetCatalog([{ eventId: provider, leagueName: "Premier League", timeText: "PREMATCH",
    scoreText: null, startAtUtcMs: 2_000_000, teamNames: swapped ? ["Arsenal", "Liverpool"] : ["Liverpool", "Arsenal"],
    markets: [{ marketId: `${provider}-native-offer`, marketType, lineText: spec.linePolicy === "NONE" ? null : "0.5",
      selections: (categoricalSelections ?? binary!.outcomes).map((selection, i) => ({ selectionId: `${provider}-native-${i}`, selection,
        priceText: "2.1", priceFormat: "DECIMAL", locked: false })) }] }],
  { provider, observedAtMs: 1, receivedMonotonicMs: 1, sequence: 1 });
  expect(result.markets).toHaveLength(1);
  return { dataMode: "LIVE", accountId: provider, provider, category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER",
    observedAtMs: 1, rejectedMarketCount: 0, ...result };
}

describe("BTI team props follow the team across reversed fixtures", () => {
  it.each([
    ["HOME_SH_TOTAL", "AWAY_SH_TOTAL"],
    ["HOME_FH_ODD_EVEN", "AWAY_FH_ODD_EVEN"],
    ["HOME_SH_ODD_EVEN", "AWAY_SH_ODD_EVEN"]
  ] as const)("pairs %s with reversed %s and retains the native identity", (homeType, awayType) => {
    for (const [firstType, secondType] of [[homeType, awayType], [awayType, homeType]] as const) {
      const events = buildComparisonEvents([catalog("APSPORT", firstType), catalog("BTI", secondType, true)]);
      expect(summarizeComparisonCounts(events).crossBookPairCount).toBe(1);
      const btiCell = events.flatMap(event => event.rows.flatMap(row => row.cells)).find(cell => cell.provider === "BTI")!;
      expect(btiCell.market.marketType).toBe(firstType);
      expect(btiCell.sourceMarket?.marketType).toBe(secondType);
      expect(btiCell.market.settlementProfile).toBe(footballBinaryMarketSpec(firstType)!.settlementProfile);
      expect(btiCell.sourceMarket?.settlementProfile).toBe(footballBinaryMarketSpec(secondType)!.settlementProfile);
      expect(btiCell.quotes.map(quote => quote.providerSelectionId).sort()).toEqual(["BTI-native-0", "BTI-native-1"]);
      for (const quote of btiCell.quotes) {
        expect(quote.selection).toBe(btiCell.sourceQuotes?.find(source => source.providerSelectionId === quote.providerSelectionId)
          ?.selection);
      }
      expect(summarizeComparisonCounts(buildComparisonEvents([catalog("APSPORT", firstType), catalog("BTI", firstType, true)]))
        .crossBookPairCount).toBe(0);
    }
  });

  it("keeps identical team outcomes in different halves apart", () => {
    expect(summarizeComparisonCounts(buildComparisonEvents([
      catalog("APSPORT", "HOME_FH_ODD_EVEN"), catalog("BTI", "AWAY_SH_ODD_EVEN", true)
    ])).crossBookPairCount).toBe(0);
  });

  it.each([
    ["FT_CORRECT_SCORE", ["SCORE_1_0", "SCORE_0_1"]],
    ["CORNER_FH_CORRECT_SCORE", ["SCORE_3_2", "SCORE_2_3"]],
    ["FT_SCORE_SET", ["SCORES_0_0|1_1", "SCORES_0_1|1_0"]],
    ["FT_WIN_MARGIN", ["HOME_1", "AWAY_1"]],
    ["FH_WIN_MARGIN", ["HOME_4_PLUS", "AWAY_4_PLUS"]],
    ["FH_RESULT_BTTS", ["HOME_YES", "AWAY_YES"]],
    ["SH_DRAW_NO_BET", ["HOME", "AWAY"]]
  ] as const)("does not invent a binary complement from two %s selections", (type, selections) => {
    for (const swapped of [false, true]) {
      const events = buildComparisonEvents([catalog("APSPORT", type, false, selections), catalog("BTI", type, swapped, selections)]);
      expect(summarizeComparisonCounts(events).crossBookPairCount).toBe(0);
      expect(events.flatMap(event => event.rows)).toHaveLength(0);
    }
  });
});
