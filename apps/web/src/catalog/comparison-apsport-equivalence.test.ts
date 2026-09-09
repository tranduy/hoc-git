import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import { footballBinaryMarketSpec, type MarketType } from "@tool-chenh/contracts";
import { decodeTsportCategoricalTerms } from "../../../api/src/chrome-bridge/tsport-categorical-terms.js";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";
import { summarizeComparisonCounts } from "./comparison-counts.js";
import { enumerateOpposingLegPairs } from "../watch/fixed-base-stake.js";

function catalog(provider: "APSPORT" | "BTI", marketType: MarketType, lineText: string | null,
  selections: readonly string[], swapped = false): LiveCatalogResponse {
  const result = normalizeSbobetCatalog([{ eventId: provider, leagueName: "Premier League", timeText: "PREMATCH",
    scoreText: null, startAtUtcMs: 2_000_000, teamNames: swapped ? ["Arsenal", "Liverpool"] : ["Liverpool", "Arsenal"],
    markets: [{ marketId: `${provider}-native-offer`, marketType, lineText, handicapLineFormat: "SIGNED",
      selections: selections.map((selection, i) => ({ selectionId: `${provider}-native-${i}`, selection,
        priceText: "2.1", priceFormat: "DECIMAL", locked: false, lineText: "0" })) }] }],
  { provider, observedAtMs: 1, receivedMonotonicMs: 1, sequence: 1 });
  return { dataMode: "LIVE", accountId: provider, provider, category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER",
    observedAtMs: 1, rejectedMarketCount: 0, ...result };
}

describe("AP native equivalents reach actual opposing source selections", () => {
  it.each([["10","0:0"], ["14","0:1"], ["14","6+"], ["15","3+"], ["133","0:0"], ["16","0.0"]])(
    "matches %s/%s to the opposing native BTI selection", (group, line) => {
      const terms = decodeTsportCategoricalTerms(group, line, false)!;
      const ap = catalog("APSPORT", terms.marketType, terms.lineText, terms.selections);
      const peer = catalog("BTI", terms.marketType, terms.lineText, footballBinaryMarketSpec(terms.marketType)!.outcomes);
      const events = buildComparisonEvents([ap, peer]);
      expect(summarizeComparisonCounts(events).crossBookPairCount).toBe(1);
      const routes = events.flatMap(e => e.rows.flatMap(row => enumerateOpposingLegPairs(row, new Set(["APSPORT","BTI"]))));
      expect(routes).toHaveLength(terms.selections.length);
      for (const route of routes) {
        expect(route.first.quote.selection).not.toBe(route.second.quote.selection);
        expect([route.first.quote.providerSelectionId, route.second.quote.providerSelectionId].sort())
          .toEqual(expect.arrayContaining([expect.stringMatching(/^APSPORT-native-/), expect.stringMatching(/^BTI-native-/)]));
      }
    });
  it("orients a team goal range when the other bookmaker reverses home and away", () => {
    const terms = decodeTsportCategoricalTerms("133", "0:0", false)!;
    const result = buildComparisonEvents([catalog("APSPORT", terms.marketType, terms.lineText, terms.selections),
      catalog("BTI", "HOME_FT_TOTAL", "0.5", ["OVER","UNDER"], true)]);
    expect(summarizeComparisonCounts(result).crossBookPairCount).toBe(1);
  });
  it.each([["10","2:1"], ["14","2:3"], ["68","13"], ["81","24"], ["98","24"]])(
    "does not mistake categorical %s/%s for a binary total", (group, line) => {
      const terms = decodeTsportCategoricalTerms(group, line, false)!;
      const result = buildComparisonEvents([catalog("APSPORT", terms.marketType, terms.lineText, terms.selections),
        catalog("BTI", "FT_TOTAL", "2.5", ["OVER","UNDER"])]);
      expect(summarizeComparisonCounts(result).crossBookPairCount).toBe(0);
    });
  it("proves every boundary-range conversion has the same payoff over possible integer totals", () => {
    for (let bound = 0; bound <= 20; bound++) for (let total = 0; total <= 30; total++) {
      const under = decodeTsportCategoricalTerms("14", `0:${bound}`, false)!;
      expect(total <= bound).toBe(total < Number(under.lineText));
      if (bound > 0) {
        const over = decodeTsportCategoricalTerms("14", `${bound}+`, false)!;
        expect(total >= bound).toBe(total > Number(over.lineText));
      }
    }
  });
});
