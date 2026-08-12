import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog, type SbobetCatalogInputRecord } from "./sbobet-normalizer.js";

const record: SbobetCatalogInputRecord = {
  eventId: "5388803", leagueName: "Eliteserien", timeText: "2H 37'", scoreText: "2 - 0",
  teamNames: ["Kristiansund BK", "Molde"], markets: [{
    marketId: "5388803:FT_TOTAL:2.5", marketType: "FT_TOTAL", lineText: "2.5",
    selections: [
      { selectionId: "53888030030002005h", selection: "OVER", priceText: "-0.85", locked: false },
      { selectionId: "53888030030002005a", selection: "UNDER", priceText: "0.69", locked: false }
    ]
  }, {
    marketId: "5388803:FT_1X2", marketType: "FT_1X2", lineText: null,
    selections: [
      { selectionId: "53888030010000000h", selection: "HOME", priceText: "1.03", locked: false },
      { selectionId: "53888030010000000d", selection: "DRAW", priceText: "10.25", locked: false },
      { selectionId: "53888030010000000a", selection: "AWAY", priceText: "60.00", locked: false }
    ]
  }]
};

describe("normalizeSbobetCatalog", () => {
  it("normalizes exact live totals and 1X2 with score evidence", () => {
    const result = normalizeSbobetCatalog([record], { observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 20, sequence: 3 });
    expect(result.diagnostics).toEqual([]);
    expect(result.events[0]).toMatchObject({
      provider: "SBOBET", participantA: "Kristiansund BK", participantB: "Molde", isLive: true,
      liveState: { period: "2H", scoreHome: 2, scoreAway: 0, clockMs: 2_220_000 }
    });
    expect(result.markets.map((market) => [market.marketType, market.line])).toEqual([["FT_TOTAL", "2.5"], ["FT_1X2", null]]);
    expect(result.quotes.map((quote) => [quote.selection, quote.rawOdds, quote.rawFormat])).toEqual([
      ["OVER", "-0.85", "MALAY"], ["UNDER", "0.69", "MALAY"],
      ["HOME", "1.03", "DECIMAL"], ["DRAW", "10.25", "DECIMAL"], ["AWAY", "60.00", "DECIMAL"]
    ]);
  });

  it("normalizes SBOBET split total syntax and fails closed on incomplete outcomes", () => {
    const split: SbobetCatalogInputRecord = {
      ...record,
      markets: [{ ...record.markets[0]!, lineText: "2.5-3", marketId: "split" }]
    };
    expect(normalizeSbobetCatalog([split], { observedAtMs: 1, receivedMonotonicMs: 1, sequence: 1 }).markets[0]?.line).toBe("2.75");
    const incomplete: SbobetCatalogInputRecord = {
      ...split,
      markets: [{ ...split.markets[0]!, selections: [split.markets[0]!.selections[0]!] }]
    };
    expect(normalizeSbobetCatalog([incomplete], { observedAtMs: 1, receivedMonotonicMs: 1, sequence: 1 }))
      .toEqual({ events: [], markets: [], quotes: [], diagnostics: ["SBOBET_CATALOG_RECORD_REJECTED"] });
  });

  it("marks explicit E Soccer competitions as virtual", () => {
    const result = normalizeSbobetCatalog([{ ...record, leagueName: "Giải đấu Bóng đá Điện tử 8 phút",
      teamNames: ["England (la_morocha)", "Brazil (lemickey)"] }], { observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 20, sequence: 3 });
    expect(result.events[0]).toMatchObject({ isVirtual: true, sportVariant: "VIRTUAL_FOOTBALL" });
  });

  it("normalizes a full-time half-goal handicap to the home-oriented line", () => {
    const handicap = {
      ...record,
      markets: [{ marketId: "5388803:FT_AH:-0.5", marketType: "FT_AH", lineText: "0.5", selections: [
        { selectionId: "5388803-ah-h", selection: "HOME", priceText: "0.79", locked: false, lineText: "0.5" },
        { selectionId: "5388803-ah-a", selection: "AWAY", priceText: "-0.87", locked: false, lineText: null }
      ] }]
    } as unknown as SbobetCatalogInputRecord;

    const result = normalizeSbobetCatalog([handicap], { observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 20, sequence: 3 });
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "FT_AH", line: "-0.5" })]);
    expect(result.quotes.map((quote) => [quote.selection, quote.rawFormat])).toEqual([
      ["HOME", "MALAY"], ["AWAY", "MALAY"]
    ]);
  });

  it("normalizes first-half handicap and total with first-half scope and settlement", () => {
    const firstHalf = { ...record, markets: [
      { marketId: "fh-total", marketType: "FH_TOTAL", lineText: "1.5", selections: [
        { selectionId: "fh-over", selection: "OVER", priceText: "0.82", locked: false },
        { selectionId: "fh-under", selection: "UNDER", priceText: "-0.96", locked: false }
      ] },
      { marketId: "fh-ah", marketType: "FH_AH", lineText: null, selections: [
        { selectionId: "fh-home", selection: "HOME", priceText: "0.72", locked: false, lineText: null },
        { selectionId: "fh-away", selection: "AWAY", priceText: "-0.88", locked: false, lineText: "0.5" }
      ] }
    ] } as SbobetCatalogInputRecord;

    const result = normalizeSbobetCatalog([firstHalf], { observedAtMs: 1_788_000_000_000,
      receivedMonotonicMs: 20, sequence: 3 });
    expect(result.markets.map(({ marketType, scope, line, settlementProfile }) =>
      ({ marketType, scope, line, settlementProfile }))).toEqual([
      { marketType: "FH_TOTAL", scope: "FIRST_HALF", line: "1.5",
        settlementProfile: "football-first-half-including-added-time" },
      { marketType: "FH_AH", scope: "FIRST_HALF", line: "0.5",
        settlementProfile: "football-first-half-including-added-time" }
    ]);
  });
});
