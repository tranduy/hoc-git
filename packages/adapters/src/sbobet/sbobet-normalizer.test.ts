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
      { selectionId: "53888030010000000h", selection: "HOME", priceText: "1.03", priceFormat: "DECIMAL", locked: false },
      { selectionId: "53888030010000000d", selection: "DRAW", priceText: "10.25", priceFormat: "DECIMAL", locked: false },
      { selectionId: "53888030010000000a", selection: "AWAY", priceText: "60.00", priceFormat: "DECIMAL", locked: false }
    ]
  }]
};

describe("individually proven football result selections", () => {
  it("retains independently proven binary prices, requiring signed orientation for a lone handicap", () => {
    const single = (marketType: "FT_TOTAL" | "FT_BTTS" | "FT_AH", selection: "OVER" | "YES" | "AWAY", signed = false) =>
      normalizeSbobetCatalog([{ ...record, markets: [{ marketId: "partial-binary", marketType, lineText: "2.5",
        ...(signed ? { handicapLineFormat: "SIGNED" as const } : {}), selections: [{ selectionId: "native", selection,
          lineText: "-0.5", priceText: "0.9", locked: false }] }] }], { observedAtMs: 1, receivedMonotonicMs: 2, sequence: 3 });
    expect(single("FT_TOTAL", "OVER").quotes).toEqual([expect.objectContaining({ selection: "OVER", line: "2.5", rawOdds: "0.9" })]);
    expect(single("FT_BTTS", "YES").quotes).toEqual([expect.objectContaining({ selection: "YES", line: null })]);
    expect(single("FT_AH", "AWAY", true).quotes).toEqual([expect.objectContaining({ selection: "AWAY", line: "0.5" })]);
    expect(single("FT_AH", "AWAY").markets).toEqual([]);
  });
  it.each([
    ["FT_DOUBLE_CHANCE", "FULL_TIME", "HOME_DRAW"],
    ["FH_DOUBLE_CHANCE", "FIRST_HALF", "DRAW_AWAY"],
    ["SH_DOUBLE_CHANCE", "SECOND_HALF", "HOME_AWAY"],
    ["SH_1X2", "SECOND_HALF", "DRAW"],
    ["FT_1X2", "FULL_TIME", "AWAY"]
  ] as const)("retains a single native %s leg with exact scope and odds", (marketType, scope, selection) => {
    const result = normalizeSbobetCatalog([{ ...record, markets: [{ marketId: "native-result", marketType,
      lineText: null, selections: [{ selectionId: "native-leg", selection, priceText: "2.37",
        priceFormat: "DECIMAL", locked: false }] }] }], { observedAtMs: 1, receivedMonotonicMs: 2, sequence: 3 });
    expect(result.diagnostics).toEqual([]);
    expect(result.markets).toEqual([expect.objectContaining({ providerMarketId: "native-result", marketType, scope, line: null })]);
    expect(result.quotes).toEqual([expect.objectContaining({ providerSelectionId: "native-leg", selection,
      rawOdds: "2.37", rawFormat: "DECIMAL", scope, line: null, status: "OPEN" })]);
  });

  it("rejects duplicate or foreign result selections and empty offers", () => {
    const leg = { selectionId: "one", selection: "HOME_DRAW", priceText: "1.5", priceFormat: "DECIMAL", locked: false } as const;
    for (const selections of [[], [leg, { ...leg, selectionId: "two" }], [{ ...leg, selection: "HOME" as const }]]) {
      const result = normalizeSbobetCatalog([{ ...record, markets: [{ marketId: "dc", marketType: "FT_DOUBLE_CHANCE", lineText: null,
        selections }] }], { observedAtMs: 1, receivedMonotonicMs: 2, sequence: 3 });
      expect(result.markets).toEqual([]);
      expect(result.quotes).toEqual([]);
    }
  });

  it("keeps each result leg's suspension without closing its independent neighbor", () => {
    const result = normalizeSbobetCatalog([{ ...record, markets: [{ marketId: "partial-dc", marketType: "FT_DOUBLE_CHANCE",
      lineText: null, selections: [
        { selectionId: "hd", selection: "HOME_DRAW", priceText: "1.5", priceFormat: "DECIMAL", locked: true },
        { selectionId: "ha", selection: "HOME_AWAY", priceText: "1.7", priceFormat: "DECIMAL", locked: false }
      ] }] }], { observedAtMs: 1, receivedMonotonicMs: 2, sequence: 3 });
    expect(result.markets[0]?.status).toBe("OPEN");
    expect(result.quotes.map((quote) => [quote.selection, quote.status])).toEqual([["HOME_DRAW", "SUSPENDED"], ["HOME_AWAY", "OPEN"]]);
  });
});

describe("normalizeSbobetCatalog", () => {
  it.each(["SBOBET", "APSPORT", "BTI", "IM"] as const)(
    "does not invent equivalent half-unit lines from ambiguous %s split totals or handicaps", (provider) => {
      const input: SbobetCatalogInputRecord = { ...record, markets: [record.markets[0]!, {
        ...record.markets[0]!, marketId: "wide-split-total", lineText: "2/3"
      }, {
        marketId: "wide-split-handicap", marketType: "FT_AH", lineText: null, selections: [
          { selectionId: "split-home", selection: "HOME", priceText: "0.80", locked: false, lineText: "0/1" },
          { selectionId: "split-away", selection: "AWAY", priceText: "-0.90", locked: false, lineText: null }
        ]
      }] };

      const result = normalizeSbobetCatalog([input], { provider, observedAtMs: 1,
        receivedMonotonicMs: 1, sequence: 1 });

      expect(result.markets.map((market) => [market.providerMarketId, market.line]))
        .toEqual([["5388803:FT_TOTAL:2.5", "2.5"]]);
      expect(result.events).toHaveLength(1);
      expect(result.quotes).toHaveLength(2);
    });

  it.each(["-1", "/1", "1/", "2-3", "0.25/0.75"])(
    "rejects malformed or non-equivalent total line %s", (lineText) => {
      const result = normalizeSbobetCatalog([{ ...record,
        markets: [{ ...record.markets[0]!, lineText }] }],
      { observedAtMs: 1, receivedMonotonicMs: 1, sequence: 1 });

      expect(result.markets).toEqual([]);
      expect(result.quotes).toEqual([]);
    });

  it("retains the real BTI Faroe Islands fixture whose competition contains đảo", () => {
    const result = normalizeSbobetCatalog([{ ...record, eventId: "884501820779810816",
      leagueName: "Giải ngoại hạng - Quần đảo Faroe", teamNames: ["AB Argir", "B68 Toftir"],
      timeText: "PREMATCH", startAtUtcMs: Date.parse("2026-09-11T17:30:00.000Z"), markets: [] }],
    { provider: "BTI", observedAtMs: 1_788_859_512_328, receivedMonotonicMs: 1, sequence: 1 });
    expect(result.diagnostics).toEqual([]);
    expect(result.events).toEqual([expect.objectContaining({ providerEventId: "884501820779810816",
      provider: "BTI", competition: "Giải ngoại hạng - Quần đảo Faroe", participantA: "AB Argir",
      participantB: "B68 Toftir", isLive: false, startAtUtcMs: Date.parse("2026-09-11T17:30:00.000Z") })]);
  });

  it("still excludes the standalone Vietnamese virtual-football word ảo", () => {
    const result = normalizeSbobetCatalog([{ ...record, leagueName: "Giải bóng đá ảo" }],
      { provider: "BTI", observedAtMs: 1, receivedMonotonicMs: 1, sequence: 1 });
    expect(result).toEqual({ events: [], markets: [], quotes: [], diagnostics: ["SBOBET_CATALOG_EVENT_UNSUPPORTED"] });
  });

  it.each([true, false])("retains real Major League Soccer events (empty=%s)", (empty) => {
    const result = normalizeSbobetCatalog([{ ...record, leagueName: "USA Major League Soccer",
      teamNames: ["DC United", "Atlanta United"], timeText: "PREMATCH", startAtUtcMs: Date.UTC(2026, 8, 12),
      markets: empty ? [] : [record.markets[0]!] }],
    { provider: "APSPORT", observedAtMs: Date.UTC(2026, 8, 7), receivedMonotonicMs: 1, sequence: 1 });
    expect(result.diagnostics).toEqual([]);
    expect(result.events).toEqual([expect.objectContaining({ competition: "USA Major League Soccer", isLive: false })]);
    expect(result.markets).toHaveLength(empty ? 0 : 1);
  });

  it.each(["eSoccer", "e-Soccer", "e Soccer"])("still excludes explicit %s competitions", (label) => {
    const result = normalizeSbobetCatalog([{ ...record, leagueName: `World ${label} Battle` }],
      { provider: "APSPORT", observedAtMs: 1, receivedMonotonicMs: 1, sequence: 1 });
    expect(result.events).toEqual([]);
    expect(result.diagnostics).toEqual(["SBOBET_CATALOG_EVENT_UNSUPPORTED"]);
  });

  it("normalizes exact live totals and retains all three 1X2 outcomes", () => {
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

  it.each(["FT_1X2", "FH_1X2"] as const)("retains independently suspended %s outcomes and exact settlement scope", (marketType) => {
    const threeWay = record.markets[1]!;
    const result = normalizeSbobetCatalog([{ ...record, markets: [{ ...threeWay, marketType,
      selections: threeWay.selections.map((selection) => ({ ...selection, locked: selection.selection === "DRAW" })) }] }],
    { observedAtMs: 1, receivedMonotonicMs: 1, sequence: 1 });
    expect(result.markets).toEqual([expect.objectContaining({ marketType, line: null, status: "OPEN",
      scope: marketType === "FT_1X2" ? "FULL_TIME" : "FIRST_HALF",
      settlementProfile: marketType === "FT_1X2" ? "football-regulation-including-added-time" : "football-first-half-including-added-time" })]);
    expect(result.quotes).toHaveLength(3);
    expect(result.quotes.map((quote) => [quote.selection, quote.status])).toEqual([["HOME", "OPEN"], ["DRAW", "SUSPENDED"], ["AWAY", "OPEN"]]);
  });

  it.each(["duplicate-outcome", "duplicate-id", "invalid-price"])("rejects malformed 1X2: %s", (variant) => {
    const threeWay = record.markets[1]!;
    const selections = threeWay.selections.map((selection) => ({ ...selection }));
    if (variant === "duplicate-outcome") selections[2]!.selection = "HOME";
    if (variant === "duplicate-id") selections[2]!.selectionId = selections[0]!.selectionId;
    if (variant === "invalid-price") selections[2]!.priceText = "0";
    expect(normalizeSbobetCatalog([{ ...record, markets: [{ ...threeWay, selections }] }],
      { observedAtMs: 1, receivedMonotonicMs: 1, sequence: 1 }).markets).toEqual([]);
  });

  it("normalizes SBOBET split total syntax and retains a proven incomplete outcome", () => {
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
      .toMatchObject({ quotes: [expect.objectContaining({ selection: "OVER", line: "2.75" })], diagnostics: [] });
  });

  it("excludes explicit E Soccer competitions", () => {
    const result = normalizeSbobetCatalog([{ ...record, leagueName: "Giải đấu Bóng đá Điện tử 8 phút",
      teamNames: ["England (la_morocha)", "Brazil (lemickey)"] }], { observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 20, sequence: 3 });
    expect(result).toEqual({ events: [], markets: [], quotes: [], diagnostics: ["SBOBET_CATALOG_EVENT_UNSUPPORTED"] });
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

  it("preserves IM as the exact provider identity for I-Sports Football records", () => {
    const result = normalizeSbobetCatalog([record], { observedAtMs: 1_788_000_000_000,
      receivedMonotonicMs: 20, sequence: 3, provider: "IM" });
    expect(result.events[0]?.provider).toBe("IM");
    expect(result.markets.every((market) => market.provider === "IM")).toBe(true);
    expect(result.quotes.every((quote) => quote.provider === "IM")).toBe(true);
  });

  it("normalizes first-half handicap and total with a distinct scope and settlement", () => {
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
    expect(result.quotes.map(({ marketType, scope, selection }) => ({ marketType, scope, selection }))).toEqual([
      { marketType: "FH_TOTAL", scope: "FIRST_HALF", selection: "OVER" },
      { marketType: "FH_TOTAL", scope: "FIRST_HALF", selection: "UNDER" },
      { marketType: "FH_AH", scope: "FIRST_HALF", selection: "HOME" },
      { marketType: "FH_AH", scope: "FIRST_HALF", selection: "AWAY" }
    ]);
  });

  it("keeps second-half, corner, and card markets in distinct exact settlement domains", () => {
    const total = (marketId: string, marketType: SbobetCatalogInputRecord["markets"][number]["marketType"]) => ({
      marketId, marketType, lineText: "2.5", selections: [
        { selectionId: `${marketId}-o`, selection: "OVER" as const, priceText: "0.82", locked: false },
        { selectionId: `${marketId}-u`, selection: "UNDER" as const, priceText: "-0.96", locked: false }
      ]
    });
    const handicap = (marketId: string, marketType: SbobetCatalogInputRecord["markets"][number]["marketType"]) => ({
      marketId, marketType, lineText: null, selections: [
        { selectionId: `${marketId}-h`, selection: "HOME" as const, priceText: "0.72", locked: false, lineText: "0.5" },
        { selectionId: `${marketId}-a`, selection: "AWAY" as const, priceText: "-0.88", locked: false }
      ]
    });
    const expanded = { ...record, markets: [
      total("sh-total", "SH_TOTAL"), handicap("sh-ah", "SH_AH"),
      total("corner-ft-total", "CORNER_FT_TOTAL"), handicap("corner-ft-ah", "CORNER_FT_AH"),
      total("corner-fh-total", "CORNER_FH_TOTAL"), handicap("corner-fh-ah", "CORNER_FH_AH"),
      total("card-ft-total", "CARD_FT_TOTAL"), handicap("card-ft-ah", "CARD_FT_AH"),
      total("card-fh-total", "CARD_FH_TOTAL"), handicap("card-fh-ah", "CARD_FH_AH")
    ] } as SbobetCatalogInputRecord;

    const result = normalizeSbobetCatalog([expanded], { observedAtMs: 1_788_000_000_000,
      receivedMonotonicMs: 20, sequence: 3 });
    expect(result.markets.map(({ marketType, scope, settlementProfile }) =>
      [marketType, scope, settlementProfile])).toEqual([
      ["SH_TOTAL", "SECOND_HALF", "football-second-half-including-added-time"],
      ["SH_AH", "SECOND_HALF", "football-second-half-including-added-time"],
      ["CORNER_FT_TOTAL", "FULL_TIME", "football-corners-regulation"],
      ["CORNER_FT_AH", "FULL_TIME", "football-corners-regulation"],
      ["CORNER_FH_TOTAL", "FIRST_HALF", "football-corners-first-half"],
      ["CORNER_FH_AH", "FIRST_HALF", "football-corners-first-half"],
      ["CARD_FT_TOTAL", "FULL_TIME", "football-cards-regulation"],
      ["CARD_FT_AH", "FULL_TIME", "football-cards-regulation"],
      ["CARD_FH_TOTAL", "FIRST_HALF", "football-cards-first-half"],
      ["CARD_FH_AH", "FIRST_HALF", "football-cards-first-half"]
    ]);
  });

  it("normalizes exact no-line binary props and preserves decimal source odds", () => {
    const binary = (marketId: string, marketType: string, selections: readonly [string, string]) => ({
      marketId, marketType, lineText: null, selections: [
        { selectionId: `${marketId}-first`, selection: selections[0], priceText: "1.91",
          priceFormat: "DECIMAL", locked: false },
        { selectionId: `${marketId}-second`, selection: selections[1], priceText: "1.77",
          priceFormat: "DECIMAL", locked: false }
      ]
    });
    const expanded = { ...record, markets: [
      binary("odd-even", "FT_ODD_EVEN", ["ODD", "EVEN"]),
      binary("btts", "FT_BTTS", ["YES", "NO"])
    ] } as unknown as SbobetCatalogInputRecord;

    const result = normalizeSbobetCatalog([expanded], { observedAtMs: 1_788_000_000_000,
      receivedMonotonicMs: 20, sequence: 3, provider: "APSPORT" });

    expect(result.markets.map(({ marketType, line, settlementProfile }) =>
      [marketType, line, settlementProfile])).toEqual([
        ["FT_ODD_EVEN", null, "football-goals-odd-even-regulation"],
        ["FT_BTTS", null, "football-btts-regulation"]
      ]);
    expect(result.quotes.map(({ selection, rawOdds, rawFormat }) => [selection, rawOdds, rawFormat])).toEqual([
      ["ODD", "1.91", "DECIMAL"], ["EVEN", "1.77", "DECIMAL"],
      ["YES", "1.91", "DECIMAL"], ["NO", "1.77", "DECIMAL"]
    ]);
  });

  it("retains integer line markets for inventory while comparison rejects their push settlement", () => {
    const integer = { ...record, markets: [{
      marketId: "integer-total", marketType: "FT_TOTAL", lineText: "3", selections: [
        { selectionId: "integer-over", selection: "OVER", priceText: "0.82", locked: false },
        { selectionId: "integer-under", selection: "UNDER", priceText: "-0.96", locked: false }
      ]
    }] } as SbobetCatalogInputRecord;

    const result = normalizeSbobetCatalog([integer], { observedAtMs: 1_788_000_000_000,
      receivedMonotonicMs: 20, sequence: 3 });

    expect(result.markets).toEqual([expect.objectContaining({ marketType: "FT_TOTAL", line: "3" })]);
  });

  it("retains non-virtual canonical 1X2 and quarter-unit line inventory", () => {
    const mixed = { ...record, markets: [
      record.markets[0]!,
      record.markets[1]!,
      { marketId: "integer-total", marketType: "FT_TOTAL", lineText: "3", selections: [
        { selectionId: "integer-over", selection: "OVER", priceText: "0.82", locked: false },
        { selectionId: "integer-under", selection: "UNDER", priceText: "-0.96", locked: false }
      ] },
      { marketId: "quarter-ah", marketType: "FT_AH", lineText: null, selections: [
        { selectionId: "quarter-home", selection: "HOME", priceText: "0.72", locked: false, lineText: "0/0.5" },
        { selectionId: "quarter-away", selection: "AWAY", priceText: "-0.88", locked: false }
      ] },
      { marketId: "fh-total", marketType: "FH_TOTAL", lineText: "1.5", selections: [
        { selectionId: "fh-over", selection: "OVER", priceText: "0.82", locked: false },
        { selectionId: "fh-under", selection: "UNDER", priceText: "-0.96", locked: false }
      ] }
    ] } as SbobetCatalogInputRecord;
    const result = normalizeSbobetCatalog([mixed], { observedAtMs: 1_788_000_000_000,
      receivedMonotonicMs: 20, sequence: 3 });
    expect(result.markets.map(({ marketType, line }) => [marketType, line])).toEqual([
      ["FT_TOTAL", "2.5"], ["FT_1X2", null], ["FT_TOTAL", "3"], ["FT_AH", "-0.25"], ["FH_TOTAL", "1.5"]
    ]);

    const virtual = normalizeSbobetCatalog([{ ...mixed, leagueName: "Virtual Football", teamNames: ["A (V)", "B (V)"] }],
      { observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 20, sequence: 4 });
    expect(virtual).toEqual({ events: [], markets: [], quotes: [], diagnostics: ["SBOBET_CATALOG_EVENT_UNSUPPORTED"] });
  });
});
