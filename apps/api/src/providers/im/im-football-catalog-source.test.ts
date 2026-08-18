import { describe, expect, it } from "vitest";
import { extractImFootballCatalog, mergeImFootballDelta,
  mergeImFootballSnapshots } from "./im-football-catalog-source.js";

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

  it("applies exact delta prices and removes a ticket when its line becomes integer", () => {
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    const updated = mergeImFootballDelta(initial, { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [
      { mi: 10, bti: 1, gp: 1, ws: [
        { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8, ot: 1 },
        { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9, ot: 1 }
      ] }
    ] }] });
    expect(updated[0]?.markets.find((item) => item.marketId === "10")?.selections
      .map((item) => item.priceText)).toEqual(["0.8", "-0.9"]);

    const withoutInteger = mergeImFootballDelta(updated, { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [
      { mi: 10, bti: 1, gp: 1, ws: [
        { wsi: 101, si: 1, hdp: -1, dih: "+1", o: 0.8, ot: 1 },
        { wsi: 102, si: 2, hdp: -1, dih: "-1", o: -0.9, ot: 1 }
      ] }
    ] }] });
    expect(withoutInteger).toHaveLength(1);
    expect(withoutInteger[0]?.markets.some((item) => item.marketId === "10")).toBe(false);
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
