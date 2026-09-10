import { describe, expect, it } from "vitest";
import type { ProviderId } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";

function catalog(provider: ProviderId, home: string, away: string, competition = "Observed League"): LiveCatalogResponse {
  return { dataMode: "LIVE", accountId: provider, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1, rejectedMarketCount: 0,
    events: [{ provider, category: "FOOTBALL", providerEventId: provider, participantA: home, participantB: away,
      competition, seasonStage: null, startAtUtcMs: 2_000_000, eventScope: "REGULATION", bestOf: null,
      isLive: false, rematchCandidate: false, fixtureDiscriminator: null, isVirtual: false,
      sportVariant: "FOOTBALL", liveState: null }],
    markets: [{ provider, category: "FOOTBALL", providerEventId: provider, providerMarketId: provider + "-total",
      marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", status: "OPEN",
      settlementProfile: "football-regulation-including-added-time" }],
    quotes: (["OVER", "UNDER"] as const).map(selection => ({ provider, category: "FOOTBALL",
      providerEventId: provider, providerMarketId: provider + "-total", providerSelectionId: provider + selection,
      marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", selection, rawOdds: "1.95", rawFormat: "DECIMAL",
      status: "OPEN", isLive: false, receivedMonotonicMs: 1, sourceTimestampMs: null, sequence: 1 })) };
}
const rows = (a: LiveCatalogResponse, b: LiveCatalogResponse) => buildComparisonEvents([a, b]).flatMap(e => e.rows);

describe("observed six-provider fixture spellings", () => {
  // Opponents and names from the fixed 2026-09-10 six-book capture. A shared
  // competition isolates the participant gate from the league-translation gate.
  it.each([
    ["TPS", "TPS Turku", "IFK Mariehamn"], ["AC Oulu", "Oulu", "Gnistan Helsinki"],
    ["GAIS", "GAIS Goteborg", "Djurgardens IF"], ["Gent", "KAA Gent", "AGF Aarhus"],
    ["Wolverhampton", "Wolves", "Everton"], ["Heart of Midlothian FC", "Hearts", "FC Nordsjaelland"],
    ["Dinamo Bucuresti", "Dinamo Bucharest", "Csikszereda"], ["FC Copenhagen", "FC Kobenhavn", "AC Horsens"],
    ["Moss", "Moss FK", "Haugesund"], ["Queen's Park FC", "Queens Park", "Dunfermline Athletic"],
    ["Krylya Sovetov", "PFC Krylia Sovetov", "Rodina Moscow"], ["Ham-Kam", "HamKam", "Molde FK"],
    ["Sporting Lisboa II", "Sporting Lisbon II", "Lusitania FC"],
    ["Bắc Ireland", "Northern Ireland", "Georgia"], ["Bắc Macedonia", "North Macedonia", "Thụy Sĩ"],
    ["Central Cordoba Santiago del Estero", "Central Cordoba SdE", "Boca Juniors"],
    ["FC Dinamo Bucuresti 1948", "Dinamo Bucuresti", "AFK Csikszereda Miercurea Ciuc"],
    ["FK Akron Togliatti", "Akron Togliatti", "FC Krasnodar"]
  ])("pairs %s and %s with native identities intact", (a, b, opponent) => {
    const left = catalog("CMD", a, opponent), right = catalog("BTI", b, opponent);
    const result = rows(left, right);
    expect(result).toHaveLength(1);
    expect(result[0]!.cells.map(c => c.sourceMarket?.providerMarketId).sort()).toEqual(["BTI-total", "CMD-total"]);
    expect(result[0]!.cells.find(c => c.provider === "BTI")?.sourceEvent?.participantA).toBe(b);
  });

  it.each([
    ["TPS Turku Women", "TPS"], ["TPS Turku U19", "TPS"], ["Sporting Lisboa II", "Sporting Lisbon"],
    ["OLS", "AC Oulu"], ["Queens Park Rangers", "Queen's Park FC"],
    ["Athletic Club", "Athletic Club MG"], ["United FC", "United FC Dubai"]
  ])("keeps distinct teams %s and %s separate", (a, b) => {
    expect(rows(catalog("CMD", a, "Opponent"), catalog("BTI", b, "Opponent"))).toEqual([]);
  });

  it("keeps kickoff and duplicate-provider ambiguity gates after resolving a name", () => {
    const a = catalog("CMD", "TPS", "IFK Mariehamn"), b = catalog("BTI", "TPS Turku", "IFK Mariehamn");
    expect(rows(a, { ...b, events: b.events.map(e => ({ ...e, startAtUtcMs: e.startAtUtcMs + 180_000 })) })).toEqual([]);
    const duplicate = { ...a, events: [...a.events, { ...a.events[0]!, providerEventId: "duplicate" }],
      markets: [...a.markets, { ...a.markets[0]!, providerEventId: "duplicate", providerMarketId: "duplicate" }] };
    expect(rows(duplicate, b)).toEqual([]);
  });

  it.each([
    ["LATVIA VIRSLIGA", "Giải Ngoại hạng Latvia", "SK Super Nova", "FK Tukums 2000"],
    ["Latvia Virsliga", "Giải Virsliga, Latvia", "SK Super Nova", "Tukums 2000"],
    ["Cyprus Division 1", "CYPRUS 1ST DIVISION", "AEL Limassol", "Nea Salamis Famagusta"],
    ["CYPRUS 1ST DIVISION", "Giải Hạng Nhất Síp", "AEL Limassol", "Nea Salamis"],
    ["Azerbaijan Premier League", "Giải Azerbaijan - Premier", "Imisli", "Neftchi Baku"],
    ["Azerbaijan Division 1", "Giải hạng Nhất Azerbaijan", "Zaqatala PFK", "Baku Sporting"],
    ["UEFA YOUTH LEAGUE", "Giải trẻ U19 UEFA", "Barcelona U19", "Feyenoord U19"],
    ["FIFA U20 Women World Cup (In Poland)", "Giải FIFA World Cup U20 Nữ", "Colombia U20 W", "Portugal U20 W"],
    ["2026 U20 WOMEN WORLD CUP (IN POLAND)", "Giải vô địch U20 bóng đá nữ thế giới", "Colombia U20 W", "Portugal U20 W"],
    ["GIẢI VÔ ĐỊCH BÓNG ĐÁ NỮ U20 THẾ GIỚI 2026 (TẠI BA LAN)", "FIFA U20 Women World Cup (In Poland)", "Colombia U20 W", "Portugal U20 W"]
  ])("links the observed league labels %s and %s", (a, b, home, away) => {
    expect(rows(catalog("CMD", home, away, a), catalog("BTI", home, away, b))).toHaveLength(1);
  });

  it.each([
    ["Azerbaijan Premier League", "Azerbaijan Division 1"],
    ["UEFA YOUTH LEAGUE", "UEFA Champions League"],
    ["FIFA U20 Women World Cup (In Poland)", "FIFA U20 World Cup"],
    ["Iceland Cup", "Giải bóng ném tranh cúp vô địch Iceland"],
    ["South Australia National Premier League - Playoff", "Giải hạng Nhất Quốc gia Úc"]
  ])("does not alias conflicting or underspecified competition %s to %s", (a, b) => {
    expect(rows(catalog("CMD", "Team A", "Team B", a), catalog("BTI", "Team A", "Team B", b))).toEqual([]);
  });
});
