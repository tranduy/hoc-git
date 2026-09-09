import { describe, expect, it } from "vitest";
import type { MarketType, ProviderEvent, ProviderId, ProviderMarket,
  ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";

const KICKOFF_MS = 2_000_000;

function catalogOf(provider: ProviderId, competition: string, marketType: MarketType,
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
      settlementProfile: marketType === "CORNER_FT_TOTAL" ? "football-corners-regulation"
        : marketType === "CARD_FT_TOTAL" ? "football-cards-regulation"
        : "football-regulation-including-added-time", status: "OPEN" });
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
  it.each(["NO_MARKETS", "NO_QUOTES", "QUOTES_ONLY", "PRICED"] as const)(
    "handles the observed Puebla duplicate fixture when its inventory is %s", (inventory) => {
      const source = (provider: ProviderId, id: string): LiveCatalogResponse => {
        const base = catalogOf(provider, "Mexico Liga MX", "FT_TOTAL", [["Puebla", "Deportivo Toluca"]]);
        return { ...base, events: base.events.map((event) => ({ ...event, providerEventId: id })),
          markets: base.markets.map((market) => ({ ...market, providerEventId: id, providerMarketId: `${id}-m` })),
          quotes: base.quotes.map((quote) => ({ ...quote, providerEventId: id, providerMarketId: `${id}-m`,
            providerSelectionId: `${id}-${quote.selection}` })) };
      };
      const priced = source("APSPORT", "5705441"), duplicate = source("APSPORT", "5324882");
      const apsport = { ...priced, events: [...duplicate.events, ...priced.events],
        markets: [...(inventory === "NO_MARKETS" || inventory === "QUOTES_ONLY" ? [] : duplicate.markets), ...priced.markets],
        quotes: [...(inventory === "PRICED" || inventory === "QUOTES_ONLY" ? duplicate.quotes : []), ...priced.quotes] };
      const before = structuredClone(apsport);
      const paired = buildComparisonEvents([apsport, source("SBOBET", "5705441")])
        .filter((group) => group.providers.length > 1);

      expect(apsport).toEqual(before);
      if (inventory !== "NO_MARKETS") {
        expect(paired).toEqual([]);
      } else {
        expect(paired).toHaveLength(1);
        expect(paired[0]?.providerEventIds).toEqual({ APSPORT: "5705441", SBOBET: "5705441" });
        expect(paired[0]?.rows).toHaveLength(1);
      }
    });

  it("links the observed CMD China Football Super League label", () => {
    const groups = buildComparisonEvents([
      catalogOf("CMD", "CHINA FOOTBALL SUPER LEAGUE", "FT_TOTAL", [["Wuhan Three Towns", "Henan FC"]]),
      catalogOf("BTI", "China CSL", "FT_TOTAL", [["Wuhan Three Towns", "Henan Songshan Longmen"]])
    ]);
    expect(groups.flatMap((group) => group.rows)).toHaveLength(1);
  });

  it.each(["China League One", "CHINA FOOTBALL SUPER LEAGUE U21", "CHINA FOOTBALL SUPER LEAGUE WOMEN"])(
    "keeps the new China league alias separate from %s", (competition) => {
      const groups = buildComparisonEvents([
        catalogOf("CMD", "CHINA FOOTBALL SUPER LEAGUE", "FT_TOTAL", [["Wuhan Three Towns", "Henan FC"]]),
        catalogOf("BTI", competition, "FT_TOTAL", [["Wuhan Three Towns", "Henan FC"]])
      ]);
      expect(groups.flatMap((group) => group.rows)).toEqual([]);
    });

  it("retains China youth participant qualifiers under the same league alias", () => {
    const groups = buildComparisonEvents([
      catalogOf("CMD", "CHINA FOOTBALL SUPER LEAGUE", "FT_TOTAL", [["Wuhan Three Towns", "Henan FC"]]),
      catalogOf("BTI", "China CSL", "FT_TOTAL", [["Wuhan Three Towns U21", "Henan FC U21"]])
    ]);
    expect(groups.flatMap((group) => group.rows)).toEqual([]);
  });

  it.each([
    ["SWISS SUPER LEAGUE", ["Lausanne", "Servette Geneve"],
      ["Lausanne-Sport", "Servette"], ["Lausanne Sports", "Servette"]],
    ["FRANCE LIGUE 2", ["Rodez", "Grenoble"],
      ["Rodez AF", "Grenoble Foot 38"], ["Rodez Aveyron", "Grenoble"]]
  ] as const)("joins all four providers when specific team aliases would split %s", (competition, bti, cmd, sbo) => {
    const groups = buildComparisonEvents([
      catalogOf("BTI", competition, "FT_TOTAL", [bti]),
      catalogOf("CMD", competition, "FT_TOTAL", [cmd]),
      catalogOf("APSPORT", competition, "FT_TOTAL", [sbo]),
      catalogOf("SBOBET", competition, "FT_TOTAL", [sbo])
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows).toHaveLength(1);
    expect(groups[0]?.rows[0]?.cells.map((cell) => cell.provider).sort())
      .toEqual(["APSPORT", "BTI", "CMD", "SBOBET"]);
  });

  it.each(["Women", "Reserves"])("keeps %s qualifiers separate when matching the new team aliases", (qualifier) => {
    for (const [left, right] of [["Lausanne Sports", "Lausanne-Sport"], ["Rodez AF", "Rodez Aveyron"]]) {
      const groups = buildComparisonEvents([
        catalogOf("BTI", "League", "FT_TOTAL", [[left!, "Opponent"]]),
        catalogOf("CMD", "League", "FT_TOTAL", [[`${right} ${qualifier}`, "Opponent"]])
      ]);
      expect(groups.flatMap((group) => group.rows)).toEqual([]);
    }
  });

  it.each([
    ["Giải bóng đá hạng 2 Colombia, Primera B", "COLOMBIA PRIMERA B",
      ["Internacional FC de Palmira", "Atletico Cali FC"], ["Internacional de Palmira", "Atletico FC"]],
    ["Giải Mỹ - MLS Next Pro", "USA MLS NEXT PRO",
      ["New York City II", "New York Red Bulls II"], ["New York City FC II", "New York Red Bulls II"]],
    ["Giải UAE - Pro League", "UAE PRO LEAGUE",
      ["Ajman", "Al-Ittihad Kalba"], ["Ajman", "Al Ittihad Kalba"]],
    ["Giải Ngoại hạng Phần Lan", "Finland Veikkausliiga",
      ["HJK Helsinki", "Inter Turku"], ["HJK Helsinki", "Inter Turku"]],
    ["Giải Paraguay - Segunda Division", "PARAGUAY DIVISION INTERMEDIA",
      ["General Caballero", "Resistencia SC"], ["General Caballero JLM", "Resistencia SC"]],
    ["Giải Vô địch Quốc gia Paraguay Hạng Trung", "PARAGUAY DIVISION INTERMEDIA",
      ["General Caballero JLM", "Resistencia"], ["General Caballero JLM", "Resistencia SC"]],
    ["Giải bóng đá hạng nhì Nhật Bản, J2 League", "Japan J2 League",
      ["Ventforet Kofu", "Jubilo Iwata"], ["Ventforet Kofu", "Jubilo Iwata"]],
    ["Giải hạng Nhì Nhật Bản (J2 League)", "JAPAN J-LEAGUE DIVISION 2",
      ["Ventforet Kofu", "Jubilo Iwata"], ["Ventforet Kofu", "Jubilo Iwata"]],
    ["Giải bóng đá Ngoại hạng Trung Quốc", "China CSL",
      ["Wuhan Three Towns", "Henan Songshan Longmen"], ["Wuhan Three Towns", "Henan Songshan Longmen"]],
    ["Giải Vô địch Quốc gia Trung Quốc", "China CSL",
      ["Wuhan Three Towns", "Henan Songshan Longmen"], ["Wuhan Three Towns", "Henan Songshan Longmen"]],
    ["Giải Anh - League Two", "England League Two",
      ["Crawley Town", "Cheltenham Town"], ["Crawley Town", "Cheltenham"]],
    ["Giải hạng 1 - El Salvador", "EL SALVADOR PRIMERA DIVISION",
      ["CD INCA", "Atletico Balboa"], ["CD Inca", "Atletico Balboa"]],
    ["Giải Primera Division El Salvador", "EL SALVADOR PRIMERA DIVISION",
      ["CD INCA", "Atletico Balboa"], ["CD Inca", "Atletico Balboa"]],
    ["Giải Copa Libertadores", "CONMEBOL Libertadores",
      ["Fluminense", "Platense"], ["Fluminense RJ", "CA Platense"]],
    ["Giải Copa Libertadores", "COPA LIBERTADORES",
      ["Fluminense", "Platense"], ["Fluminense RJ", "CA Platense"]],
    ["Giải Copa Sudamericana", "COPA SUDAMERICANA",
      ["Independiente Santa Fe", "Vasco da Gama"], ["Independiente Santa Fe", "Vasco da Gama RJ"]],
    ["Giải MLS Next Pro Hoa Kỳ", "USA MLS NEXT PRO",
      ["New York City II", "New York Red Bulls II"], ["New York City FC II", "New York Red Bulls II"]],
    ["Giải vô địch Paulista U20 của BRAZIL", "BRAZIL CAMPEONATO PAULISTA U20",
      ["EC Agua Santa SP U20", "Palmeiras SP U20"], ["EC Agua Santa SP U20", "Palmeiras SP U20"]],
    ["Giải Paulista U20, Brazil", "BRAZIL CAMPEONATO PAULISTA U20",
      ["U20 Agua Santa", "U20 Palmeiras"], ["EC Agua Santa SP U20", "Palmeiras SP U20"]],
    ["Cúp Quốc gia Úc", "AUSTRALIA CUP",
      ["Sydney FC", "Melbourne Victory"], ["Sydney FC", "Melbourne Victory"]],
    ["Giải Vô địch Quốc gia Colombia", "COLOMBIA PRIMERA A",
      ["Millonarios", "Deportivo Cali"], ["Millonarios", "Deportivo Cali"]],
    ["Giải Colombia - Primera A", "COLOMBIA PRIMERA A",
      ["Millonarios Bogota", "Deportivo Cali"], ["Millonarios", "Deportivo Cali"]],
    ["GIẢI U19 ICELAND A", "ICELAND U19 LEAGUE A",
      ["Stjarnan/KFG U19", "FH/IH U19"], ["Stjarnan/KFG U19", "FH/IH U19"]],
    ["Giải Challenger Pro League - Bỉ", "BELGIUM CHALLENGER PRO LEAGUE",
      ["Patro Eisden Maasmechelen", "Eupen"], ["Patro Eisden Maasmechelen", "KAS Eupen"]],
    ["Giải Reserve League El Salvador", "El Salvador Reserve League",
      ["CD Inca U20", "CD Atletico Balboa U20"], ["CD Inca U20", "CD Atletico Balboa U20"]],
    ["Giải Vô địch Quốc gia Mexico (Liga MX)", "Mexico Liga MX",
      ["Santos Laguna", "FC Juarez"], ["Santos Laguna", "FC Juarez"]],
    ["Giải Liga MX, Mexico", "Mexico Liga MX",
      ["Santos Laguna", "FC Juarez"], ["Santos Laguna", "FC Juarez"]],
    ["Indonesia - Super League", "Indonesia Liga 1",
      ["Persebaya Surabaya", "PSIM Yogyakarta"], ["Persebaya Surabaya", "PSIM Yogyakarta"]],
    ["Giải Liga 1 Indonesia", "INDONESIA SUPER LEAGUE",
      ["Persebaya Surabaya", "PSIM Yogyakarta"], ["Persebaya Surabaya", "PSIM Yogyakarta"]]
  ] as const)("matches the specific live-catalog competition alias %s", (localized, english, btiTeams, cmdTeams) => {
    const groups = buildComparisonEvents([
      catalogOf("BTI", localized, "FT_TOTAL", [btiTeams]),
      catalogOf("CMD", english, "FT_TOTAL", [cmdTeams])
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows).toHaveLength(1);
    expect(groups[0]?.rows[0]?.cells.map((cell) => cell.provider).sort()).toEqual(["BTI", "CMD"]);
  });

  it.each([
    ["Finland Veikkausliiga", "FINLAND VEIKKAUSLIIGA (PLAYOFF)"],
    ["Japan J2 League", "Japan J3 League"],
    ["COPA LIBERTADORES", "Giải vô địch bóng đá các câu lạc bộ Nam Mỹ"],
    ["COPA SUDAMERICANA", "Giải vô địch bóng đá các câu lạc bộ Nam Mỹ"],
    ["Mexico Liga MX", "Giải Vô địch Quốc gia Mexico (Liga MX) Women"],
    ["Mexico Liga MX", "Mexico Liga Expansion MX"],
    ["Mexico Liga MX", "Giải U21 Mexico"],
    ["ICELAND U19 LEAGUE A", "ICELAND U19 LEAGUE B"],
    ["BRAZIL CAMPEONATO PAULISTA U20", "Brazil U20 Leagues"],
    ["BRAZIL CAMPEONATO PAULISTA U20", "Các giải đấu U20 Brazil"],
    ["El Salvador Reserve League", "EL SALVADOR PRIMERA DIVISION"]
  ])("does not infer a competition alias for %s and %s", (left, right) => {
    const groups = buildComparisonEvents([
      catalogOf("BTI", left, "FT_TOTAL", [["Fluminense", "Platense"]]),
      catalogOf("CMD", right, "FT_TOTAL", [["Fluminense", "Platense"]])
    ]);
    expect(groups.flatMap((group) => group.rows)).toEqual([]);
  });

  it.each(["BTI", "CMD", "APSPORT", "SBOBET", "SABA", "IM"] as const)(
    "matches %s corner and card markets using the known competition alias after its product suffix", (provider) => {
      const rival = provider === "BTI" ? "SABA" : "BTI";
      for (const [marketType, suffix] of [
        ["CORNER_FT_TOTAL", "Corners"], ["CARD_FT_TOTAL", "Cards"]
      ] as const) {
        const groups = buildComparisonEvents([
          catalogOf(provider, `Spain Primera Laliga - ${suffix}`, marketType, [FIXTURES[0]]),
          catalogOf(rival, "Giai LaLiga Tay Ban Nha", marketType, [FIXTURES[0]])
        ]);

        expect(groups).toHaveLength(1);
        expect(groups[0]?.rows).toHaveLength(1);
        expect(groups[0]?.rows[0]?.marketType).toBe(marketType);
        expect(groups[0]?.rows[0]?.cells.map((cell) => cell.provider).sort()).toEqual([provider, rival].sort());
      }
    });

  it("keeps suffix aliases confined to their statistic and preserves unknown competition stages", () => {
    for (const [competition, marketType] of [
      ["Spain Primera Laliga - Corners", "FT_TOTAL"],
      ["Spain Primera Laliga - Cards", "CORNER_FT_TOTAL"],
      ["Spain Primera Laliga - Playoffs - Corners", "CORNER_FT_TOTAL"]
    ] as const) {
      const groups = buildComparisonEvents([
        catalogOf("SABA", competition, marketType, [FIXTURES[0]]),
        catalogOf("BTI", "Giai LaLiga Tay Ban Nha", marketType, [FIXTURES[0]])
      ]);

      expect(groups.flatMap((group) => group.rows)).toEqual([]);
    }
  });

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
