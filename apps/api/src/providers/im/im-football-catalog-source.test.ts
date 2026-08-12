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
  it("extracts only exact full-time half-goal two-way handicap tickets", () => {
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [event] })).toEqual([{
      eventId: "112516390", leagueName: "Leagues Cup", timeText: "PREMATCH", scoreText: null,
      startAtUtcMs: Date.parse("2026-08-12T20:00:00-04:00"),
      teamNames: ["Monterrey Rayados", "Nashville SC"],
      markets: [{ marketId: "10", marketType: "FT_AH", lineText: null, selections: [
        { selectionId: "101", selection: "HOME", priceText: "0.67", locked: false, lineText: "+0.5" },
        { selectionId: "102", selection: "AWAY", priceText: "-0.79", locked: false, lineText: "-0.5" }
      ] }]
    }]);
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

  it("applies exact delta prices and removes a ticket when its line stops being half-goal", () => {
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    const updated = mergeImFootballDelta(initial, { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [
      { mi: 10, bti: 1, gp: 1, ws: [
        { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8, ot: 1 },
        { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9, ot: 1 }
      ] }
    ] }] });
    expect(updated[0]?.markets[0]?.selections.map((item) => item.priceText)).toEqual(["0.8", "-0.9"]);

    expect(mergeImFootballDelta(updated, { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [
      { mi: 10, bti: 1, gp: 1, ws: [
        { wsi: 101, si: 1, hdp: -0.25, dih: "+0/0.5", o: 0.8, ot: 1 },
        { wsi: 102, si: 2, hdp: -0.25, dih: "-0/0.5", o: -0.9, ot: 1 }
      ] }
    ] }] })).toEqual([]);
  });

  it("deduplicates an event crossing live and prematch snapshot groups", () => {
    const first = extractImFootballCatalog({ StatusCode: 100, sel: [event] })[0]!;
    const replacement = { ...first, markets: [{ ...first.markets[0]!, marketId: "another-market" }] };
    expect(mergeImFootballSnapshots([[first], [replacement]])).toEqual([{
      ...replacement,
      markets: [first.markets[0], replacement.markets[0]]
    }]);
  });
});
