import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, estimatedLiveStartAtMs, formatCountdown, formatMatchClock,
  isVisibleEvent, selectionLabel } from "./comparison.js";

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

const handicapCatalog = (provider: "SABA" | "SBOBET", id: string, line: string,
  odds: readonly string[]): LiveCatalogResponse => {
  const base = catalog(provider, id, odds);
  const market: ProviderMarket = { ...base.markets[0]!, providerMarketId: `${id}-ah-${line}`,
    marketType: "FT_AH", line };
  return { ...base, markets: [market], quotes: (["HOME", "AWAY"] as const).map((selection, index) => ({
    ...base.quotes[0]!, providerMarketId: market.providerMarketId, providerSelectionId: `${id}-${selection}`,
    marketType: "FT_AH", selection, line, rawOdds: odds[index]!, rawFormat: "MALAY"
  })) };
};

const lolCatalog = (provider: "SABA" | "IM", id: string, participantA: string, participantB: string,
  odds: readonly [string, string], settlementProfile = "lol-series-winner"): LiveCatalogResponse => {
  const lolEvent: ProviderEvent = { provider, category: "LOL", providerEventId: id, competition: "LCK CL",
    seasonStage: null, startAtUtcMs: 2_000_000, participantA, participantB, eventScope: "SERIES", bestOf: 3,
    isLive: false, rematchCandidate: false, fixtureDiscriminator: null, gameVariant: "LOL", liveState: null };
  const market: ProviderMarket = { provider, category: "LOL", providerEventId: id,
    providerMarketId: `${id}-series`, marketType: "SERIES_WINNER", scope: "SERIES", line: null,
    settlementProfile, status: "OPEN" };
  const quotes: ProviderQuote[] = (["TEAM_A", "TEAM_B"] as const).map((selection, index) => ({ provider,
    category: "LOL", providerEventId: id, providerMarketId: market.providerMarketId,
    providerSelectionId: `${id}-${selection}`, marketType: "SERIES_WINNER", scope: "SERIES", selection, line: null,
    rawOdds: odds[index]!, rawFormat: "DECIMAL", status: "OPEN", isLive: false, sourceTimestampMs: null,
    receivedMonotonicMs: 1, sequence: 1 }));
  return { dataMode: "LIVE", accountId: id, provider, category: "LOL", comparisonState: "AWAITING_SECOND_PROVIDER",
    observedAtMs: 1, rejectedMarketCount: 0, events: [lolEvent], markets: [market], quotes };
};

describe("catalog comparison", () => {
  it("hides an exact ticket until a second provider exposes the same semantic market", () => {
    const result = buildComparisonEvents([handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"])]);

    expect(result[0]?.observedRows).toEqual([]);
    expect(result[0]?.rows).toEqual([]);
  });

  it("excludes quarter-goal and three-way tickets from the observational list", () => {
    const quarter = handicapCatalog("SABA", "quarter", "-0.75", ["0.82", "-0.90"]);
    const threeWay = threeWayCatalog("SBOBET", "three", ["2.1", "3.2", "3.4"]);

    expect(buildComparisonEvents([quarter, threeWay]).every((item) => item.observedRows.length === 0)).toBe(true);
  });

  it("keeps exact lines separate and combines the same line across providers", () => {
    const result = buildComparisonEvents([
      handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]),
      handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"])
    ]);

    expect(result[0]?.observedRows).toHaveLength(1);
    expect(result[0]?.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SABA", "SBOBET"]);
  });

  it("matches the same Vietnamese club across provider accents and the CLB display prefix", () => {
    const saba = handicapCatalog("SABA", "saba-vn", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-vn", "-0.5", ["0.78", "-0.86"]);
    const localizedSaba = { ...saba, events: [{ ...saba.events[0]!, participantA: "Adelaide United",
      participantB: "CLB Công An Hà Nội" }] };
    const localizedSbobet = { ...sbobet, events: [{ ...sbobet.events[0]!, participantA: "Adelaide United",
      participantB: "Cong An Ha Noi" }] };

    expect(buildComparisonEvents([localizedSaba, localizedSbobet])).toHaveLength(1);
  });

  it("matches a reversed LoL participant order and reorients TEAM_A/TEAM_B to the anchor event", () => {
    const saba = lolCatalog("SABA", "saba-lol", "Nongshim Esports Academy", "Dplus KIA Challengers", ["2.20", "1.65"],
      "saba-esports-two-way-moneyline");
    const im = lolCatalog("IM", "im-lol", "Dplus KIA Challengers", "Nongshim Esports Academy", ["1.70", "2.10"],
      "im-esports-series-winner");

    const result = buildComparisonEvents([saba, im]);

    expect(result).toHaveLength(1);
    expect(result[0]?.providers).toEqual(["SABA", "IM"]);
    const imCell = result[0]?.observedRows[0]?.cells.find((cell) => cell.provider === "IM");
    expect(imCell?.quotes.map((quote) => [quote.selection, quote.rawOdds])).toEqual([
      ["TEAM_A", "2.10"], ["TEAM_B", "1.70"]
    ]);
    expect(result[0]?.rows).toEqual([]);
    expect(result[0]?.bestMargin).toBeNull();
    expect(selectionLabel(result[0]!.event, "TEAM_A")).toBe("Nongshim Esports Academy");
    expect(selectionLabel(result[0]!.event, "TEAM_B")).toBe("Dplus KIA Challengers");
  });

  it("does not reverse-match football because HOME/AWAY handicap orientation is not proven safe", () => {
    const saba = handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"]);
    const reversed = { ...sbobet, events: [{ ...sbobet.events[0]!, participantA: "Molde", participantB: "Kristiansund BK" }] };

    expect(buildComparisonEvents([saba, reversed])).toHaveLength(2);
  });

  it("shows same-ticket prices but blocks profit when settlement profiles differ", () => {
    const saba = handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"]);
    const unverified = { ...sbobet, markets: [{ ...sbobet.markets[0]!, settlementProfile: "provider-specific-unverified" }] };

    const result = buildComparisonEvents([saba, unverified]);

    expect(result[0]?.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SABA", "SBOBET"]);
    expect(result[0]?.rows).toEqual([]);
    expect(result[0]?.bestMargin).toBeNull();
  });

  it("rejects an ambiguous provider contribution instead of merging duplicate semantic markets", () => {
    const saba = handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]);
    const duplicateMarket = { ...saba.markets[0]!, providerMarketId: "saba-duplicate" };
    const duplicateQuotes = saba.quotes.map((quote) => ({ ...quote,
      providerMarketId: duplicateMarket.providerMarketId,
      providerSelectionId: `${quote.providerSelectionId}-duplicate`
    }));
    const ambiguous = { ...saba, markets: [...saba.markets, duplicateMarket], quotes: [...saba.quotes, ...duplicateQuotes] };
    const sbobet = handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"]);

    const result = buildComparisonEvents([ambiguous, sbobet]);

    expect(result[0]?.observedRows).toEqual([]);
    expect(result[0]?.rows).toEqual([]);
  });

  it("shows only live events and pre-match events in the next two hours", () => {
    const now = 1_000_000;
    expect(isVisibleEvent({ ...event("SABA", "live"), isLive: true, startAtUtcMs: 1 }, now)).toBe(true);
    expect(isVisibleEvent({ ...event("SABA", "soon"), startAtUtcMs: now + 7_200_000 }, now)).toBe(true);
    expect(isVisibleEvent({ ...event("SABA", "later"), startAtUtcMs: now + 7_200_001 }, now)).toBe(false);
    expect(isVisibleEvent({ ...event("SABA", "old"), startAtUtcMs: now - 1 }, now)).toBe(false);
  });

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

  it("matches the same prematch teams when provider kickoff clocks differ by at most two minutes", () => {
    const saba = catalog("SABA", "saba-event", ["2.20", "1.70"]);
    const sbobet = catalog("SBOBET", "sbo-event", ["2.10", "1.80"]);
    const shifted = { ...sbobet, events: [{ ...sbobet.events[0]!, startAtUtcMs: 2_060_000 }] };

    expect(buildComparisonEvents([saba, shifted])).toHaveLength(1);
    expect(buildComparisonEvents([saba, { ...shifted,
      events: [{ ...shifted.events[0]!, startAtUtcMs: 2_120_001 }] }])).toHaveLength(2);
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
