import { describe, expect, it } from "vitest";
import type { MarketType, ProviderEvent, ProviderMarket,
  ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";

const KICKOFF_MS = 2_000_000;

function fixture(provider: "SABA" | "BTI", id: string, competition: string,
  marketType: MarketType, odds: readonly [string, string]): {
    event: ProviderEvent; market: ProviderMarket; quotes: ProviderQuote[];
  } {
  const event: ProviderEvent = {
    provider, category: "FOOTBALL", providerEventId: id, competition, seasonStage: null,
    startAtUtcMs: KICKOFF_MS, participantA: "Celta Vigo", participantB: "Osasuna",
    eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
    fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null
  };
  const market: ProviderMarket = {
    provider, category: "FOOTBALL", providerEventId: id, providerMarketId: `${id}-m`,
    marketType, scope: "FULL_TIME", line: "2.5",
    settlementProfile: "football-regulation-including-added-time", status: "OPEN"
  };
  const quotes = (["OVER", "UNDER"] as const).map((selection, index): ProviderQuote => ({
    provider, category: "FOOTBALL", providerEventId: id, providerMarketId: market.providerMarketId,
    providerSelectionId: `${id}-${selection}`, marketType, scope: "FULL_TIME", selection,
    line: "2.5", rawOdds: odds[index]!, rawFormat: "DECIMAL", status: "OPEN", isLive: false,
    sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  }));
  return { event, market, quotes };
}

function catalogOf(provider: "SABA" | "BTI",
  parts: readonly ReturnType<typeof fixture>[]): LiveCatalogResponse {
  return {
    dataMode: "LIVE", accountId: `catalog-source:${provider}:FOOTBALL`, provider,
    category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1,
    rejectedMarketCount: 0, events: parts.map((part) => part.event),
    markets: parts.map((part) => part.market), quotes: parts.flatMap((part) => part.quotes)
  };
}

describe("a book's separate products are not one ambiguous fixture", () => {
  const main = fixture("SABA", "saba-main", "La Liga", "FT_TOTAL", ["2.05", "1.85"]);
  const corners = fixture("SABA", "saba-corners", "La Liga - Corners",
    "CORNER_FT_TOTAL", ["1.95", "1.95"]);
  const rival = fixture("BTI", "bti-main", "La Liga", "FT_TOTAL", ["1.90", "2.00"]);

  it("prices the main match against a rival while its side products sit alongside", () => {
    const groups = buildComparisonEvents([catalogOf("SABA", [main, corners]), catalogOf("BTI", [rival])]);
    const paired = groups.filter((group) => group.providers.length >= 2);

    expect(paired).toHaveLength(1);
    expect([...paired[0]!.providers].sort()).toEqual(["BTI", "SABA"]);
    expect(paired[0]!.rows.length).toBeGreaterThan(0);
  });

  it("still withholds a fixture a book repeats under one competition", () => {
    // Two entries a book cannot tell apart stay withheld: a rival's price has no
    // way to say which of them it belongs to.
    const repeat = fixture("SABA", "saba-repeat", "La Liga", "FT_TOTAL", ["2.10", "1.80"]);
    const groups = buildComparisonEvents([catalogOf("SABA", [main, repeat]), catalogOf("BTI", [rival])]);

    expect(groups.filter((group) => group.providers.length >= 2)).toEqual([]);
  });
});
