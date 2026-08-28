import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, createCompetitionLinkMemory, estimatedLiveStartAtMs, formatCountdown, formatMatchClock,
  isVisibleEvent, matchesEventPhase, selectionHandicapLine, selectionLabel, decimalOdds } from "./comparison.js";

const event = (provider: "SABA" | "SBOBET", id: string): ProviderEvent => ({
  provider, category: "FOOTBALL", providerEventId: id, competition: "Eliteserien",
  seasonStage: null, startAtUtcMs: 2_000_000, participantA: "Kristiansund BK", participantB: "Molde",
  eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
  fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null
});

it("filters a catalog event by its provider-confirmed live state", () => {
  const prematch = event("SABA", "prematch");
  const live = { ...prematch, providerEventId: "live", isLive: true };

  expect(matchesEventPhase(prematch, new Set(["PREMATCH"]))).toBe(true);
  expect(matchesEventPhase(prematch, new Set(["LIVE"]))).toBe(false);
  expect(matchesEventPhase(live, new Set(["LIVE"]))).toBe(true);
});

it("converts positive Hong Kong odds to decimal and rejects unsafe HK values", () => {
  const base: ProviderQuote = {
    provider: "SABA", category: "FOOTBALL", providerEventId: "event", providerMarketId: "market",
    providerSelectionId: "selection", marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME",
    line: "-0.5", rawOdds: "0.95", rawFormat: "HK", status: "OPEN", isLive: true,
    sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  };

  expect(decimalOdds(base)).toBe(1.95);
  expect(decimalOdds({ ...base, rawOdds: "0" })).toBeNull();
  expect(decimalOdds({ ...base, rawOdds: "-0.1" })).toBeNull();
  expect(decimalOdds({ ...base, rawOdds: "Infinity" })).toBeNull();
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

const decimalHandicapCatalog = (provider: "SABA" | "SBOBET", id: string, line: string,
  odds: readonly string[]): LiveCatalogResponse => {
  const value = handicapCatalog(provider, id, line, odds);
  return { ...value, quotes: value.quotes.map((quote) => ({ ...quote, rawFormat: "DECIMAL" as const })) };
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
  it("indexes markets and quotes once instead of rescanning the full catalog for every event", () => {
    const sources = Array.from({ length: 20 }, (_, index) => {
      const value = handicapCatalog("SABA", `event-${index}`, "-0.5", ["0.82", "-0.90"]);
      return { event: { ...value.events[0]!, participantA: `Home ${index}`,
        participantB: `Away ${index}` }, market: value.markets[0]!, quotes: value.quotes };
    });
    let marketFilterCalls = 0;
    let quoteFilterCalls = 0;
    const markets = new Proxy(sources.map((source) => source.market), { get(target, property, receiver) {
      if (property === "filter") marketFilterCalls += 1;
      return Reflect.get(target, property, receiver);
    } });
    const quotes = new Proxy(sources.flatMap((source) => source.quotes), { get(target, property, receiver) {
      if (property === "filter") quoteFilterCalls += 1;
      return Reflect.get(target, property, receiver);
    } });
    const source: LiveCatalogResponse = { ...handicapCatalog("SABA", "seed", "-0.5", ["0.82", "-0.90"]),
      events: sources.map((item) => item.event), markets, quotes };

    expect(buildComparisonEvents([source])).toHaveLength(20);
    expect(marketFilterCalls).toBeLessThanOrEqual(1);
    expect(quoteFilterCalls).toBeLessThanOrEqual(1);
  });

  it("shows a single-provider ticket for observation but keeps it out of verified comparison rows", () => {
    const result = buildComparisonEvents([handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"])]);

    expect(result[0]?.observedRows).toHaveLength(1);
    expect(result[0]?.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SABA"]);
    expect(result[0]?.rows).toEqual([]);
  });

  it("includes quarter-goal Asian tickets but excludes three-way tickets", () => {
    const quarter = handicapCatalog("SABA", "quarter", "-0.75", ["0.82", "-0.90"]);
    const threeWay = threeWayCatalog("SBOBET", "three", ["2.1", "3.2", "3.4"]);

    const result = buildComparisonEvents([quarter, threeWay]);
    expect(result.find((item) => item.event.providerEventId === "quarter")?.observedRows).toHaveLength(1);
    expect(result.some((item) => item.event.providerEventId === "three")).toBe(false);
  });

  it("keeps quarter-goal totals in the verified ranking rows", () => {
    const combine = (focused: LiveCatalogResponse, unsupported: LiveCatalogResponse): LiveCatalogResponse => ({
      ...focused,
      markets: [...focused.markets, ...unsupported.markets],
      quotes: [...focused.quotes, ...unsupported.quotes]
    });
    const quarterTotal = (source: LiveCatalogResponse): LiveCatalogResponse => ({ ...source,
      markets: source.markets.map((market) => ({ ...market, line: "2.25" })),
      quotes: source.quotes.map((quote) => ({ ...quote, line: "2.25" })) });
    const result = buildComparisonEvents([
      combine(handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]),
        quarterTotal(catalog("SABA", "saba-event", ["2.2", "2.2"]))),
      combine(handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"]),
        quarterTotal(catalog("SBOBET", "sbo-event", ["2.3", "2.1"])))
    ]);

    expect(result[0]?.rows.map((row) => [row.marketType, row.line]).sort()).toEqual([
      ["FT_AH", "-0.5"], ["FT_TOTAL", "2.25"]
    ].sort());
  });

  it("keeps exact lines separate and combines the same line across providers", () => {
    const result = buildComparisonEvents([
      handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]),
      handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"])
    ]);

    expect(result[0]?.observedRows).toHaveLength(1);
    expect(result[0]?.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SABA", "SBOBET"]);
  });

  it("compares exact full-time half-goal totals across providers", () => {
    const result = buildComparisonEvents([
      catalog("SABA", "saba-total", ["2.20", "1.72"]),
      catalog("SBOBET", "sbobet-total", ["2.08", "1.85"])
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.observedRows).toHaveLength(1);
    expect(result[0]?.rows).toHaveLength(1);
    expect(result[0]?.rows[0]).toMatchObject({
      marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5"
    });
    expect(result[0]?.rows[0]?.cells.map((cell) => [cell.provider,
      cell.quotes.map((quote) => quote.selection)])).toEqual([
      ["SABA", ["OVER", "UNDER"]], ["SBOBET", ["OVER", "UNDER"]]
    ]);
  });

  it.each([
    ["missing line", { line: null }, { line: null }],
    ["different lines", { line: "2.5" }, { line: "3.5" }],
    ["different settlement", { settlementProfile: "football-regulation-including-added-time" },
      { settlementProfile: "provider-specific-total" }]
  ])("does not verify full-time totals with %s", (_caseName, leftMarket, rightMarket) => {
    const left = catalog("SABA", "saba-total", ["2.20", "1.72"]);
    const right = catalog("SBOBET", "sbobet-total", ["2.08", "1.85"]);
    const change = (source: LiveCatalogResponse, marketPatch: Partial<ProviderMarket>): LiveCatalogResponse => {
      const market = { ...source.markets[0]!, ...marketPatch };
      return { ...source, markets: [market], quotes: source.quotes.map((quote) => ({
        ...quote, line: market.line
      })) };
    };

    const result = buildComparisonEvents([change(left, leftMarket), change(right, rightMarket)]);
    expect(result.flatMap((item) => item.rows)).toEqual([]);
  });

  it("does not accept HOME and AWAY as the outcome domain for a total", () => {
    const wrongDomain = (source: LiveCatalogResponse): LiveCatalogResponse => ({ ...source,
      quotes: source.quotes.map((quote, index) => ({ ...quote, selection: index === 0 ? "HOME" : "AWAY" })) });

    const result = buildComparisonEvents([
      wrongDomain(catalog("SABA", "saba-total", ["2.20", "1.72"])),
      wrongDomain(catalog("SBOBET", "sbobet-total", ["2.08", "1.85"]))
    ]);
    expect(result.flatMap((item) => item.rows)).toEqual([]);
  });

  it("rejects a provider market with duplicate outcomes instead of hiding them behind a set", () => {
    const duplicateOutcome = (source: LiveCatalogResponse): LiveCatalogResponse => ({ ...source,
      quotes: [...source.quotes, { ...source.quotes[0]!, providerSelectionId: `${source.accountId}-duplicate` }]
    });

    const result = buildComparisonEvents([
      duplicateOutcome(handicapCatalog("SABA", "saba-ah", "-0.5", ["0.82", "-0.90"])),
      handicapCatalog("SBOBET", "sbo-ah", "-0.5", ["0.78", "-0.86"])
    ]);

    expect(result.flatMap((item) => item.rows)).toEqual([]);
  });

  it("rejects quote provenance that does not match its provider market", () => {
    const contradictory = handicapCatalog("SABA", "saba-ah", "-0.5", ["0.82", "-0.90"]);
    const malformed = { ...contradictory, quotes: contradictory.quotes.map((quote) => ({
      ...quote, providerEventId: "different-event"
    })) };

    const result = buildComparisonEvents([
      malformed,
      handicapCatalog("SBOBET", "sbo-ah", "-0.5", ["0.78", "-0.86"])
    ]);

    expect(result.flatMap((item) => item.rows)).toEqual([]);
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

  it("matches leading football club designators used by different providers", () => {
    const saba = handicapCatalog("SABA", "saba-club", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-club", "-0.5", ["0.78", "-0.86"]);
    const namedSaba = { ...saba, events: [{ ...saba.events[0]!, participantA: "Sporting Braga U23",
      participantB: "SC Farense U23" }] };
    const namedSbobet = { ...sbobet, events: [{ ...sbobet.events[0]!, participantA: "Sporting Braga U23",
      participantB: "Farense U23" }] };

    expect(buildComparisonEvents([namedSaba, namedSbobet])).toHaveLength(1);
  });

  it.each([
    ["Kairat Almaty", "Levski Sofia", "Kairat Almaty (N)", "Levski Sofia"],
    ["Bodo Glimt", "Union Saint-Gilloise", "Bodo Glimt", "St Gilloise"],
    ["Sabah Baku", "AGF Aarhus", "Sabah", "AGF Aarhus"],
    ["JJK Jyvaskyla", "Tampere United", "JJK Jyvaskyla", "Tampere Utd"],
    ["PK Keski Uusimaa", "Inter Turku 2", "PK Keski Uusimaa", "Inter Turku II"],
    ["Trikala FC", "AE Larissa", "Trikala", "AE Larissa"]
  ])("matches verified provider naming variants for %s vs %s", (sabaA, sabaB, sbobetA, sbobetB) => {
    const saba = handicapCatalog("SABA", "saba-alias", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-alias", "-0.5", ["0.78", "-0.86"]);
    const namedSaba = { ...saba, events: [{ ...saba.events[0]!, participantA: sabaA, participantB: sabaB }] };
    const namedSbobet = { ...sbobet, events: [{ ...sbobet.events[0]!, participantA: sbobetA, participantB: sbobetB }] };

    const result = buildComparisonEvents([namedSaba, namedSbobet]);
    expect(result).toHaveLength(1);
    expect(result[0]?.rows[0]?.cells.map((cell) => cell.provider)).toEqual(["SABA", "SBOBET"]);
  });

  it("does not fuzzy-match similar but different teams", () => {
    const saba = handicapCatalog("SABA", "saba-near", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-near", "-0.5", ["0.78", "-0.86"]);
    const namedSaba = { ...saba, events: [{ ...saba.events[0]!, participantA: "Hapoel Kfar Saba",
      participantB: "Kiryat Yam SC" }] };
    const namedSbobet = { ...sbobet, events: [{ ...sbobet.events[0]!, participantA: "Hapoel Kfar Shalem",
      participantB: "Kiryat Gat" }] };

    expect(buildComparisonEvents([namedSaba, namedSbobet])).toHaveLength(2);
  });

  it.each([
    ["FC Machida Zelvia", "Iwate Grulla Morioka", "FC Machida Zelvia", "Grulla Morioka"],
    ["RB Omiya Ardija", "V-Varen Nagasaki", "Omiya Ardija", "V-Varen Nagasaki"],
    ["AEK Athens", "Levski Sofia", "AEK Athens", "PFC Levski Sofia"],
    ["Golden Arrows", "Kaizer Chiefs", "Lamontville Golden Arrows FC", "Kaizer Chiefs"],
    ["Preston North End", "Bradford City", "Preston", "Bradford"]
  ])("matches conservative provider-native football aliases for %s vs %s", (leftA, leftB, rightA, rightB) => {
    const saba = handicapCatalog("SABA", "saba-provider-name", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-provider-name", "-0.5", ["0.78", "-0.86"]);
    const left = { ...saba, events: [{ ...saba.events[0]!, participantA: leftA, participantB: leftB }] };
    const right = { ...sbobet, events: [{ ...sbobet.events[0]!, participantA: rightA, participantB: rightB }] };

    expect(buildComparisonEvents([left, right]).filter((entry) => entry.providers.length === 2)).toHaveLength(1);
  });

  it("does not merge a fantasy composite with a real football fixture", () => {
    const saba = handicapCatalog("SABA", "saba-fantasy", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-real", "-0.5", ["0.78", "-0.86"]);
    const fantasy = { ...saba, events: [{ ...saba.events[0]!, competition: "FANTASY MATCH",
      participantA: "Burnley + Strommen IF", participantB: "Arsenal + Raufoss IL" }] };
    const real = { ...sbobet, events: [{ ...sbobet.events[0]!, competition: "FANTASY MATCH",
      participantA: "Strommen IF", participantB: "Raufoss IL" }] };

    expect(buildComparisonEvents([fantasy, real]).filter((entry) => entry.providers.length === 2)).toEqual([]);
  });

  it("matches Vietnamese and English women qualifiers plus localized competition names", () => {
    const saba = handicapCatalog("SABA", "saba-women", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-women", "-0.5", ["0.78", "-0.86"]);
    const english = { ...saba, events: [{ ...saba.events[0]!,
      competition: "New Zealand - NRFL Premier Division Women",
      participantA: "Auckland United [W]", participantB: "Fencibles United [W]" }] };
    const vietnamese = { ...sbobet, events: [{ ...sbobet.events[0]!,
      competition: "NEW ZEALAND NRFL WOMEN PREMIERSHIP",
      participantA: "Auckland United (Nữ)", participantB: "Fencibles United (Nữ)" }] };

    const matched = buildComparisonEvents([english, vietnamese]).filter((entry) => entry.providers.length === 2);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.rows).toHaveLength(1);
  });

  it("fails closed when one provider has duplicate same-team fixtures at the same kickoff", () => {
    const saba = handicapCatalog("SABA", "saba-one", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-one", "-0.5", ["0.78", "-0.86"]);
    const ambiguousSaba = { ...saba, events: [...saba.events,
      { ...saba.events[0]!, providerEventId: "saba-rematch" }] };

    const result = buildComparisonEvents([ambiguousSaba, sbobet]);
    expect(result.some((item) => item.providers.length > 1)).toBe(false);
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

  it("matches the same LoL series across a provider spacing alias and a 20-minute kickoff drift", () => {
    const saba = lolCatalog("SABA", "132343065", "ThunderTalk Gaming", "Bilibili Gaming", ["2.20", "1.65"]);
    const imBase = lolCatalog("IM", "41365427", "Bilibili Gaming", "Thunder Talk Gaming", ["1.70", "2.10"]);
    const im = { ...imBase, events: [{ ...imBase.events[0]!, startAtUtcMs: 3_200_000 }] };

    const result = buildComparisonEvents([saba, im]);

    expect(result).toHaveLength(1);
    expect(result[0]?.providers).toEqual(["SABA", "IM"]);
    expect(result[0]?.rows).toHaveLength(1);
    const differentBestOf: LiveCatalogResponse = { ...im,
      events: [{ ...im.events[0]!, bestOf: 5 } as ProviderEvent] };
    expect(buildComparisonEvents([saba, differentBestOf])).toHaveLength(2);
  });

  it("matches verified LoL academy aliases without fuzzy participant matching", () => {
    const giantx = lolCatalog("SABA", "giantx-saba", "GIANTX iTero", "FALKE ESPORTS", ["2.20", "1.65"]);
    const academy = lolCatalog("IM", "giantx-im", "FALKE ESPORTS", "GIANTX Academy", ["1.70", "2.10"]);

    const result = buildComparisonEvents([giantx, academy]);

    expect(result).toHaveLength(1);
    expect(result[0]?.providers).toEqual(["SABA", "IM"]);
    expect(result[0]?.rows).toHaveLength(1);
  });

  it("decodes numeric HTML entities and matches the verified Los Heretics academy alias", () => {
    const im = lolCatalog("IM", "heretics-im", "Movistar KOI F&#233;nix", "Team Heretics Academy",
      ["2.20", "1.65"]);
    const saba = lolCatalog("SABA", "heretics-saba", "Los Heretics", "Movistar KOI Fenix", ["1.70", "2.10"]);

    const result = buildComparisonEvents([im, saba]);

    expect(result).toHaveLength(1);
    expect(result[0]?.providers).toEqual(["SABA", "IM"]);
    expect(result[0]?.rows).toHaveLength(1);
    expect(result[0]?.event.participantA).toBe("Los Heretics");
  });

  it("keeps the fixed provider order and highest-priority event labels when catalog arrival order changes", () => {
    const sabaBase = handicapCatalog("SABA", "saba-priority", "-0.5", ["0.82", "-0.90"]);
    const saba = { ...sabaBase, events: [{ ...sabaBase.events[0]!, fixtureDiscriminator: "fixture-priority" }] };
    const sbobetBase = handicapCatalog("SBOBET", "sbobet-priority", "0.5", ["0.78", "-0.86"]);
    const sbobet = { ...sbobetBase, events: [{ ...sbobetBase.events[0]!,
      competition: "SB localized league", participantA: "Molde", participantB: "Kristiansund BK",
      fixtureDiscriminator: "fixture-priority" }] };

    const forward = buildComparisonEvents([saba, sbobet]);
    const reversed = buildComparisonEvents([sbobet, saba]);

    for (const result of [forward, reversed]) {
      expect(result).toHaveLength(1);
      expect(result[0]?.providers).toEqual(["SABA", "SBOBET"]);
      expect(result[0]?.catalogs.map((source) => source.provider)).toEqual(["SABA", "SBOBET"]);
      expect(result[0]?.event.competition).toBe("Eliteserien");
      expect(result[0]?.event.participantA).toBe("Kristiansund BK");
      expect(result[0]?.event.participantB).toBe("Molde");
      expect(result[0]?.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SABA", "SBOBET"]);
    }
  });

  it("rejects LoL series-winner rows whose outcome domain is not TEAM_A and TEAM_B", () => {
    const invalid = (source: LiveCatalogResponse): LiveCatalogResponse => ({ ...source,
      quotes: source.quotes.map((quote, index) => ({ ...quote, selection: index === 0 ? "OVER" : "UNDER" })) });
    const result = buildComparisonEvents([
      invalid(lolCatalog("SABA", "saba-lol", "Alpha", "Beta", ["2.2", "1.7"])),
      invalid(lolCatalog("IM", "im-lol", "Alpha", "Beta", ["2.1", "1.8"]))
    ]);

    expect(result[0]?.rows).toEqual([]);
    expect(result[0]?.observedRows).toEqual([]);
  });

  it("reverse-matches football only after reorienting HOME/AWAY and the handicap sign", () => {
    const saba = handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-event", "0.5", ["0.78", "-0.86"]);
    const reversed = { ...sbobet, events: [{ ...sbobet.events[0]!, participantA: "Molde", participantB: "Kristiansund BK" }] };

    const result = buildComparisonEvents([saba, reversed]);
    expect(result).toHaveLength(1);
    expect(result[0]?.observedRows[0]?.line).toBe("-0.5");
    expect(result[0]?.observedRows[0]?.cells[1]?.quotes.map((quote) => [quote.selection, quote.rawOdds])).toEqual([
      ["AWAY", "0.78"], ["HOME", "-0.86"]
    ]);
    const sourceCell = result[0]?.observedRows[0]?.cells.find((cell) => cell.provider === "SBOBET");
    expect(sourceCell?.sourceEvent).toMatchObject({ participantA: "Molde", participantB: "Kristiansund BK" });
    expect(sourceCell?.sourceMarket?.line).toBe("0.5");
    expect(sourceCell?.sourceQuotes?.map((quote) => [quote.providerSelectionId, quote.selection, quote.line])).toEqual([
      ["sbo-event-HOME", "HOME", "0.5"], ["sbo-event-AWAY", "AWAY", "0.5"]
    ]);
  });

  it("canonicalizes equivalent numeric lines before matching the same market", () => {
    const saba = handicapCatalog("SABA", "saba-event", "-0.250", ["0.82", "-0.90"]);
    const sbobet = handicapCatalog("SBOBET", "sbo-event", "-0.25", ["0.78", "-0.86"]);

    const result = buildComparisonEvents([saba, sbobet]);

    expect(result[0]?.rows).toHaveLength(1);
    expect(result[0]?.rows[0]?.line).toBe("-0.25");
  });

  it("keeps Coquimbo handicap signs attached to teams after reversing provider participants", () => {
    const sbobetBase = handicapCatalog("SBOBET", "sbobet-coquimbo", "0.25", ["-0.51", "0.51"]);
    const sbobet = { ...sbobetBase, events: [{ ...sbobetBase.events[0]!, competition: "Copa Libertadores",
      participantA: "CA Platense", participantB: "Coquimbo Unido" }] };
    const sabaBase = handicapCatalog("SABA", "saba-coquimbo", "-0.25", ["-0.67", "0.67"]);
    const saba = { ...sabaBase, events: [{ ...sabaBase.events[0]!, competition: "Copa Libertadores",
      participantA: "Coquimbo Unido", participantB: "CA Platense" }] };

    const result = buildComparisonEvents([sbobet, saba]);
    const row = result[0]?.rows[0];

    expect(row?.line).toBe("-0.25");
    expect(selectionHandicapLine(row!, "HOME")).toBe("-0.25");
    expect(selectionHandicapLine(row!, "AWAY")).toBe("+0.25");
    expect(row?.cells.find((cell) => cell.provider === "SBOBET")?.quotes.map((quote) =>
      [quote.selection, quote.line])).toEqual([["AWAY", "-0.25"], ["HOME", "-0.25"]]);
  });

  it("rejects a half-updated provider market whose opposing quotes come from different generations", () => {
    const saba = handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]);
    const halfUpdated = { ...saba, quotes: saba.quotes.map((quote, index) => ({ ...quote,
      sequence: index === 0 ? 41 : 42 })) };
    const sbobet = handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"]);

    const result = buildComparisonEvents([halfUpdated, sbobet]);

    expect(result[0]?.rows).toEqual([]);
    expect(result[0]?.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SBOBET"]);
  });

  it("does not pair pre-match quotes with a provider-confirmed live event", () => {
    const liveState = { period: "1H", scoreHome: 0, scoreAway: 0, clockMs: 600_000 } as const;
    const sabaBase = handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]);
    const sbobetBase = handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"]);
    const sabaEvent = sabaBase.events[0]!;
    const sbobetEvent = sbobetBase.events[0]!;
    if (sabaEvent.category !== "FOOTBALL" || sbobetEvent.category !== "FOOTBALL") {
      throw new Error("handicap fixture must contain football events");
    }
    const saba = { ...sabaBase, events: [{ ...sabaEvent, isLive: true, liveState }],
      quotes: sabaBase.quotes.map((quote) => ({ ...quote, isLive: false })) };
    const sbobet = { ...sbobetBase, events: [{ ...sbobetEvent, isLive: true, liveState }],
      quotes: sbobetBase.quotes.map((quote) => ({ ...quote, isLive: true })) };

    const result = buildComparisonEvents([saba, sbobet]);

    expect(result).toHaveLength(1);
    expect(result[0]?.rows).toEqual([]);
    expect(result[0]?.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SBOBET"]);
  });

  it("does not pair same-name prematch participants across different competitions", () => {
    const saba = handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]);
    const sbobetBase = handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"]);
    const sbobet = { ...sbobetBase, events: [{ ...sbobetBase.events[0]!, competition: "Reserve League" }] };

    const result = buildComparisonEvents([saba, sbobet]);

    expect(result).toHaveLength(2);
    expect(result.flatMap((item) => item.rows)).toEqual([]);
  });

  it("matches verified localized competition identities without fuzzy league text", () => {
    const sabaBase = handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]);
    const saba = { ...sabaBase, events: [{ ...sabaBase.events[0]!,
      competition: "VÒNG LOẠI CÚP C3 CHÂU ÂU (PLAY OFF)" }] };
    const sbobetBase = handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"]);
    const sbobet = { ...sbobetBase, events: [{ ...sbobetBase.events[0]!,
      competition: "UEFA Europa Conference League Qualification" }] };

    expect(buildComparisonEvents([saba, sbobet])[0]?.rows).toHaveLength(1);
  });

  it("rejects opposing quotes with an unknown generation", () => {
    const saba = handicapCatalog("SABA", "saba-event", "-0.5", ["0.82", "-0.90"]);
    const unknownGeneration = { ...saba, quotes: saba.quotes.map((quote) => ({ ...quote, sequence: null })) };
    const sbobet = handicapCatalog("SBOBET", "sbo-event", "-0.5", ["0.78", "-0.86"]);

    const result = buildComparisonEvents([unknownGeneration, sbobet]);

    expect(result[0]?.rows).toEqual([]);
    expect(result[0]?.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SBOBET"]);
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

    expect(result[0]?.observedRows).toHaveLength(1);
    expect(result[0]?.observedRows[0]?.cells.map((cell) => cell.provider)).toEqual(["SBOBET"]);
    expect(result[0]?.rows).toEqual([]);
  });

  it("shows live events and pre-match events in the next 24 hours", () => {
    const now = 1_000_000;
    expect(isVisibleEvent({ ...event("SABA", "live"), isLive: true, startAtUtcMs: 1 }, now)).toBe(true);
    expect(isVisibleEvent({ ...event("SABA", "soon"), startAtUtcMs: now + 86_400_000 }, now)).toBe(true);
    expect(isVisibleEvent({ ...event("SABA", "later"), startAtUtcMs: now + 86_400_001 }, now)).toBe(false);
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
    const result = buildComparisonEvents([decimalHandicapCatalog("SABA", "saba-event", "-0.5", ["2.10", "3.20"]),
      decimalHandicapCatalog("SBOBET", "sbo-event", "-0.5", ["2.25", "3.10"])]);
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

  it("accepts missing live score evidence but rejects a contradictory known score or period", () => {
    const saba = handicapCatalog("SABA", "one", "-0.5", ["0.82", "-0.90"]);
    const sbo = handicapCatalog("SBOBET", "two", "-0.5", ["0.78", "-0.86"]);
    const missing: LiveCatalogResponse = { ...saba, events: [{ ...saba.events[0]!, isLive: true,
      liveState: { period: "2H", scoreHome: null, scoreAway: null, clockMs: 2_800_000 } } as ProviderEvent] };
    const known: LiveCatalogResponse = { ...sbo, events: [{ ...sbo.events[0]!, isLive: true,
      liveState: { period: "2H", scoreHome: 1, scoreAway: 0, clockMs: 2_900_000 } } as ProviderEvent] };
    expect(buildComparisonEvents([missing, known])).toHaveLength(1);
    const contradictoryScore = { ...missing, events: [{ ...missing.events[0]!,
      liveState: { period: "2H", scoreHome: 0, scoreAway: 2, clockMs: 2_800_000 } } as ProviderEvent] };
    const contradictoryPeriod = { ...known, events: [{ ...known.events[0]!,
      liveState: { period: "1H", scoreHome: 1, scoreAway: 0, clockMs: 2_900_000 } } as ProviderEvent] };
    expect(buildComparisonEvents([contradictoryScore, known])).toHaveLength(2);
    expect(buildComparisonEvents([missing, contradictoryPeriod])).toHaveLength(2);
  });

  it("does not match live events from participant names alone when independent identity evidence is missing", () => {
    const saba = handicapCatalog("SABA", "one", "-0.5", ["0.82", "-0.90"]);
    const sbo = handicapCatalog("SBOBET", "two", "-0.5", ["0.78", "-0.86"]);
    const left: LiveCatalogResponse = { ...saba, events: [{ ...saba.events[0]!, isLive: true,
      competition: "Competition Alpha", startAtUtcMs: 10_000,
      liveState: { period: null, scoreHome: null, scoreAway: null, clockMs: null } } as ProviderEvent] };
    const right: LiveCatalogResponse = { ...sbo, events: [{ ...sbo.events[0]!, isLive: true,
      competition: "Competition Beta", startAtUtcMs: 610_000,
      liveState: { period: null, scoreHome: null, scoreAway: null, clockMs: null } } as ProviderEvent] };

    const result = buildComparisonEvents([left, right]);

    expect(result).toHaveLength(2);
    expect(result.flatMap((item) => item.rows)).toEqual([]);
  });

  it("calculates and ranks a positive cross-book margin from the best complete outcomes", () => {
    const result = buildComparisonEvents([decimalHandicapCatalog("SABA", "s", "-0.5", ["2.50", "3.00"]),
      decimalHandicapCatalog("SBOBET", "b", "-0.5", ["2.10", "4.00"])]);
    expect(result[0]?.rows[0]?.crossBook).toBe(true);
    expect(result[0]?.rows[0]?.margin).toBeCloseTo(0.538461, 5);
    expect(result[0]?.bestMargin).toBeCloseTo(0.538461, 5);
  });

  it("includes exact first-half half-goal handicap and total rows", () => {
    const firstHalf = (provider: "SABA" | "SBOBET", eventId: string): LiveCatalogResponse => {
      const base = catalog(provider, eventId, ["2.10", "1.80"]);
      return { ...base, markets: [
        { ...base.markets[0]!, providerMarketId: `${eventId}-fh-ah`, marketType: "FH_AH",
          scope: "FIRST_HALF", line: "-0.5", settlementProfile: "football-first-half-including-added-time" },
        { ...base.markets[0]!, providerMarketId: `${eventId}-fh-total`, marketType: "FH_TOTAL",
          scope: "FIRST_HALF", line: "1.5", settlementProfile: "football-first-half-including-added-time" }
      ], quotes: [
        ...["HOME", "AWAY"].map((selection, index) => ({ ...base.quotes[index]!,
          providerMarketId: `${eventId}-fh-ah`, providerSelectionId: `${eventId}-fh-ah-${selection}`,
          marketType: "FH_AH" as const, scope: "FIRST_HALF" as const,
          selection: selection as "HOME" | "AWAY", line: "-0.5" })),
        ...["OVER", "UNDER"].map((selection, index) => ({ ...base.quotes[index]!,
          providerMarketId: `${eventId}-fh-total`, providerSelectionId: `${eventId}-fh-total-${selection}`,
          marketType: "FH_TOTAL" as const, scope: "FIRST_HALF" as const,
          selection: selection as "OVER" | "UNDER", line: "1.5" }))
      ] };
    };
    const [result] = buildComparisonEvents([firstHalf("SABA", "saba"), firstHalf("SBOBET", "sbo")]);
    expect(result?.rows.map(({ marketType, scope }) => [marketType, scope])).toEqual([
      ["FH_AH", "FIRST_HALF"], ["FH_TOTAL", "FIRST_HALF"]
    ]);
  });

  it("includes exact second-half, corner and card rows but never crosses statistic identities", () => {
    const expanded = (provider: "SABA" | "SBOBET", eventId: string): LiveCatalogResponse => {
      const base = catalog(provider, eventId, ["2.10", "1.80"]);
      const definitions = [
        ["SH_AH", "SECOND_HALF", "football-second-half-including-added-time", "HOME", "AWAY"],
        ["CORNER_FT_TOTAL", "FULL_TIME", "football-corners-regulation", "OVER", "UNDER"],
        ["CARD_FH_AH", "FIRST_HALF", "football-cards-first-half", "HOME", "AWAY"]
      ] as const;
      return { ...base,
        markets: definitions.map(([marketType, scope, settlementProfile]) => ({ ...base.markets[0]!,
          providerMarketId: `${eventId}-${marketType}`, marketType, scope, line: "0.5", settlementProfile })),
        quotes: definitions.flatMap(([marketType, scope, , first, second]) => [first, second].map((selection, index) => ({
          ...base.quotes[index]!, providerMarketId: `${eventId}-${marketType}`,
          providerSelectionId: `${eventId}-${marketType}-${selection}`, marketType, scope, selection, line: "0.5"
        })))
      };
    };
    const [result] = buildComparisonEvents([expanded("SABA", "saba"), expanded("SBOBET", "sbo")]);
    expect(result?.rows.map(({ marketType, scope }) => [marketType, scope])).toEqual([
      ["CARD_FH_AH", "FIRST_HALF"], ["CORNER_FT_TOTAL", "FULL_TIME"], ["SH_AH", "SECOND_HALF"]
    ]);
    expect(new Set(result?.rows.map((row) => row.key)).size).toBe(3);
  });

  it("includes exact LoL map winner rows with the same map index", () => {
    const mapCatalog = (provider: "SABA" | "IM", eventId: string, scope: "MAP_1" | "MAP_2"): LiveCatalogResponse => {
      const base = lolCatalog(provider, eventId, "T1", "Gen.G", ["2.10", "1.80"]);
      return { ...base,
        markets: [{ ...base.markets[0]!, marketType: "MAP_WINNER", scope,
          settlementProfile: "lol-map-winner" }],
        quotes: base.quotes.map((quote) => ({ ...quote, marketType: "MAP_WINNER", scope })) };
    };
    expect(buildComparisonEvents([mapCatalog("SABA", "saba", "MAP_2"),
      mapCatalog("IM", "im", "MAP_2")])[0]?.rows.map((row) => [row.marketType, row.scope]))
      .toEqual([["MAP_WINNER", "MAP_2"]]);
    expect(buildComparisonEvents([mapCatalog("SABA", "saba", "MAP_1"),
      mapCatalog("IM", "im", "MAP_2")])[0]?.rows).toEqual([]);
  });
});

describe("competition identity learned from shared fixtures", () => {
  const liveEvent = (provider: "SABA" | "SBOBET", id: string, competition: string,
    participantA: string, participantB: string): ProviderEvent => ({
    provider, category: "FOOTBALL", providerEventId: id, competition,
    seasonStage: null, startAtUtcMs: 2_000_000, participantA, participantB,
    eventScope: "REGULATION", bestOf: null, isLive: true, rematchCandidate: false,
    fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL",
    liveState: { period: null, scoreHome: null, scoreAway: null, clockMs: null }
  });

  const liveCatalog = (provider: "SABA" | "SBOBET", competition: string,
    fixtures: readonly (readonly [string, string])[]): LiveCatalogResponse => {
    const events = fixtures.map(([a, b], index) =>
      liveEvent(provider, `${provider}-${index}`, competition, a, b));
    const markets: ProviderMarket[] = events.map((entry) => ({ provider, category: "FOOTBALL",
      providerEventId: entry.providerEventId, providerMarketId: `${entry.providerEventId}-total`,
      marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5",
      settlementProfile: "football-regulation-including-added-time", status: "OPEN" }));
    const quotes: ProviderQuote[] = markets.flatMap((market) =>
      (["OVER", "UNDER"] as const).map((selection) => ({ provider, category: "FOOTBALL" as const,
        providerEventId: market.providerEventId, providerMarketId: market.providerMarketId,
        providerSelectionId: `${market.providerMarketId}-${selection}`, marketType: "FT_TOTAL",
        scope: "FULL_TIME", selection, line: "2.5", rawOdds: "1.95", rawFormat: "DECIMAL" as const,
        status: "OPEN" as const, isLive: true, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1 })));
    return { dataMode: "LIVE", accountId: `catalog-source:${provider}:FOOTBALL`, provider,
      category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1,
      rejectedMarketCount: 0, events, markets, quotes };
  };

  it("pairs live fixtures whose books name the same competition differently", () => {
    // Books name competitions by their own convention and language, so equal
    // text is not available as evidence. Two competitions that agree on more
    // than one exact fixture are the same competition.
    const left = liveCatalog("SABA", "Japan Emperor Cup",
      [["Kashima Antlers", "Urawa Reds"], ["Gamba Osaka", "Vissel Kobe"]]);
    const right = liveCatalog("SBOBET", "Cup Thien Hoang Nhat Ban",
      [["Kashima Antlers", "Urawa Reds"], ["Gamba Osaka", "Vissel Kobe"]]);

    const paired = buildComparisonEvents([left, right]).filter((entry) => entry.providers.length > 1);

    expect(paired).toHaveLength(2);
    expect([...paired[0]!.providers].sort()).toEqual(["SABA", "SBOBET"]);
  });

  it("counts a fixture two books spell differently as evidence of one competition", () => {
    // Learning used to demand participants matching to the character while
    // pairing accepted far less, so a league whose fixtures every book spells
    // its own way could never link and none of them paired. Neither fixture
    // here is spelled the same twice; both are ones pairing would accept.
    const left = liveCatalog("SABA", "France Ligue 2",
      [["Nancy", "Dunkerque"], ["Clermont", "Sochaux"]]);
    const right = liveCatalog("SBOBET", "Giai hang Nhi Phap",
      [["AS Nancy Lorraine", "USL Dunkerque"], ["Clermont Foot", "Sochaux Montbeliard"]]);

    const paired = buildComparisonEvents([left, right]).filter((entry) => entry.providers.length > 1);

    expect(paired).toHaveLength(2);
    expect([...paired[0]!.providers].sort()).toEqual(["SABA", "SBOBET"]);
  });

  it("reads a Vietnamese competition alias written with a plain d", () => {
    // NFKD leaves the d-with-stroke alone, so every alias for a Vietnamese
    // competition had to carry a character the alias list is not written with,
    // and the two that did not could never match anything they were added for.
    const left = liveCatalog("SABA", "GERMANY-BUNDESLIGA I", [["Bayern Munchen", "VfB Stuttgart"]]);
    const right = liveCatalog("SBOBET", "Giải Vô địch Quốc gia Đức", [["Bayern Munchen", "VfB Stuttgart"]]);

    const paired = buildComparisonEvents([left, right]).filter((entry) => entry.providers.length > 1);

    expect(paired).toHaveLength(1);
  });

  const scheduledCatalog = (provider: "SABA" | "SBOBET", competition: string,
    fixtures: readonly (readonly [string, string, number])[]): LiveCatalogResponse => {
    const base = liveCatalog(provider, competition, fixtures.map(([a, b]) => [a, b] as const));
    return { ...base,
      events: base.events.map((event, index) => ({ ...event, isLive: false,
        startAtUtcMs: fixtures[index]![2], liveState: null })),
      quotes: base.quotes.map((quote) => ({ ...quote, isLive: false })) };
  };

  it("links two competitions on fixtures a 24-hour window shows one at a time", () => {
    // A league's second fixture is usually not on the board beside its first,
    // so demanding both at once left 104 of 124 competition pairs unlinked with
    // the fixture both books were pricing sitting between them.
    const memory = createCompetitionLinkMemory();
    const friday = (competition: string, provider: "SABA" | "SBOBET") =>
      scheduledCatalog(provider, competition, [["Kashima Antlers", "Urawa Reds", 2_000_000]]);
    const saturday = (competition: string, provider: "SABA" | "SBOBET") =>
      scheduledCatalog(provider, competition, [["Gamba Osaka", "Vissel Kobe", 90_000_000]]);

    const first = buildComparisonEvents([friday("Japan Emperor Cup", "SABA"),
      friday("Cup Thien Hoang Nhat Ban", "SBOBET")], memory);
    const second = buildComparisonEvents([saturday("Japan Emperor Cup", "SABA"),
      saturday("Cup Thien Hoang Nhat Ban", "SBOBET")], memory);

    expect(first.filter((entry) => entry.providers.length > 1)).toHaveLength(0);
    expect(second.filter((entry) => entry.providers.length > 1)).toHaveLength(1);
    // The control: the same second board on its own is one fixture again, and
    // one fixture has never been enough.
    expect(buildComparisonEvents([saturday("Japan Emperor Cup", "SABA"),
      saturday("Cup Thien Hoang Nhat Ban", "SBOBET")])
      .filter((entry) => entry.providers.length > 1)).toHaveLength(0);
  });

  it("counts the one fixture two competitions share once, however often it is seen", () => {
    // The rule that keeps a league out of a cup is two distinct fixtures, and
    // the same fixture arriving in every snapshot is still one of them.
    const memory = createCompetitionLinkMemory();
    const board = () => [scheduledCatalog("SABA", "Japan Emperor Cup",
      [["Kashima Antlers", "Urawa Reds", 2_000_000]]),
    scheduledCatalog("SBOBET", "Some Other Cup", [["Kashima Antlers", "Urawa Reds", 2_000_000]])];

    let paired = 0;
    for (let snapshot = 0; snapshot < 50; snapshot += 1) {
      paired = buildComparisonEvents(board(), memory).filter((entry) => entry.providers.length > 1).length;
    }

    expect(paired).toBe(0);
  });

  it("refuses to link two competitions that share only one fixture", () => {
    const left = liveCatalog("SABA", "Japan Emperor Cup",
      [["Kashima Antlers", "Urawa Reds"], ["Gamba Osaka", "Vissel Kobe"]]);
    const right = liveCatalog("SBOBET", "Some Other Cup",
      [["Kashima Antlers", "Urawa Reds"], ["Sydney FC", "Perth Glory"]]);

    const paired = buildComparisonEvents([left, right]).filter((entry) => entry.providers.length > 1);

    expect(paired).toHaveLength(0);
  });
});
