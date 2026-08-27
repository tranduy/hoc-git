import { describe, expect, it } from "vitest";
import type { MarketType, ProviderEvent, ProviderMarket,
  ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";

const KICKOFF_MS = 2_000_000;

function catalogOf(provider: "SABA" | "BTI", competition: string, marketType: MarketType,
  fixtures: ReadonlyArray<readonly [string, string]>): LiveCatalogResponse {
  const events: ProviderEvent[] = [];
  const markets: ProviderMarket[] = [];
  const quotes: ProviderQuote[] = [];
  fixtures.forEach(([home, away], index) => {
    const id = `${provider}-${marketType}-${index}`;
    events.push({ provider, category: "FOOTBALL", providerEventId: id, competition,
      seasonStage: null, startAtUtcMs: KICKOFF_MS, participantA: home, participantB: away,
      eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
      fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null });
    markets.push({ provider, category: "FOOTBALL", providerEventId: id,
      providerMarketId: `${id}-m`, marketType, scope: "FULL_TIME", line: "2.5",
      settlementProfile: "football-regulation-including-added-time", status: "OPEN" });
    for (const [offset, selection] of (["OVER", "UNDER"] as const).entries()) {
      quotes.push({ provider, category: "FOOTBALL", providerEventId: id,
        providerMarketId: `${id}-m`, providerSelectionId: `${id}-${selection}`, marketType,
        scope: "FULL_TIME", selection, line: "2.5", rawOdds: offset === 0 ? "2.00" : "1.90",
        rawFormat: "DECIMAL", status: "OPEN", isLive: false, sourceTimestampMs: null,
        receivedMonotonicMs: 1, sequence: 1 });
    }
  });
  return { dataMode: "LIVE", accountId: `catalog-source:${provider}:FOOTBALL`, provider,
    category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1,
    rejectedMarketCount: 0, events, markets, quotes };
}

const FIXTURES = [["Celta Vigo", "Osasuna"], ["Barcelona", "Athletic Bilbao"]] as const;

describe("competitions link only within one market family", () => {
  it("links two books' names for the same league", () => {
    const groups = buildComparisonEvents([
      catalogOf("SABA", "Spain Primera Laliga", "FT_TOTAL", FIXTURES),
      catalogOf("BTI", "La Liga", "FT_TOTAL", FIXTURES)
    ]);

    expect(groups.filter((group) => group.providers.length >= 2)).toHaveLength(2);
  });

  it("never links a corner book to a rival's match odds", () => {
    // Both carry the same teams at the same kickoff, so fixtures in common
    // cannot tell them apart; only what they price can.
    const groups = buildComparisonEvents([
      catalogOf("SABA", "Spain Primera Laliga - Corners", "CORNER_FT_TOTAL", FIXTURES),
      catalogOf("BTI", "La Liga", "FT_TOTAL", FIXTURES)
    ]);

    expect(groups.flatMap((group) => group.rows)).toEqual([]);
  });

  it("links a corner book to another book's corner book", () => {
    const groups = buildComparisonEvents([
      catalogOf("SABA", "Spain Primera Laliga - Corners", "CORNER_FT_TOTAL", FIXTURES),
      catalogOf("BTI", "La Liga Corners", "CORNER_FT_TOTAL", FIXTURES)
    ]);

    expect(groups.filter((group) => group.providers.length >= 2)).toHaveLength(2);
  });
});
