import { describe, expect, it } from "vitest";
import type { ProviderId } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";

const kickoff = 2_000_000;

function catalog(provider: ProviderId, home: string, away = "Unchanged Opponent",
  competition = "Shared Competition", startAtUtcMs = kickoff, line = "2.5"): LiveCatalogResponse {
  const providerEventId = `${provider}-match`, providerMarketId = `${provider}-market`;
  return { dataMode: "LIVE", accountId: `catalog-source:${provider}:FOOTBALL`, provider,
    category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1,
    rejectedMarketCount: 0,
    events: [{ provider, category: "FOOTBALL", providerEventId, competition, seasonStage: null,
      startAtUtcMs, participantA: home, participantB: away, eventScope: "REGULATION",
      bestOf: null, isLive: false, rematchCandidate: false, fixtureDiscriminator: null,
      isVirtual: false, sportVariant: "FOOTBALL", liveState: null }],
    markets: [{ provider, category: "FOOTBALL", providerEventId, providerMarketId,
      marketType: "FT_TOTAL", scope: "FULL_TIME", line,
      settlementProfile: "football-regulation-including-added-time", status: "OPEN" }],
    quotes: (["OVER", "UNDER"] as const).map((selection) => ({ provider, category: "FOOTBALL",
      providerEventId, providerMarketId, providerSelectionId: `${provider}-${selection}`,
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection, line, rawOdds: "1.95",
      rawFormat: "DECIMAL", status: "OPEN", isLive: false, sourceTimestampMs: null,
      receivedMonotonicMs: 1, sequence: 1 })) };
}

describe("observed six-provider name variants", () => {
  it.each(["ET", "PEN", "Hiệp Phụ", "Hiep Phu", "Luân Lưu", "Luan Luu"])("does not price an explicit %s fixture as regulation when upstream scope is wrong", marker => {
    const regulation = catalog("SABA", "AC Nagano Parceiro", "Mito Hollyhock");
    const labelled = catalog("CMD", `AC Nagano Parceiro (${marker})`, `Mito Hollyhock (${marker})`);
    // CMD native ET 25426567 / PEN 25426670 had REGULATION upstream.
    // Fuzzy containment must not treat the settlement marker as a club suffix.
    expect(buildComparisonEvents([regulation, labelled]).flatMap(event => event.rows)).toEqual([]);
    // Both providers can carry the same bad scope: equal labels are not proof
    // that their regulation market settlement profile is valid for extra time.
    const secondLabelled = catalog("SABA", `AC Nagano Parceiro (${marker})`, `Mito Hollyhock (${marker})`);
    expect(buildComparisonEvents([secondLabelled, labelled]).flatMap(event => event.rows)).toEqual([]);
  });

  it("preserves ordinary club-name matching without interpreting embedded letters as period markers", () => {
    expect(buildComparisonEvents([catalog("SABA", "Etar Veliko Tarnovo", "Pen-y-Bont"),
      catalog("CMD", "FC Etar Veliko Tarnovo", "Pen-y-Bont FC")]).flatMap(event => event.rows)).toHaveLength(1);
  });

  it("retains both valid settlement clusters for the same market and never crosses them", () => {
    const profiled = (provider: ProviderId, settlementProfile: string): LiveCatalogResponse => {
      const source = catalog(provider, "Team A", "Team B");
      return { ...source, markets: source.markets.map(market => ({ ...market, settlementProfile })) };
    };
    const grouped = buildComparisonEvents([
      profiled("BTI", "football-regulation-including-added-time"),
      profiled("CMD", "football-regulation-including-added-time"),
      profiled("SBOBET", "provider-specific-same-settlement"),
      profiled("IM", "provider-specific-same-settlement")
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.rows).toHaveLength(2);
    expect(new Set(grouped[0]?.rows.map(row => row.key)).size).toBe(2);
    expect(grouped[0]?.rows.map(row => row.cells.map(cell => cell.provider).sort()).sort())
      .toEqual([["BTI", "CMD"], ["IM", "SBOBET"]]);
    expect(grouped[0]?.observedRows).toHaveLength(2);
    for (const row of grouped[0]!.rows) expect(new Set(row.cells.map(cell => cell.market.settlementProfile)).size).toBe(1);
  });

  it.each([
    ["Cúp Hy Lạp", "Cúp Quốc gia Hy Lạp"],
    ["Giải Scotland - League Cup", "SCOTTISH LEAGUE CUP"],
    ["Giải ngoại hạng Nam Phi", "South Africa Premiership"],
    ["Siêu cúp Bulgaria", "BULGARIA SUPER CUP"],
    ["Cúp Argentina", "ARGENTINA CUP"],
    ["Giải Bóng đá chuyên nghiệp hạng Ba Nhật Bản, J3 League", "JAPAN J-LEAGUE DIVISION 3"],
    ["Giải hạng Ba Nhật Bản (J3 League)", "Japan J-League Division 3"],
    ["Giải Vô địch Quốc gia Ả Rập Xê Út", "SAUDI PRO LEAGUE"],
    ["Giải Vô địch Quốc gia Lithuania", "LITHUANIA A LYGA"],
    ["Giải Vô địch Quốc gia Nữ Colombia", "Giải nữ Liga, Colombia"],
    ["Cúp Liên đoàn Tây Ban Nha", "Giải Copa Federacion - Tây Ban Nha"],
    ["Giải Anh - League One", "GIẢI HẠNG 3 ANH"],
    ["Giải ngoại hạng - Armenia", "ARMENIA PREMIER LEAGUE"],
    ["Cúp Quốc gia Ukraine", "Ukraine Cup"],
    ["Giải bóng đá MEXICO LIGA DE EXPANSION", "Mexico Liga Expansion MX"],
    ["England FA Cup Qualifying", "VÒNG LOẠI CÚP FA ANH"],
    ["GIẢI VÔ ĐỊCH QUỐC GIA HY LẠP", "Greece Super League 1"],
    ["Czech Republic 1 Liga U19", "Giải U19 Hạng Nhất Cộng hòa Séc"],
    ["Giải U19 Serbia", "Serbia U19 League"],
    ["URUGUAY CUP QUALIFIERS", "VÒNG LOẠI CÚP QUỐC GIA URUGUAY"]
  ])("links exact observed competition translation %s / %s", (left, right) => {
    expect(buildComparisonEvents([catalog("BTI", "Team A", "Team B", left),
      catalog("CMD", "Team A", "Team B", right)]).flatMap(group => group.rows)).toHaveLength(1);
  });

  it.each([
    ["Cúp Argentina", "CÚP QUỐC GIA ARGENTINA - ĐỘI NÀO SẼ TIẾN VÀO VÒNG TIẾP THEO"],
    ["Siêu cúp Bulgaria", "SIÊU CÚP BULGARIA - VÔ ĐỊCH"],
    ["Giải hạng Ba Nhật Bản (J3 League)", "Japan J2 League"],
    ["Giải ngoại hạng Nam Phi", "South Africa Premiership Women"],
    ["Czech Republic 1 Liga U19", "Czech Republic 1 Liga"],
    ["Giải hạng Nhất Iceland", "GIẢI HẠNG NHẤT ICELAND (PLAY OFF)"],
    ["Giải Úc - Ngoại hạng Nam Úc", "Australia Victoria Premier League"]
  ])("keeps distinct products and divisions separate: %s / %s", (left, right) => {
    expect(buildComparisonEvents([catalog("BTI", "Team A", "Team B", left),
      catalog("CMD", "Team A", "Team B", right)]).flatMap(group => group.rows)).toHaveLength(0);
  });

  it.each([
    ["Paris Saint Germain", "Paris St Germain"],
    ["Bayern Munchen", "Bayern Munich"],
    ["Olympiacos", "Olympiakos"],
    ["Helsingborgs IF", "Helsingborg"],
    ["Busan IPark", "Busan I Park"],
    ["Sheffield Wednesday", "Sheffield Wed"],
    ["West Bromwich Albion", "West Brom"],
    ["Austria Wien", "Austria Vienna"],
    ["Rapid Wien", "Rapid Vienna"],
    ["SK Rapid Wien II", "Rapid Vienna II"],
    ["Legia Warszawa", "Legia Warsaw"],
    ["Kairat Almaty", "Kayrat Almaty"],
    ["Grasshopper", "Grasshoppers"],
    ["Djurgardens IF", "Djurgarden"],
    ["AC Sparta Praha", "Sparta Prague"],
    ["SK Slavia Praha", "Slavia Prague"],
    ["St Gallen", "Sankt Gallen"],
    ["El Gouna", "El Gounah"],
    ["Dinamo Moscow", "Dynamo Moscow"],
    ["Baniyas", "Bani Yas"],
    ["Estudiantes LP", "Estudiantes La Plata"],
    ["Gimnasia LP", "Gimnasia La Plata"],
    ["Deportivo La Coruna", "Dep La Coruna"],
    ["St Patricks Athletic", "Saint Patricks"],
    ["Japan W U20", "Japan U20 W"],
    ["USA W U20", "USA U20 W"],
    ["St Mirren", "Saint Mirren"],
    ["Al Ahly Egypt", "Al Ahly Cairo"],
    ["Operario PR", "Operario Ferroviario EC"],
    ["Rennes", "Stade Rennais"],
    ["Ferencvarosi TC", "Ferencvaros"],
    ["Young Violets Austria Wien", "Young Violets Austria Vienna"],
    ["Sociedade Esportiva Palmeiras", "Palmeiras SP"],
    ["RC Lens", "Lens"],
    ["Olympique Lyonnais", "Lyon"],
    ["Stade Brestois", "Brest"],
    ["Koln", "Cologne"],
    ["Hamburger SV", "Hamburg"],
    ["Nhat Ban U23", "Japan U23"],
    ["Nhat Ban Nu", "Japan W"],
    ["Thai Lan Nu", "Thailand W"],
    ["Han Quoc Nu", "South Korea W"],
    ["Dai Bac Trung Hoa Nu", "Chinese Taipei W"],
    ["Viet Nam Nu", "Vietnam W"]
  ])("pairs %s with %s while retaining the provider's source name", (left, right) => {
    const rows = buildComparisonEvents([catalog("IM", left), catalog("BTI", right)])
      .flatMap((group) => group.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells.map((cell) => cell.provider)).toEqual(["IM", "BTI"]);
    expect(rows[0]!.cells[0]!.sourceEvent?.participantA).toBe(left);
    expect(rows[0]!.cells[1]!.sourceEvent?.participantA).toBe(right);
  });

  it.each([
    ["Helsingborgs IF", "Helsingborgs"],
    ["SK Slavia Praha", "Slavia Praha"],
    ["SK Rapid Wien II", "Rapid Wien II"],
    ["AC Sparta Praha", "Sparta Praha"]
  ])("preserves the existing IM/CMD pairing of %s and %s", (imName, cmdName) => {
    const rows = buildComparisonEvents([catalog("IM", imName), catalog("CMD", cmdName)])
      .flatMap((group) => group.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells.map((cell) => cell.provider)).toEqual(["IM", "CMD"]);
  });

  it.each([
    ["Nhat Ban Nu", "Japan"],
    ["Nhat Ban Nu", "Japan U20 W"],
    ["Nhat Ban U23", "Japan U20"],
    ["SK Rapid Wien II", "Rapid Vienna"],
    ["Young Violets Austria Wien", "Austria Vienna"],
    ["Viet Nam Nu", "Vietnam"]
  ])("keeps the distinct teams %s and %s separate", (left, right) => {
    expect(buildComparisonEvents([catalog("IM", left), catalog("BTI", right)])
      .flatMap((group) => group.rows)).toEqual([]);
  });

  it.each([
    ["Scotland Premiership", "Scottish Premiership"],
    ["Scotland Premiership", "Giải ngoại hạng Scotland"],
    ["Czech Republic First League", "Czech Republic 1st Division"],
    ["Czech Republic First League", "Giải Bóng Đá Hạng Nhất Quốc Gia Séc"],
    ["Czech Republic First League", "Giải Vô Địch Quốc Gia Cộng Hòa Séc"]
  ])("recognizes a single shared fixture in %s and %s", (left, right) => {
    expect(buildComparisonEvents([
      catalog("IM", "Known Home", "Known Away", left),
      catalog("BTI", "Known Home", "Known Away", right)
    ]).flatMap((group) => group.rows)).toHaveLength(1);
  });

  it.each(["Scottish Championship", "Scottish Premiership Women", "Czech Republic 2nd Division"])(
    "does not broaden the competition aliases into %s", (competition) => {
      const first = competition.startsWith("Scottish") ? "Scotland Premiership" : "Czech Republic First League";
      expect(buildComparisonEvents([
        catalog("IM", "Known Home", "Known Away", first),
        catalog("BTI", "Known Home", "Known Away", competition)
      ]).flatMap((group) => group.rows)).toEqual([]);
    });

  it.each(["2", "2.25", "2.75"])("compares Asian line %s after names match", (line) => {
    expect(buildComparisonEvents([
      catalog("IM", "SK Slavia Praha", "Known Away", "Shared Competition", kickoff, line),
      catalog("BTI", "Slavia Prague", "Known Away", "Shared Competition", kickoff, line)
    ]).flatMap((group) => group.rows)).toHaveLength(1);
  });
});

describe("complete football candidate search", () => {
  it("finds a compatible fuzzy fixture when an exact-name entry belongs to another competition", () => {
    const groups = buildComparisonEvents([
      catalog("SABA", "Lakeside Rovers", "Riverton United", "Different Cup"),
      catalog("IM", "Lakeside", "Riverton", "Shared League"),
      catalog("BTI", "Lakeside Rovers", "Riverton United", "Shared League")
    ]);
    const rows = groups.flatMap((group) => group.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells.map((cell) => cell.sourceMarket?.providerEventId)).toEqual(["IM-match", "BTI-match"]);
  });

  it("withholds an exact-name match when a second fuzzy group also meets the kickoff gate", () => {
    const groups = buildComparisonEvents([
      catalog("SABA", "Lakeside Rovers", "Riverton United", "Shared League", kickoff),
      catalog("IM", "Lakeside", "Riverton", "Shared League", kickoff + 240_000),
      catalog("BTI", "Lakeside Rovers", "Riverton United", "Shared League", kickoff + 120_000)
    ]);
    expect(groups.flatMap((group) => group.rows)).toEqual([]);
  });
});

describe("equivalent native markets in one fixture", () => {
  function duplicate(base: LiveCatalogResponse, id: string, receipts: readonly [number, number],
    prices: readonly [string, string] = ["2.12", "1.78"],
    settlementProfile = base.markets[0]!.settlementProfile): LiveCatalogResponse {
    const market = { ...base.markets[0]!, providerMarketId: id, settlementProfile };
    const quotes = base.quotes.slice(0, 2).map((quote, index) => ({ ...quote,
      providerMarketId: id, providerSelectionId: `${id}-${quote.selection}`,
      receivedMonotonicMs: receipts[index]!, rawOdds: prices[index]! }));
    return { ...base, markets: [...base.markets, market], quotes: [...base.quotes, ...quotes] };
  }

  it("keeps each complete native price pair and its original market and selection identities", () => {
    const im = duplicate(catalog("IM", "Shared Home"), "IM-alternate", [20, 20]);
    const groups = buildComparisonEvents([im, catalog("BTI", "Shared Home")]);
    const rows = groups.flatMap(group => group.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells.filter(cell => cell.provider === "IM")).toHaveLength(2);
    const cell = rows[0]!.cells.find(cell => cell.market.providerMarketId === "IM-alternate")!;
    expect(cell.market.providerMarketId).toBe("IM-alternate");
    expect(cell.sourceMarket).toEqual(im.markets[1]);
    expect(cell.sourceQuotes).toEqual(im.quotes.slice(2));
    expect(cell.quotes.map(q => [q.providerSelectionId, q.rawOdds])).toEqual([
      ["IM-alternate-OVER", "2.12"], ["IM-alternate-UNDER", "1.78"]
    ]);
    expect(groups.flatMap(group => group.observedRows)[0]!.cells.find(cell => cell.market.providerMarketId === "IM-alternate")
      ?.sourceMarket?.providerMarketId).toBe("IM-alternate");
    expect(im.markets).toHaveLength(2);
    expect(im.quotes).toHaveLength(4);
  });

  it("keeps whole offers separate when one native offer has uneven receipt ages", () => {
    const base = catalog("IM", "Shared Home");
    const im = duplicate({ ...base, quotes: base.quotes.map(q => ({ ...q, receivedMonotonicMs: 100 })) },
      "IM-alternate", [50, 1_000], ["3.00", "3.10"]);
    const rows = buildComparisonEvents([im, catalog("BTI", "Shared Home")]).flatMap(group => group.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells.find(cell => cell.provider === "IM")?.quotes.map(q => q.rawOdds))
      .toEqual(["1.95", "1.95"]);
  });

  it("retains equal-age native offers independently of catalog order", () => {
    const im = duplicate(catalog("IM", "Shared Home"), "00-native", [1, 1]);
    const reversed = { ...im, markets: [...im.markets].reverse(), quotes: [...im.quotes].reverse() };
    for (const input of [im, reversed]) {
      const rows = buildComparisonEvents([input, catalog("BTI", "Shared Home")]).flatMap(group => group.rows);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.cells.filter(cell => cell.provider === "IM").map(cell => cell.sourceMarket!.providerMarketId).sort()).toEqual(["00-native", "IM-market"]);
    }
  });

  it("does not coalesce native markets with different settlement contracts", () => {
    const im = duplicate(catalog("IM", "Shared Home"), "IM-extra-time", [20, 20],
      ["2.12", "1.78"], "football-including-extra-time");
    const rows = buildComparisonEvents([im, catalog("BTI", "Shared Home")]).flatMap(group => group.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells.every(cell => cell.market.settlementProfile === "football-regulation-including-added-time")).toBe(true);
  });

  it("keeps the existing event-identity ambiguity guard for repeated provider fixture IDs", () => {
    const first = catalog("IM", "Shared Home");
    const second = { ...first, events: first.events.map(e => ({ ...e, providerEventId: "second-event" })),
      markets: first.markets.map(m => ({ ...m, providerEventId: "second-event", providerMarketId: "second-market" })),
      quotes: first.quotes.map(q => ({ ...q, providerEventId: "second-event", providerMarketId: "second-market",
        providerSelectionId: `second-${q.selection}` })) };
    const im = { ...first, events: [...first.events, ...second.events], markets: [...first.markets, ...second.markets],
      quotes: [...first.quotes, ...second.quotes] };
    expect(buildComparisonEvents([im, catalog("BTI", "Shared Home")]).flatMap(group => group.rows)).toEqual([]);
  });

  it("does not replace a complete pair with an incomplete or mixed-generation alternate", () => {
    const im = duplicate(catalog("IM", "Shared Home"), "IM-alternate", [20, 20]);
    for (const quotes of [im.quotes.slice(0, 3), im.quotes.map((q, i) => i === 3 ? { ...q, sequence: 2 } : q)]) {
      const rows = buildComparisonEvents([{ ...im, quotes }, catalog("BTI", "Shared Home")])
        .flatMap(group => group.rows);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.cells.find(cell => cell.provider === "IM")?.sourceMarket?.providerMarketId).toBe("IM-market");
    }
  });
});
