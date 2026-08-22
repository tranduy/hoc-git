import { describe, expect, it } from "vitest";
import { normalizeCmdCatalog, type CmdCatalogInputRecord } from "./cmd-normalizer.js";

describe("CMD realtime identity regressions", () => {
  it("preserves event, market and selection identity for HOME -0.25 against AWAY +0.25", () => {
    const record: CmdCatalogInputRecord = {
      sportId: "1", leagueId: "league-1", leagueName: "Premier Test", matchId: "cmd-event-25",
      timeText: "LIVE", teamNames: ["Alpha", "Beta"], groups: [{
        betTypeIds: ["1"], labels: ["0/0.5"], odds: [
          { marketOddsId: "cmd-market-25", priceText: "0.91", status: null,
            greyedOut: "false", lineText: "0/0.5" },
          { marketOddsId: "cmd-market-25", priceText: "-0.99", status: null,
            greyedOut: "false", lineText: null }
        ]
      }]
    };
    const result = normalizeCmdCatalog([record], { observedAtMs: Date.UTC(2026, 7, 9),
      receivedMonotonicMs: 5, timezoneOffsetMinutes: 420, sequence: 9 });

    expect(result.markets).toEqual([expect.objectContaining({ providerEventId: "cmd-event-25",
      providerMarketId: "cmd-market-25", marketType: "FT_AH", scope: "FULL_TIME", line: "-0.25" })]);
    expect(result.quotes.map((quote) => ({ event: quote.providerEventId, market: quote.providerMarketId,
      selectionId: quote.providerSelectionId, selection: quote.selection, canonicalHomeLine: quote.line }))).toEqual([
      { event: "cmd-event-25", market: "cmd-market-25", selectionId: "cmd-market-25:home",
        selection: "HOME", canonicalHomeLine: "-0.25" },
      { event: "cmd-event-25", market: "cmd-market-25", selectionId: "cmd-market-25:away",
        selection: "AWAY", canonicalHomeLine: "-0.25" }
    ]);
  });
});
