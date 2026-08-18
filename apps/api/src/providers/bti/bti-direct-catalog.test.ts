import { describe, expect, it } from "vitest";
import { extractBtiCatalogRecords } from "./bti-direct-catalog.js";

const selection = (id: string, side: 1 | 3, line: number, malay: string, locked = false) =>
  [id, { VI: "team" }, { VI: "team line" }, locked, false, 1.9, ["", "1.90", "", "", "", malay], side, 2, {}, "", "event", "market", line];
const market = (id: string, code: "HC39" | "HC0" | "HC1" | "OU39" | "OU0" | "OU1" | "ML39" | "ML1", selections: unknown[]) =>
  [id, "Cược trực tiếp", "Cược trực tiếp", [code, code === "OU1" ? "first half" : "full time", 1],
    "event", "league", "1", selections];

describe("BTI direct catalog", () => {
  it("extracts proven two-outcome markets from an event-page detail response", () => {
    const detailSelection = (id: string, side: 1 | 3, points: number, malay: string, displayName?: string) => {
      const value = Array<unknown>(30).fill(null);
      value[0] = id;
      const name = displayName ?? (id.includes("over") ? "Over" : id.includes("under") ? "Under" :
        side === 1 ? "Alpha" : "Beta");
      value[2] = { VI: name };
      value[5] = false;
      value[6] = 1.9;
      value[8] = ["", "1.90", "", "", "", malay];
      value[9] = side;
      value[12] = "market-detail";
      value[13] = false;
      value[15] = "event-detail";
      value[16] = points;
      return value;
    };
    const detailMarket = (id: string, code: string, selections: unknown[], label = code) => {
      const value = Array<unknown>(30).fill(null);
      value[0] = id;
      value[1] = label;
      value[5] = [code, label];
      value[6] = "event-detail";
      value[7] = "league-detail";
      value[8] = "1";
      value[13] = selections;
      value[14] = false;
      value[15] = false;
      return value;
    };
    const event = Array<unknown>(39).fill(null);
    event[0] = "event-detail";
    event[1] = "league-detail";
    event[2] = "Detail League";
    event[3] = "1";
    event[4] = "Football";
    event[8] = [["home", { VI: "Alpha" }, "Home"], ["away", { VI: "Beta" }, "Away"]];
    event[10] = "Alpha vs Beta";
    event[11] = "2026-08-19T00:15:00.000Z";
    event[13] = false;
    event[20] = [
      detailMarket("detail-hc", "HC0", [detailSelection("detail-home", 1, -0.75, "0.82"),
        detailSelection("detail-away", 3, 0.75, "-0.92")]),
      detailMarket("detail-ou", "OU0", [detailSelection("detail-over", 1, 2.75, "0.90"),
        detailSelection("detail-under", 3, 2.75, "-0.99")]),
      detailMarket("corner-ft-ah", "BTI-CORNER", [detailSelection("corner-home", 1, -0.5, "0.77"),
        detailSelection("corner-away", 3, 0.5, "-0.87")], "Corners Asian Handicap"),
      detailMarket("corner-fh-ou", "BTI-CORNER-1H", [detailSelection("corner-over", 1, 4.5, "0.78"),
        detailSelection("corner-under", 3, 4.5, "-0.88")], "First Half Corners Total"),
      detailMarket("card-ft-ou", "BTI-CARD", [detailSelection("card-over", 1, 3.5, "0.79"),
        detailSelection("card-under", 3, 3.5, "-0.89")], "Cards Over Under"),
      detailMarket("card-fh-ah", "BTI-CARD-1H", [detailSelection("card-home", 1, -0.5, "0.80"),
        detailSelection("card-away", 3, 0.5, "-0.90")], "First Half Bookings Handicap"),
      detailMarket("second-half-ou", "BTI-2H", [detailSelection("sh-over", 1, 1.5, "0.81"),
        detailSelection("sh-under", 3, 1.5, "-0.91")], "Second Half Total"),
      detailMarket("ambiguous-total", "BTI-OTHER", [detailSelection("yes", 1, 2.5, "0.81", "Yes"),
        detailSelection("no", 3, 2.5, "-0.91", "No")], "Total"),
      detailMarket("swapped-handicap", "BTI-HC", [detailSelection("wrong-home", 1, -0.5, "0.81", "Beta"),
        detailSelection("wrong-away", 3, 0.5, "-0.91", "Alpha")], "Asian Handicap"),
      detailMarket("detail-1x2", "ML0", [detailSelection("detail-ml-home", 1, 0, "0.75"),
        detailSelection("detail-ml-away", 3, 0, "-0.85")]),
      detailMarket("detail-score", "CS0", [detailSelection("detail-score-a", 1, 0.5, "0.70"),
        detailSelection("detail-score-b", 3, -0.5, "-0.80")])
    ];

    expect(extractBtiCatalogRecords({ data: [event] })).toEqual([expect.objectContaining({
      eventId: "event-detail", leagueName: "Detail League", teamNames: ["Alpha", "Beta"],
      markets: [expect.objectContaining({ marketId: "detail-hc:-0.75", marketType: "FT_AH" }),
        expect.objectContaining({ marketId: "detail-ou:2.75", marketType: "FT_TOTAL" }),
        expect.objectContaining({ marketId: "corner-ft-ah:-0.5", marketType: "CORNER_FT_AH" }),
        expect.objectContaining({ marketId: "corner-fh-ou:4.5", marketType: "CORNER_FH_TOTAL" }),
        expect.objectContaining({ marketId: "card-ft-ou:3.5", marketType: "CARD_FT_TOTAL" }),
        expect.objectContaining({ marketId: "card-fh-ah:-0.5", marketType: "CARD_FH_AH" }),
        expect.objectContaining({ marketId: "second-half-ou:1.5", marketType: "SH_TOTAL" })]
    })]);
    const extracted = extractBtiCatalogRecords({ data: [event] })[0]!.markets;
    expect(extracted.some(({ marketId }) => marketId.includes("ambiguous-total") || marketId.includes("swapped-handicap")))
      .toBe(false);
  });

  it("extracts exact live full-time half-lines and public provider IDs", () => {
    const payload = { serializedData: [["league", "Champions League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event-1", [["home-id", { VI: "NEC Nijmegen" }, "Home"], ["away-id", { VI: "Olympiakos" }, "Away"]],
      "NEC vs Olympiakos", "2026-08-11T17:30:00Z", ["1", "0"], true, false, [], ["event-1", 0, [], [
        market("hc-real", "HC39", [selection("home-real", 1, -0.5, "0.82"), selection("away-real", 3, 0.5, "-0.92")]),
        market("ou-real", "OU39", [selection("over-real", 1, 2.5, "0.90"), selection("under-real", 3, 2.5, "-0.99")]),
        market("quarter", "HC39", [selection("q-home", 1, -0.25, "0.80"), selection("q-away", 3, 0.25, "-0.90")]),
        market("fh-quarter", "OU1", [selection("fh-over", 1, 1.75, "0.78"), selection("fh-under", 3, 1.75, "-0.88")]),
        market("fh-handicap", "HC1", [selection("fh-home", 1, -0.25, "0.76"), selection("fh-away", 3, 0.25, "-0.86")]),
        market("three-way-full-time", "ML39", [selection("ml-home", 1, 0, "0.76"), selection("ml-away", 3, 0, "-0.86")]),
        market("three-way-first-half", "ML1", [selection("fh-ml-home", 1, 0, "0.74"), selection("fh-ml-away", 3, 0, "-0.84")])
      ]]
    ]], "Bóng đá"]] };
    expect(extractBtiCatalogRecords(payload)).toEqual([expect.objectContaining({
      eventId: "event-1", leagueName: "Champions League", teamNames: ["NEC Nijmegen", "Olympiakos"], scoreText: "1 - 0",
      markets: [
        expect.objectContaining({ marketId: "hc-real:-0.5", marketType: "FT_AH", lineText: "-0.5",
          selections: [expect.objectContaining({ selectionId: "home-real", priceText: "0.82" }), expect.objectContaining({ selectionId: "away-real", priceText: "-0.92" })] }),
        expect.objectContaining({ marketId: "ou-real:2.5", marketType: "FT_TOTAL", lineText: "2.5" }),
        expect.objectContaining({ marketId: "quarter:-0.25", marketType: "FT_AH", lineText: "-0.25" }),
        expect.objectContaining({ marketId: "fh-quarter:1.75", marketType: "FH_TOTAL", lineText: "1.75" }),
        expect.objectContaining({ marketId: "fh-handicap:-0.25", marketType: "FH_AH", lineText: "-0.25",
          selections: [expect.objectContaining({ selectionId: "fh-home" }), expect.objectContaining({ selectionId: "fh-away" })] })
      ]
    })]);
    const markets = extractBtiCatalogRecords(payload)[0]!.markets;
    expect(markets.some(({ marketId }) => marketId.includes("three-way"))).toBe(false);
  });

  it("extracts exact prematch HC0/OU0 markets with their scheduled start", () => {
    const payload = { serializedData: [["id", "League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event-p", [["h", { VI: "A" }], ["a", { VI: "B" }]], "A vs B", "2026-08-19T00:15:00.000Z",
      ["", "", null, {}], false, false, [false, 0, null, null, null], ["event-p", 0, [], [
        market("hc-p", "HC0", [selection("home-p", 1, -0.75, "0.82"), selection("away-p", 3, 0.75, "-0.92")]),
        market("ou-p", "OU0", [selection("over-p", 1, 2.75, "0.90"), selection("under-p", 3, 2.75, "-0.99")])
      ]]
    ]]]]} ;
    expect(extractBtiCatalogRecords(payload)).toEqual([expect.objectContaining({
      eventId: "event-p", timeText: "PREMATCH", scoreText: null,
      startAtUtcMs: Date.parse("2026-08-19T00:15:00.000Z"),
      markets: [expect.objectContaining({ marketType: "FT_AH", lineText: "-0.75" }),
        expect.objectContaining({ marketType: "FT_TOTAL", lineText: "2.75" })]
    })]);
  });

  it("fails closed for malformed and three-way-only data", () => {
    expect(extractBtiCatalogRecords({ serializedData: [["id", "League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event", [["h", { VI: "A" }], ["a", { VI: "B" }]], "A vs B", "", ["0", "0"], false, false, [], []
    ]]]]})).toEqual([]);
    expect(extractBtiCatalogRecords({ serializedData: "private-canary" })).toEqual([]);
  });
});
