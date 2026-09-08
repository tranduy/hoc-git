import { describe, expect, it } from "vitest";
import { extractImFootballCatalog, mergeImFootballDelta,
  mergeImFootballSnapshots, observeNativeImFootballMarkets } from "./im-football-catalog-source.js";

const event = {
  eid: 112516390, htn: "Monterrey Rayados", atn: "Nashville SC",
  cn: "Leagues Cup", edt: "2026-08-12T20:00:00-04:00", isrbt: false, iscyb: false,
  mls: [
    { mi: 10, bti: 1, gp: 1, il: false, ws: [
      { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.67, ot: 1 },
      { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.79, ot: 1 }
    ] },
    { mi: 11, bti: 1, gp: 1, il: false, ws: [
      { wsi: 111, si: 1, hdp: -0.25, dih: "+0/0.5", o: 0.87, ot: 1 },
      { wsi: 112, si: 2, hdp: -0.25, dih: "-0/0.5", o: -0.99, ot: 1 }
    ] },
    { mi: 12, bti: 2, gp: 1, il: false, ws: [
      { wsi: 121, si: 3, hdp: 2.5, dih: "2.5", o: 0.7, ot: 1 },
      { wsi: 122, si: 4, hdp: 2.5, dih: "2.5", o: -0.84, ot: 1 }
    ] }
  ]
};

describe("extractImFootballCatalog", () => {
  it("accounts for every native IM market without treating an unknown type as a comparable ticket", () => {
    const candidate = { ...event, mls: [
      event.mls[0],
      { mi: 40, bti: 3, gp: 1, ws: [
        { wsi: 401, si: 5, o: 2.1 }, { wsi: 402, si: 7, o: 3.2 }, { wsi: 403, si: 6, o: 3.4 }
      ] },
      { mi: 41, bti: 777, gp: 19, ws: [
        { wsi: 411, si: 801, o: 0.9 }, { wsi: 412, si: 802, o: -0.95 }
      ] }
    ] };

    expect(observeNativeImFootballMarkets({ StatusCode: 100, sel: [candidate] }, 1234)).toEqual([
      expect.objectContaining({ providerMarketId: "10", nativeType: "bti=1", nativeScope: "gp=1",
        outcomeLabels: ["HOME", "AWAY"], disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED" }),
      expect.objectContaining({ providerMarketId: "40", nativeType: "bti=3", nativeScope: "gp=1",
        outcomeLabels: ["5", "7", "6"], disposition: "EXCLUDED", reason: "THREE_WAY_OUTCOME_DOMAIN" }),
      expect.objectContaining({ providerMarketId: "41", nativeType: "bti=777", nativeScope: "gp=19",
        outcomeLabels: ["801", "802"], disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED" })
    ]);
  });

  it("keeps live events and every future prematch event without a time horizon", () => {
    const nowMs = Date.parse("2026-08-19T00:00:00.000Z");
    const candidate = (eid: number, edt: string, isrbt = false) => ({ ...event, eid, edt, isrbt });

    const records = extractImFootballCatalog({ StatusCode: 100, sel: [
      candidate(1, "2026-08-01T00:00:00.000Z", true),
      candidate(2, "2026-08-18T23:59:59.999Z"),
      candidate(3, "2026-08-19T00:00:00.000Z"),
      candidate(4, "2026-08-21T00:00:00.000Z"),
      candidate(5, "2026-08-21T00:00:00.001Z")
    ] }, { nowMs });

    expect(records.map(({ eventId }) => eventId)).toEqual(["1", "3", "4", "5"]);
  });

  it("extracts exact full-time fractional handicap and total tickets", () => {
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [event] })).toEqual([{
      eventId: "112516390", leagueName: "Leagues Cup", timeText: "PREMATCH", scoreText: null,
      startAtUtcMs: Date.parse("2026-08-12T20:00:00-04:00"),
      teamNames: ["Monterrey Rayados", "Nashville SC"],
      markets: [{ marketId: "10", marketType: "FT_AH", lineText: null, selections: [
        { selectionId: "101", selection: "HOME", priceText: "0.67", locked: false, lineText: "+0.5" },
        { selectionId: "102", selection: "AWAY", priceText: "-0.79", locked: false, lineText: "-0.5" }
      ] }, { marketId: "11", marketType: "FT_AH", lineText: null, selections: [
        { selectionId: "111", selection: "HOME", priceText: "0.87", locked: false, lineText: "+0/0.5" },
        { selectionId: "112", selection: "AWAY", priceText: "-0.99", locked: false, lineText: "-0/0.5" }
      ] }, { marketId: "12", marketType: "FT_TOTAL", lineText: "2.5", selections: [
        { selectionId: "121", selection: "OVER", priceText: "0.7", locked: false, lineText: "2.5" },
        { selectionId: "122", selection: "UNDER", priceText: "-0.84", locked: false, lineText: "2.5" }
      ] }]
    }]);
  });

  it("normalizes proved line-free, team and corner two-way IM markets", () => {
    const candidate = { ...event, mls: [
      { mi: 50, bti: 5, gp: 1, ws: [
        { wsi: 501, si: 10, o: 0.88 }, { wsi: 502, si: 11, o: -0.96 }
      ] },
      { mi: 51, bti: 18, gp: 1, ws: [
        { wsi: 511, si: 87, o: 0.83 }, { wsi: 512, si: 88, o: -0.91 }
      ] },
      { mi: 55, bti: 18, gp: 3, ws: [
        { wsi: 551, si: 87, o: 0.81 }, { wsi: 552, si: 88, o: -0.89 }
      ] },
      { mi: 52, bti: 31, gp: 1, ws: [
        { wsi: 521, si: 118, hdp: 1.5, dih: "1.5", o: -0.9 },
        { wsi: 522, si: 119, hdp: 1.5, dih: "1.5", o: 0.82 }
      ] },
      { mi: 53, bti: 299, gp: 2, ws: [
        { wsi: 531, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8 },
        { wsi: 532, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9 }
      ] },
      { mi: 54, bti: 306, gp: 1, ws: [
        { wsi: 541, si: 3, hdp: 9.5, dih: "9.5", o: 0.86 },
        { wsi: 542, si: 4, hdp: 9.5, dih: "9.5", o: -0.94 }
      ] }
    ] };

    expect(extractImFootballCatalog({ StatusCode: 100, sel: [candidate] })[0]?.markets).toEqual([
      expect.objectContaining({ marketId: "50", marketType: "FT_ODD_EVEN", lineText: null,
        selections: [expect.objectContaining({ selection: "ODD" }), expect.objectContaining({ selection: "EVEN" })] }),
      expect.objectContaining({ marketId: "51", marketType: "FT_BTTS", lineText: null,
        selections: [expect.objectContaining({ selection: "YES" }), expect.objectContaining({ selection: "NO" })] }),
      expect.objectContaining({ marketId: "55", marketType: "SH_BTTS", lineText: null,
        selections: [expect.objectContaining({ selection: "YES" }), expect.objectContaining({ selection: "NO" })] }),
      expect.objectContaining({ marketId: "52", marketType: "HOME_FT_TOTAL", lineText: "1.5",
        selections: [expect.objectContaining({ selection: "UNDER" }), expect.objectContaining({ selection: "OVER" })] }),
      expect.objectContaining({ marketId: "53", marketType: "CORNER_FH_AH" }),
      expect.objectContaining({ marketId: "54", marketType: "CORNER_FT_TOTAL", lineText: "9.5" })
    ]);
  });

  it("preserves Malay odds and normalizes positive Hong Kong odds without rounding", () => {
    const decoded = [0.67, -0.79, 1.25, 3].map((odds) => {
      const candidate = { ...event, mls: [{ ...event.mls[0], ws: event.mls[0]!.ws
        .map((item, index) => index === 0 ? { ...item, o: odds } : item) }] };
      return extractImFootballCatalog({ StatusCode: 100, sel: [candidate] })[0]
        ?.markets[0]?.selections[0]?.priceText;
    });

    expect(decoded).toEqual(["0.67", "-0.79", "-0.8", "-0.3333333333333333"]);
  });

  it.each([
    ["zero", 0],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["a malformed string", "1.25"],
    ["unsupported nested odds", { value: 1.25 }],
    ["an out-of-contract negative value", -1.01],
    ["a Hong Kong value whose exact Malay form is scientific notation", 1e7]
  ])("rejects %s at the IM catalog boundary", (_label, odds) => {
    const candidate = { ...event, mls: [{ ...event.mls[0], ws: event.mls[0]!.ws
      .map((item, index) => index === 0 ? { ...item, o: odds } : item) }] };

    expect(extractImFootballCatalog({ StatusCode: 100, sel: [candidate] })).toEqual([]);
  });

  it("does not turn a malformed price delta into a provider removal", () => {
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    const malformed = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{
      ...event.mls[0], ws: event.mls[0]!.ws.map((item, index) => index === 0
        ? { ...item, o: 0 } : item)
    }] }] };

    expect(mergeImFootballDelta(initial, malformed)).toBe(initial);
    expect(initial[0]?.markets[0]?.selections.map((item) => item.priceText)).toEqual(["0.67", "-0.79"]);
  });

  it("applies a delta whose changed market has no published line yet by withdrawing only that market", () => {
    // Measured 2026-09-01: IM emits in-domain markets whose selections lack
    // `hdp` entirely. Refusing the whole delta for one of them left every
    // other price in that delta standing as current.
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [
      { ...event.mls[0], ws: event.mls[0]!.ws.map(({ hdp: _line, ...item }) => item) },
      { ...event.mls[2], ws: event.mls[2]!.ws.map((item) => ({ ...item, o: 0.75 })) }
    ] }] };

    const merged = mergeImFootballDelta(initial, delta);
    expect(merged).not.toBe(initial);
    expect(merged[0]?.markets.map((item) => item.marketId)).toEqual(["11", "12"]);
    expect(merged[0]?.markets[1]?.selections[0]?.priceText).toBe("0.75");
  });

  it("excludes a market with no published line from a snapshot without dropping the event", () => {
    const withLineless = { ...event, mls: [...event.mls,
      { mi: 13, bti: 2, gp: 1, il: false, ws: [
        { wsi: 131, si: 3, dih: "3", o: 0.95, ot: 1 },
        { wsi: 132, si: 4, dih: "3", o: -1.05, ot: 1 }
      ] }] };
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [withLineless] })[0]?.markets.map((item) => item.marketId))
      .toEqual(["10", "11", "12"]);
  });

  it("keeps first-half handicap and total identities separate from full-time", () => {
    const firstHalf = { ...event, mls: [
      { mi: 20, bti: 1, gp: 2, il: false, ws: [
        { wsi: 201, si: 1, hdp: -0.75, dih: "+0.5/1", o: 0.78, ot: 1 },
        { wsi: 202, si: 2, hdp: -0.75, dih: "-0.5/1", o: -0.9, ot: 1 }
      ] },
      { mi: 21, bti: 2, gp: 2, il: false, ws: [
        { wsi: 211, si: 3, hdp: 1.25, dih: "1/1.5", o: 0.81, ot: 1 },
        { wsi: 212, si: 4, hdp: 1.25, dih: "1/1.5", o: -0.93, ot: 1 }
      ] }
    ] };

    expect(extractImFootballCatalog({ StatusCode: 100, sel: [firstHalf] })[0]?.markets).toEqual([
      { marketId: "20", marketType: "FH_AH", lineText: null, selections: [
        { selectionId: "201", selection: "HOME", priceText: "0.78", locked: false, lineText: "+0.5/1" },
        { selectionId: "202", selection: "AWAY", priceText: "-0.9", locked: false, lineText: "-0.5/1" }
      ] },
      { marketId: "21", marketType: "FH_TOTAL", lineText: "1/1.5", selections: [
        { selectionId: "211", selection: "OVER", priceText: "0.81", locked: false, lineText: "1/1.5" },
        { selectionId: "212", selection: "UNDER", priceText: "-0.93", locked: false, lineText: "1/1.5" }
      ] }
    ]);
  });

  it("maps provider game period 3 to exact second-half handicap and total tickets", () => {
    const secondHalf = { ...event, mls: [
      { mi: 30, bti: 1, gp: 3, il: false, ws: [
        { wsi: 301, si: 1, hdp: -0.75, dih: "+0.5/1", o: 0.78, ot: 1 },
        { wsi: 302, si: 2, hdp: -0.75, dih: "-0.5/1", o: -0.9, ot: 1 }
      ] },
      { mi: 31, bti: 2, gp: 3, il: false, ws: [
        { wsi: 311, si: 3, hdp: 1.25, dih: "1/1.5", o: 0.81, ot: 1 },
        { wsi: 312, si: 4, hdp: 1.25, dih: "1/1.5", o: -0.93, ot: 1 }
      ] }
    ] };

    expect(extractImFootballCatalog({ StatusCode: 100, sel: [secondHalf] })[0]?.markets
      .map(({ marketId, marketType }) => ({ marketId, marketType }))).toEqual([
        { marketId: "30", marketType: "SH_AH" },
        { marketId: "31", marketType: "SH_TOTAL" }
      ]);
  });

  it("fails closed for an unproved game period or non-opposing first-half domain", () => {
    const wrongPeriod = { ...event, mls: [{
      mi: 30, bti: 1, gp: 4, ws: [
        { wsi: 301, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8 },
        { wsi: 302, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9 }
      ]
    }] };
    const duplicateOutcome = { ...event, mls: [{
      mi: 31, bti: 1, gp: 2, ws: [
        { wsi: 311, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8 },
        { wsi: 312, si: 1, hdp: -0.5, dih: "-0.5", o: -0.9 }
      ]
    }] };

    expect(extractImFootballCatalog({ StatusCode: 100, sel: [wrongPeriod] })).toEqual([]);
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [duplicateOutcome] })).toEqual([]);
  });

  it("extracts live score and clock but rejects virtual, malformed and non-success envelopes", () => {
    const live = { ...event, eid: 20, isrbt: true, rbt: "2H 72:44", hs: 2, as: 1 };
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [live] })[0]).toMatchObject({
      eventId: "20", timeText: "2H 72'", scoreText: "2-1"
    });
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [{ ...event, iscyb: true }] })).toEqual([]);
    expect(extractImFootballCatalog({ StatusCode: 500, sel: [event] })).toEqual([]);
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [{ ...event, htn: "" }] })).toEqual([]);
  });

  it("applies exact delta prices and retains an integer-line market for inventory", () => {
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    const updated = mergeImFootballDelta(initial, { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [
      { mi: 10, bti: 1, gp: 1, ws: [
        { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8, ot: 1 },
        { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9, ot: 1 }
      ] }
    ] }] });
    expect(updated[0]?.markets.find((item) => item.marketId === "10")?.selections
      .map((item) => item.priceText)).toEqual(["0.8", "-0.9"]);

    const withInteger = mergeImFootballDelta(updated, { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [
      { mi: 10, bti: 1, gp: 1, ws: [
        { wsi: 101, si: 1, hdp: -1, dih: "+1", o: 0.8, ot: 1 },
        { wsi: 102, si: 2, hdp: -1, dih: "-1", o: -0.9, ot: 1 }
      ] }
    ] }] });
    expect(withInteger).toHaveLength(1);
    expect(withInteger[0]?.markets.find((item) => item.marketId === "10"))
      .toEqual(expect.objectContaining({ marketType: "FT_AH" }));
  });

  it("keeps an existing event on metadata action 2 and deletes it only on action 1", () => {
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    expect(mergeImFootballDelta(initial, { StatusCode: 100, dc: [{
      eid: 112516390, a: 2, v: { htn: "Monterrey Rayados", atn: "Nashville SC" }
    }] })).toEqual(initial);
    expect(mergeImFootballDelta(initial, { StatusCode: 100, dc: [{ eid: 112516390, a: 1, v: null }] }))
      .toEqual([]);
  });

  it("deduplicates an event crossing live and prematch snapshot groups", () => {
    const first = extractImFootballCatalog({ StatusCode: 100, sel: [event] })[0]!;
    const replacement = { ...first, markets: [{ ...first.markets[0]!, marketId: "another-market" }] };
    expect(mergeImFootballSnapshots([[first], [replacement]])).toEqual([{
      ...replacement,
      markets: [...first.markets, replacement.markets[0]]
    }]);
  });
});
