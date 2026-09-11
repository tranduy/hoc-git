import { describe, expect, it } from "vitest";
import type { ProviderId } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { binaryOpposingCellPairs, buildComparisonEvents, resultOppositionCellPairs } from "./comparison.js";
import { resultCatalog } from "./result-opposition.fixture.js";

function catalog(provider: ProviderId, home: string, id = `${provider}-event`,
  marketId = `${provider}-total`): LiveCatalogResponse {
  return { dataMode: "LIVE", accountId: `catalog-source:${provider}:FOOTBALL`, provider,
    category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1,
    rejectedMarketCount: 0,
    events: [{ provider, category: "FOOTBALL", providerEventId: id, competition: "Argentina League",
      seasonStage: null, startAtUtcMs: 2_000_000, participantA: home, participantB: "Racing Club",
      eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
      fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null }],
    markets: [{ provider, category: "FOOTBALL", providerEventId: id, providerMarketId: marketId,
      marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", status: "OPEN",
      settlementProfile: "football-regulation-including-added-time" }],
    quotes: (["OVER", "UNDER"] as const).map(selection => ({ provider, category: "FOOTBALL",
      providerEventId: id, providerMarketId: marketId, providerSelectionId: `${id}-${selection}`,
      marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", selection, rawOdds: "1.95",
      rawFormat: "DECIMAL", status: "OPEN", isLive: false, sourceTimestampMs: null,
      receivedMonotonicMs: 1, sequence: 1 })) };
}

function pairs(catalogs: readonly LiveCatalogResponse[]): readonly string[] {
  return [...new Set(buildComparisonEvents(catalogs).flatMap(group => group.rows.flatMap(row =>
    (row.opposition ? resultOppositionCellPairs(row) : binaryOpposingCellPairs(row.cells)).map(cells => cells.map(cell =>
      `${cell.provider}:${cell.market.providerEventId}:${cell.market.providerMarketId}`).sort().join("|")))))].sort();
}

function merged(first: LiveCatalogResponse, second: LiveCatalogResponse): LiveCatalogResponse {
  return { ...first, events: [...first.events, ...second.events],
    markets: [...first.markets, ...second.markets], quotes: [...first.quotes, ...second.quotes] };
}

describe("native source relations", () => {
  it("retains two directly proven pairs when a third book has a non-transitive name variant", () => {
    // Observed BTI 881594462311313408, AP 5736367, IM 113505975 naming pattern.
    const bti = catalog("BTI", "Huracan");
    const ap = catalog("APSPORT", "Huracan (ARG)");
    const im = catalog("IM", "Club Atletico Huracan");
    expect(pairs([ap, im])).toEqual([]);
    const expected = [...pairs([bti, ap]), ...pairs([bti, im])].sort();
    expect(expected).toHaveLength(2);
    expect(pairs([bti, ap, im])).toEqual(expected);
    expect(pairs([im, bti, ap])).toEqual(expected);
  });

  it("does not turn competing fixtures within one provider into additional relations", () => {
    const first = catalog("IM", "Club Atletico Huracan", "im-first");
    const other = catalog("IM", "Club Atletico Huracan", "im-second");
    const im = merged(first, { ...other, events: other.events.map(event =>
      ({ ...event, startAtUtcMs: event.startAtUtcMs + 60_000 })) });
    const bti = catalog("BTI", "Huracan");
    const ap = catalog("APSPORT", "Huracan (ARG)");
    expect(pairs([im, ap, bti])).toEqual(pairs([ap, bti]));
  });

  it("does not bridge conflicting native fixture discriminators through an unnamed middle book", () => {
    const bti = catalog("BTI", "Huracan");
    const ap = catalog("APSPORT", "Huracan (ARG)");
    const im = catalog("IM", "Club Atletico Huracan");
    const tagged = (source: LiveCatalogResponse, fixtureDiscriminator: string): LiveCatalogResponse =>
      ({ ...source, events: source.events.map(event => ({ ...event, fixtureDiscriminator })) });
    expect(pairs([bti, tagged(ap, "fixture-a"), tagged(im, "fixture-b")])).toEqual([]);
  });

  it("does not duplicate relations already represented by a three-book group", () => {
    const sources = (["IM", "APSPORT", "BTI"] as const).map(provider => catalog(provider, "Huracan"));
    expect(pairs(sources)).toHaveLength(3);
    expect(buildComparisonEvents(sources).flatMap(group => group.rows)).toHaveLength(1);
  });

  it("preserves the native handicap line and reverses only the comparison orientation", () => {
    const handicap = (source: LiveCatalogResponse, line: string): LiveCatalogResponse => ({ ...source,
      markets: source.markets.map(market => ({ ...market, marketType: "FT_AH", line })),
      quotes: source.quotes.map((quote, index) => ({ ...quote, marketType: "FT_AH", line,
        selection: index === 0 ? "HOME" : "AWAY" })) });
    const bti = handicap(catalog("BTI", "Huracan"), "-0.5");
    const im = handicap(catalog("IM", "Club Atletico Huracan"), "-0.5");
    const nativeAp = handicap(catalog("APSPORT", "Huracan (ARG)"), "0.5");
    const ap = { ...nativeAp, events: nativeAp.events.map(event => ({ ...event,
      participantA: event.participantB, participantB: event.participantA })) };
    expect(pairs([bti, im, ap])).toEqual([...pairs([bti, im]), ...pairs([bti, ap])].sort());
    const row = buildComparisonEvents([bti, im, ap]).flatMap(group => group.rows)
      .find(row => row.cells.some(cell => cell.provider === "APSPORT"))!;
    expect(new Set(row.cells.map(cell => cell.market.line)).size).toBe(1);
    const btiCell = row.cells.find(cell => cell.provider === "BTI")!;
    expect(btiCell.sourceMarket?.line).toBe("-0.5");
    expect(btiCell.market.line).toBe("0.5");
    expect(btiCell.sourceQuotes).toEqual(bti.quotes);
  });

  it("recovers real singleton result/DC legs without synthesizing a third-book result relation", () => {
    const named = (provider: ProviderId, home: string, dc: boolean): LiveCatalogResponse => {
      const source = resultCatalog(provider, dc, [dc ? "DRAW_AWAY" : "HOME"]);
      return { ...source, events: source.events.map(event =>
        ({ ...event, participantA: home, participantB: "Racing Club" })) };
    };
    const bti = named("BTI", "Huracan", false);
    const ap = named("APSPORT", "Huracan (ARG)", true);
    const im = named("IM", "Club Atletico Huracan", true);
    expect(pairs([bti, ap, im])).toEqual([...pairs([bti, ap]), ...pairs([bti, im])].sort());
    expect(pairs([bti, ap, im])).toHaveLength(2);
    for (const row of buildComparisonEvents([bti, ap, im]).flatMap(group => group.rows)) {
      expect(row.opposition).toEqual({ kind: "RESULT_COMPLEMENT", single: "HOME", double: "DRAW_AWAY" });
      expect(row.cells.every(cell => cell.quotes.length === 1 && cell.sourceQuotes?.length === 1)).toBe(true);
    }
  });

  it.each(["SUSPENDED", "PROFILE", "PERIOD"] as const)(
    "keeps the %s gate on recovered fixture relations", gate => {
      const bti = catalog("BTI", "Huracan");
      const ap = catalog("APSPORT", "Huracan (ARG)");
      const original = catalog("IM", "Club Atletico Huracan");
      const im: LiveCatalogResponse = { ...original,
        markets: original.markets.map(market => gate === "SUSPENDED" ? { ...market, status: "SUSPENDED" }
          : gate === "PROFILE" ? { ...market, settlementProfile: "different-settlement" }
          : { ...market, marketType: "FH_TOTAL", scope: "FIRST_HALF" }),
        quotes: original.quotes.map(quote => gate === "PERIOD"
          ? { ...quote, marketType: "FH_TOTAL", scope: "FIRST_HALF" } : quote) };
      expect(pairs([bti, ap, im])).toEqual(pairs([bti, ap]));
    });

  it("recovers a different-line total relation when the lower over and higher under cover every result", () => {
    const bti = catalog("BTI", "Huracan");
    const ap = catalog("APSPORT", "Huracan (ARG)");
    const original = catalog("IM", "Club Atletico Huracan");
    const im: LiveCatalogResponse = { ...original,
      markets: original.markets.map(market => ({ ...market, line: "3.5" })),
      quotes: original.quotes.map(quote => ({ ...quote, line: "3.5" })) };
    expect(pairs([bti, ap, im])).toEqual([...pairs([bti, ap]), ...pairs([bti, im])].sort());
  });

  it("qualifies reused native market IDs by their native fixture before assembling quotes", () => {
    const ap = catalog("APSPORT", "Huracan", "ap-huracan", "reused-native-market");
    const unrelated = catalog("APSPORT", "Different Home", "ap-unrelated", "reused-native-market");
    const bti = catalog("BTI", "Huracan");
    const combined = merged(ap, unrelated);
    expect(pairs([combined, bti])).toEqual(pairs([ap, bti]));
    const cell = buildComparisonEvents([combined, bti]).flatMap(group => group.rows)
      .flatMap(row => row.cells).find(candidate => candidate.provider === "APSPORT")!;
    expect(cell.sourceQuotes).toEqual(ap.quotes);
    expect(cell.quotes.every(quote => quote.providerEventId === "ap-huracan")).toBe(true);
  });

  it("still rejects conflicting quotes within the same native event and market identity", () => {
    const ap = catalog("APSPORT", "Huracan");
    const conflicting = { ...ap, quotes: [...ap.quotes,
      { ...ap.quotes[0]!, rawOdds: "2.10", providerSelectionId: "conflicting-over" }] };
    expect(pairs([conflicting, catalog("BTI", "Huracan")])).toEqual([]);
  });
});
