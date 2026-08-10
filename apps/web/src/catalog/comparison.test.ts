import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, estimatedLiveStartAtMs, formatCountdown, formatMatchClock } from "./comparison.js";

const event = (provider: "SABA" | "SBOBET", id: string): ProviderEvent => ({
  provider, category: "FOOTBALL", providerEventId: id, competition: "Eliteserien",
  seasonStage: null, startAtUtcMs: 2_000_000, participantA: "Kristiansund BK", participantB: "Molde",
  eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
  fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null
});
const catalog = (provider: "SABA" | "SBOBET", id: string, odds: readonly string[]): LiveCatalogResponse => {
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: id,
    providerMarketId: `${id}-total`, marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5",
    settlementProfile: "football-regulation-including-added-time", status: "OPEN" };
  const selections = ["OVER", "UNDER"] as const;
  const quotes: ProviderQuote[] = selections.map((selection, index) => ({ provider, category: "FOOTBALL",
    providerEventId: id, providerMarketId: market.providerMarketId, providerSelectionId: `${id}-${selection}`,
    marketType: "FT_TOTAL", scope: "FULL_TIME", selection, line: "2.5", rawOdds: odds[index]!, rawFormat: "DECIMAL",
    status: "OPEN", isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1 }));
  return { dataMode: "LIVE", accountId: id, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1, rejectedMarketCount: 0,
    events: [event(provider, id)], markets: [market], quotes };
};

const threeWayCatalog = (provider: "SABA" | "SBOBET", id: string, odds: readonly string[]): LiveCatalogResponse => {
  const base = catalog(provider, id, odds);
  const market: ProviderMarket = { ...base.markets[0]!, providerMarketId: `${id}-1x2`, marketType: "FT_1X2", line: null };
  const quotes: ProviderQuote[] = (["HOME", "DRAW", "AWAY"] as const).map((selection, index) => ({
    ...base.quotes[0]!, providerMarketId: market.providerMarketId, providerSelectionId: `${id}-${selection}`,
    marketType: "FT_1X2", selection, line: null, rawOdds: odds[index]!
  }));
  return { ...base, markets: [market], quotes };
};

const withQuotes = (source: LiveCatalogResponse, selections: readonly string[],
  marketType: "FT_TOTAL" | "FH_1X2" = "FT_TOTAL"): LiveCatalogResponse => {
  const market = { ...source.markets[0]!, marketType };
  return { ...source, markets: [market], quotes: selections.map((selection, index) => ({
    ...source.quotes[0]!, providerSelectionId: `${source.accountId}-${selection}`, marketType,
    selection, rawOdds: String(2 + index / 10)
  })) };
};

describe("catalog comparison", () => {
  it("excludes three-way football markets from comparison", () => {
    const result = buildComparisonEvents([threeWayCatalog("SABA", "saba-event", ["2.10", "3.20", "3.40"]),
      threeWayCatalog("SBOBET", "sbo-event", ["2.25", "3.10", "3.50"])]);

    expect(result[0]?.rows).toEqual([]);
    expect(result[0]?.bestMargin).toBeNull();
  });

  it("requires two providers to expose the same complete two-outcome domain", () => {
    const complete = catalog("SABA", "saba-event", ["2.20", "1.70"]);
    const incomplete = withQuotes(catalog("SBOBET", "sbo-event", ["2.10", "1.80"]), ["OVER"]);

    expect(buildComparisonEvents([complete, incomplete])[0]?.rows).toEqual([]);
  });

  it("rejects a two-selection fragment of a three-way market", () => {
    const saba = withQuotes(catalog("SABA", "saba-event", ["2.20", "1.70"]), ["HOME", "AWAY"], "FH_1X2");
    const sbobet = withQuotes(catalog("SBOBET", "sbo-event", ["2.10", "1.80"]), ["HOME", "AWAY"], "FH_1X2");

    expect(buildComparisonEvents([saba, sbobet])[0]?.rows).toEqual([]);
  });

  it("does not merge identical participants with contradictory event scopes", () => {
    const saba = catalog("SABA", "saba-event", ["2.20", "1.70"]);
    const sbobet = catalog("SBOBET", "sbo-event", ["2.10", "1.80"]);
    const changed = { ...sbobet, events: [{ ...sbobet.events[0]!, eventScope: "EXTRA_TIME" }] };

    expect(buildComparisonEvents([saba, changed])).toHaveLength(2);
  });

  it("groups the same event and makes providers columns for the same exact market", () => {
    const result = buildComparisonEvents([catalog("SABA", "saba-event", ["2.10", "3.20", "3.40"]),
      catalog("SBOBET", "sbo-event", ["2.25", "3.10", "3.50"])]);
    expect(result).toHaveLength(1);
    expect(result[0]?.providers).toEqual(["SABA", "SBOBET"]);
    expect(result[0]?.rows[0]?.cells.map((cell) => [cell.provider, cell.quotes[0]?.rawOdds])).toEqual([
      ["SABA", "2.10"], ["SBOBET", "2.25"]
    ]);
    expect(result[0]?.rows[0]?.bestBySelection.OVER).toBe("SBOBET");
  });

  it("does not merge different teams and formats a stable countdown", () => {
    const second = catalog("SBOBET", "other", ["2", "3", "4"]);
    const changed = { ...second, events: [{ ...second.events[0]!, participantB: "Rosenborg" }] };
    expect(buildComparisonEvents([catalog("SABA", "one", ["2", "3", "4"]), changed])).toHaveLength(2);
    expect(formatCountdown(2_000_000, 1_900_000)).toBe("Starts in 00:00:01:40");
    expect(formatCountdown(2_000_000, 2_000_000)).toBe("Starting / refresh pending");
  });

  it("formats provider elapsed time and derives the approximate live start from the observation", () => {
    expect(formatMatchClock({ period: "1H", scoreHome: 0, scoreAway: 0, clockMs: 660_000 })).toBe("LIVE · 1H · 11:00 elapsed");
    expect(formatMatchClock({ period: "2H", scoreHome: 1, scoreAway: 0, clockMs: 2_880_000 })).toBe("LIVE · 2H · 48:00 elapsed");
    expect(formatMatchClock({ period: null, scoreHome: null, scoreAway: null, clockMs: null })).toBe("LIVE · clock unavailable");
    expect(estimatedLiveStartAtMs(1_800_000, { period: "1H", scoreHome: 0, scoreAway: 0, clockMs: 660_000 })).toBe(1_140_000);
    expect(estimatedLiveStartAtMs(1_800_000, { period: "1H", scoreHome: 0, scoreAway: 0, clockMs: null })).toBeNull();
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
    expect(result[0]?.rows[0]?.margin).toBeCloseTo(0.538461, 5);
    expect(result[0]?.bestMargin).toBeCloseTo(0.538461, 5);
  });
});
