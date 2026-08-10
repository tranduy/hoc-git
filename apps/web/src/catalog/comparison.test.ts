import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, formatCountdown } from "./comparison.js";

const event = (provider: "SABA" | "SBOBET", id: string): ProviderEvent => ({
  provider, category: "FOOTBALL", providerEventId: id, competition: "Eliteserien",
  seasonStage: null, startAtUtcMs: 2_000_000, participantA: "Kristiansund BK", participantB: "Molde",
  eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
  fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null
});
const catalog = (provider: "SABA" | "SBOBET", id: string, odds: readonly string[]): LiveCatalogResponse => {
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: id,
    providerMarketId: `${id}-1x2`, marketType: "FT_1X2", scope: "FULL_TIME", line: null,
    settlementProfile: "football-regulation-including-added-time", status: "OPEN" };
  const selections = ["HOME", "DRAW", "AWAY"] as const;
  const quotes: ProviderQuote[] = selections.map((selection, index) => ({ provider, category: "FOOTBALL",
    providerEventId: id, providerMarketId: market.providerMarketId, providerSelectionId: `${id}-${selection}`,
    marketType: "FT_1X2", scope: "FULL_TIME", selection, line: null, rawOdds: odds[index]!, rawFormat: "DECIMAL",
    status: "OPEN", isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1 }));
  return { dataMode: "LIVE", accountId: id, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1, rejectedMarketCount: 0,
    events: [event(provider, id)], markets: [market], quotes };
};

describe("catalog comparison", () => {
  it("groups the same event and makes providers columns for the same exact market", () => {
    const result = buildComparisonEvents([catalog("SABA", "saba-event", ["2.10", "3.20", "3.40"]),
      catalog("SBOBET", "sbo-event", ["2.25", "3.10", "3.50"])]);
    expect(result).toHaveLength(1);
    expect(result[0]?.providers).toEqual(["SABA", "SBOBET"]);
    expect(result[0]?.rows[0]?.cells.map((cell) => [cell.provider, cell.quotes[0]?.rawOdds])).toEqual([
      ["SABA", "2.10"], ["SBOBET", "2.25"]
    ]);
    expect(result[0]?.rows[0]?.bestBySelection.HOME).toBe("SBOBET");
  });

  it("does not merge different teams and formats a stable countdown", () => {
    const second = catalog("SBOBET", "other", ["2", "3", "4"]);
    const changed = { ...second, events: [{ ...second.events[0]!, participantB: "Rosenborg" }] };
    expect(buildComparisonEvents([catalog("SABA", "one", ["2", "3", "4"]), changed])).toHaveLength(2);
    expect(formatCountdown(2_000_000, 1_900_000)).toBe("Starts in 00:00:01:40");
    expect(formatCountdown(2_000_000, 2_000_000)).toBe("Starting / refresh pending");
  });

  it("matches a live event across localized league names and independently observed clocks", () => {
    const saba = catalog("SABA", "one", ["2", "3", "4"]);
    const sbo = catalog("SBOBET", "two", ["2.1", "3.1", "4.1"]);
    const liveSaba: LiveCatalogResponse = { ...saba, events: [{ ...saba.events[0]!, isLive: true, startAtUtcMs: 10_000,
      competition: "Norway Eliteserien", liveState: { period: "2H", scoreHome: 1, scoreAway: 0, clockMs: 3_000_000 } } as ProviderEvent] };
    const liveSbo: LiveCatalogResponse = { ...sbo, events: [{ ...sbo.events[0]!, isLive: true, startAtUtcMs: 25_000,
      competition: "Giải VĐQG Na Uy", liveState: { period: "2H", scoreHome: 1, scoreAway: 0, clockMs: 3_001_000 } } as ProviderEvent] };
    expect(buildComparisonEvents([liveSaba, liveSbo])[0]?.providers).toEqual(["SABA", "SBOBET"]);
  });

  it("calculates and ranks a positive cross-book margin from the best complete outcomes", () => {
    const result = buildComparisonEvents([catalog("SABA", "s", ["2.50", "3.00", "4.00"]),
      catalog("SBOBET", "b", ["2.10", "4.00", "3.50"])]);
    expect(result[0]?.rows[0]?.crossBook).toBe(true);
    expect(result[0]?.rows[0]?.margin).toBeCloseTo(0.111111, 5);
    expect(result[0]?.bestMargin).toBeCloseTo(0.111111, 5);
  });
});
