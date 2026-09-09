import { describe, expect, it } from "vitest";
import { extractBtiCatalogRecords, extractBtiNativeMarketObservations } from "./bti-direct-catalog.js";

const selection = (id: string, side: 1 | 3, line: number, malay: string, locked = false) =>
  [id, { VI: "team" }, { VI: "team line" }, locked, false, 1.9, ["", "1.90", "", "", "", malay], side, 2, {}, "", "event", "market", line];
const market = (id: string, code: "HC39" | "HC0" | "HC1" | "OU39" | "OU0" | "OU1" | "ML39" | "ML1", selections: unknown[]) =>
  [id, "Cược trực tiếp", "Cược trực tiếp", [code, code === "OU1" ? "first half" : "full time", 1],
    "event", "league", "1", selections];

describe("BTI direct catalog", () => {
  it("extracts proven two-outcome markets from an event-page detail response", () => {
    const detailSelection = (id: string, side: number, points: number | null, malay: string, displayName?: string) => {
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
      detailMarket("corner-ft-ah", "HC619", [detailSelection("corner-home", 1, -0.5, "0.77"),
        detailSelection("corner-away", 3, 0.5, "-0.87")], "Corners Asian Handicap"),
      detailMarket("corner-fh-ou", "OU14", [detailSelection("corner-over", 1, 4.5, "0.78"),
        detailSelection("corner-under", 3, 4.5, "-0.88")], "First Half Corners Total"),
      detailMarket("card-ft-ou", "OU10", [detailSelection("card-over", 1, 3.5, "0.79"),
        detailSelection("card-under", 3, 3.5, "-0.89")], "Cards Over Under"),
      detailMarket("card-fh-ah", "BTI-CARD-1H", [detailSelection("card-home", 1, -0.5, "0.80"),
        detailSelection("card-away", 3, 0.5, "-0.90")], "First Half Bookings Handicap"),
      detailMarket("second-half-ou", "OU2", [detailSelection("sh-over", 1, 1.5, "0.81"),
        detailSelection("sh-under", 3, 1.5, "-0.91")], "Second Half Total"),
      detailMarket("odd-even", "QA38", [detailSelection("odd", 7, null, "0.81", "Lẻ"),
        detailSelection("even", 8, null, "-0.91", "Chẵn")], "Lẻ/Chẵn"),
      detailMarket("btts", "QA158", [detailSelection("yes", 9, null, "0.81", "Có"),
        detailSelection("no", 10, null, "-0.91", "Không")], "Cả 2 đội đều ghi bàn"),
      detailMarket("fh-btts", "QA2934", [detailSelection("fh-yes", 9, null, "0.81", "Có"),
        detailSelection("fh-no", 10, null, "-0.91", "Không")], "Cả 2 đội ghi bàn hiệp 1"),
      detailMarket("sh-btts", "QA2936", [detailSelection("sh-yes", 9, null, "0.81", "Có"),
        detailSelection("sh-no", 10, null, "-0.91", "Không")], "Cả 2 đội ghi bàn hiệp 2"),
      detailMarket("corner-odd-even", "QA616", [detailSelection("corner-odd", 7, null, "0.81", "Lẻ"),
        detailSelection("corner-even", 8, null, "-0.91", "Chẵn")], "Cược Chẵn/Lẻ số quả phạt góc"),
      detailMarket("sending-off", "QA4409", [detailSelection("red-yes", 9, null, "0.81", "Có"),
        detailSelection("red-no", 10, null, "-0.91", "Không")], "Có thẻ đỏ / Truất quyền thi đấu"),
      detailMarket("home-clean-sheet", "QA272", [detailSelection("home-clean-yes", 9, null, "0.81", "Yes"),
        detailSelection("home-clean-no", 10, null, "-0.91", "No")], "Alpha: Team clean sheet"),
      detailMarket("away-win-both-halves", "QA6095", [detailSelection("away-both-yes", 9, null, "0.81", "Yes"),
        detailSelection("away-both-no", 10, null, "-0.91", "No")], "Beta: Team to win both halves"),
      detailMarket("home-win-to-nil", "QA5185", [detailSelection("home-nil-yes", 9, null, "0.81", "Yes"),
        detailSelection("home-nil-no", 10, null, "-0.91", "No")], "Alpha: Win to nil"),
      detailMarket("away-to-win", "QA6078", [detailSelection("away-win-yes", 9, null, "0.81", "Yes"),
        detailSelection("away-win-no", 10, null, "-0.91", "No")], "Beta: Team to win match"),
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
        expect.objectContaining({ marketId: "second-half-ou:1.5", marketType: "SH_TOTAL" }),
        expect.objectContaining({ marketId: "odd-even", marketType: "FT_ODD_EVEN", lineText: null }),
        expect.objectContaining({ marketId: "btts", marketType: "FT_BTTS", lineText: null }),
        expect.objectContaining({ marketId: "fh-btts", marketType: "FH_BTTS", lineText: null }),
        expect.objectContaining({ marketId: "sh-btts", marketType: "SH_BTTS", lineText: null }),
        expect.objectContaining({ marketId: "corner-odd-even", marketType: "CORNER_FT_ODD_EVEN", lineText: null }),
        expect.objectContaining({ marketId: "sending-off", marketType: "SENDING_OFF", lineText: null }),
        expect.objectContaining({ marketId: "home-clean-sheet", marketType: "HOME_FT_CLEAN_SHEET", lineText: null }),
        expect.objectContaining({ marketId: "away-win-both-halves", marketType: "AWAY_FT_WIN_BOTH_HALVES", lineText: null }),
        expect.objectContaining({ marketId: "home-win-to-nil", marketType: "HOME_FT_WIN_TO_NIL", lineText: null }),
        expect.objectContaining({ marketId: "away-to-win", marketType: "AWAY_FT_TO_WIN", lineText: null }),
        expect.objectContaining({ marketId: "detail-1x2", marketType: "FT_1X2", lineText: null })]
    })]);
    const extracted = extractBtiCatalogRecords({ data: [event] })[0]!.markets;
    expect(extractBtiNativeMarketObservations({ data: [event] }, 123)).toContainEqual(
      expect.objectContaining({ providerMarketId: "card-fh-ah", nativeType: "BTI-CARD-1H", disposition: "UNMAPPED" })
    );
    expect(extracted.some(({ marketId }) => marketId.includes("ambiguous-total") || marketId.includes("swapped-handicap")))
      .toBe(false);
  });

  it("extracts BTI's hidden alternate goal totals but excludes unsupported handicap families", () => {
    const detailSelection = (id: string, name: string, side: 1 | 3, points: number, malay: string) => {
      const value = Array<unknown>(30).fill(null);
      value[0] = id;
      value[2] = { VI: name };
      value[5] = false;
      value[8] = ["", "1.90", "", "", "", malay];
      value[9] = side;
      value[13] = false;
      value[16] = points;
      return value;
    };
    const detailMarket = (id: string, code: string, label: string, selections: unknown[]) => {
      const value = Array<unknown>(30).fill(null);
      value[0] = id;
      value[1] = label;
      value[5] = [code, label];
      value[13] = selections;
      value[15] = false;
      value[23] = false;
      return value;
    };
    const event = Array<unknown>(39).fill(null);
    event[0] = "hidden-event";
    event[2] = "Hidden League";
    event[8] = [["home", { VI: "Alpha" }], ["away", { VI: "Beta" }]];
    event[11] = "2026-08-19T00:15:00.000Z";
    event[13] = false;
    event[20] = [
      detailMarket("draw-no-bet", "HC157", "Hòa được hoàn tiền", [
        detailSelection("dnb-home", "Alpha", 1, 0, "-0.51"),
        detailSelection("dnb-away", "Beta", 3, 0, "0.31")
      ]),
      detailMarket("alternate-total", "OU249", "Cược Tài/Xỉu tổng số bàn thắng", [
        detailSelection("alt-over", "Tài", 1, 2.5, "0.30"),
        detailSelection("alt-under", "Xỉu", 3, 2.5, "-0.46")
      ]),
      detailMarket("first-half-alternate-total", "OU201", "Cược Tài/Xỉu tổng số bàn thắng hiệp 1", [
        detailSelection("fh-alt-over", "Tài", 1, 1.5, "-0.65"),
        detailSelection("fh-alt-under", "Xỉu", 3, 1.5, "0.45")
      ]),
      detailMarket("european-handicap", "HC2220", "Kèo cược chấp châu Âu thay thế", [
        detailSelection("eu-home", "Alpha", 1, 1.5, "-0.45"),
        detailSelection("eu-away", "Beta", 3, -1.5, "0.26")
      ])
    ];

    const markets = extractBtiCatalogRecords({ data: [event] })[0]!.markets;
    expect(markets).toEqual([
      expect.objectContaining({ marketId: "alternate-total:2.5", marketType: "FT_TOTAL", lineText: "2.5" }),
      expect.objectContaining({ marketId: "first-half-alternate-total:1.5", marketType: "FH_TOTAL", lineText: "1.5" })
    ]);
    expect(markets.some(({ marketId }) => marketId.startsWith("draw-no-bet:"))).toBe(false);
    expect(markets.some(({ marketId }) => marketId.startsWith("european-handicap:"))).toBe(false);
  });

  it("does not relabel three-way or unrelated stat markets as canonical two-way football lines", () => {
    const detailSelection = (id: string, name: string, side: 1 | 3, points: number, malay: string) => {
      const value = Array<unknown>(30).fill(null);
      value[0] = id; value[2] = { VI: name }; value[5] = false;
      value[8] = ["", "1.90", "", "", "", malay]; value[9] = side;
      value[13] = false; value[16] = points;
      return value;
    };
    const detailMarket = (id: string, code: string, label: string, selections: unknown[]) => {
      const value = Array<unknown>(30).fill(null);
      value[0] = id; value[1] = label; value[5] = [code, label]; value[13] = selections;
      return value;
    };
    const pair = (prefix: string, points: number) => [
      detailSelection(`${prefix}-over`, "Tài", 1, points, "0.81"),
      detailSelection(`${prefix}-under`, "Xỉu", 3, points, "-0.91")
    ];
    const event = Array<unknown>(39).fill(null);
    event[0] = "strict-event"; event[2] = "Strict League";
    event[8] = [["home", { VI: "Alpha" }], ["away", { VI: "Beta" }]];
    event[11] = "2026-09-07T12:00:00.000Z"; event[13] = false;
    event[20] = [
      detailMarket("goal-total", "OU200", "Cược Tài/Xỉu tổng số bàn thắng", pair("goal", 2.5)),
      detailMarket("three-way-ah", "HC270", "Cược chấp 3 chiều", pair("three-way-ah", 0.5)),
      detailMarket("three-way-corner", "OU621", "Cược Tài/Xỉu số quả phạt góc 3 chiều",
        pair("three-way-corner", 9.5)),
      detailMarket("team-goal", "OU7", "Alpha: Cược Tài/Xỉu tổng số bàn thắng của đội",
        pair("team-goal", 1.5)),
      detailMarket("team-fh-goal", "OU257", "Alpha: Cược Tài/Xỉu tổng số bàn thắng của đội hiệp 1",
        pair("team-fh-goal", 0.5)),
      detailMarket("shots", "OU2083", "Cược Tài/Xỉu tổng số lần sút trong trận đấu",
        pair("shots", 20.5))
    ];

    const markets = extractBtiCatalogRecords({ data: [event] })[0]!.markets;
    expect(markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ marketId: "goal-total:2.5", marketType: "FT_TOTAL" }),
      expect.objectContaining({ marketId: "team-goal:1.5", marketType: "HOME_FT_TOTAL" }),
      expect.objectContaining({ marketId: "team-fh-goal:0.5", marketType: "HOME_FH_TOTAL" })
    ]));
    expect(markets.filter(({ marketId }) => /^(?:three-way-ah|three-way-corner|shots):/u.test(marketId))).toEqual([]);

    const observations = extractBtiNativeMarketObservations({ data: [event] }, 123);
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "three-way-ah", disposition: "EXCLUDED",
        reason: "THREE_WAY_OUTCOME_DOMAIN" }),
      expect.objectContaining({ providerMarketId: "three-way-corner", disposition: "EXCLUDED",
        reason: "THREE_WAY_OUTCOME_DOMAIN" }),
      expect.objectContaining({ providerMarketId: "team-fh-goal:0.5", disposition: "NORMALIZED", nativeScope: "FIRST_HALF" }),
      expect.objectContaining({ providerMarketId: "shots", disposition: "UNMAPPED" })
    ]));
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

  it("accounts for every detail market as normalized, excluded, or unmapped", () => {
    const detailSelection = (id: string, side: 1 | 3, points: number, malay: string, name: string) => {
      const value: unknown[] = [];
      value[0] = id; value[2] = { EN: name }; value[5] = false;
      value[8] = ["", "1.9", "", "", "", malay]; value[9] = side;
      value[13] = false; value[16] = points;
      return value;
    };
    const detailMarket = (id: string, code: string, label: string, selections: unknown[]) => {
      const value: unknown[] = [];
      value[0] = id; value[1] = label; value[5] = [code, label]; value[13] = selections;
      return value;
    };
    const event: unknown[] = [];
    event[0] = "event-detail"; event[2] = "Detail League";
    event[8] = [["a", { EN: "Alpha" }], ["b", { EN: "Beta" }]];
    event[11] = "2026-09-07T12:00:00.000Z"; event[13] = false;
    event[20] = [
      detailMarket("known", "OU0", "Total", [detailSelection("o", 1, 2.5, "0.8", "Over"),
        detailSelection("u", 3, 2.5, "-0.9", "Under")]),
      detailMarket("refund", "HC157", "Draw no bet", [detailSelection("h", 1, 0, "0.8", "Alpha"),
        detailSelection("a", 3, 0, "-0.9", "Beta")]),
      Object.assign(detailMarket("closed", "OU0", "Total", [detailSelection("co", 1, 3.5, "0.8", "Over"),
        detailSelection("cu", 3, 3.5, "-0.9", "Under")]), { 15: true }),
      detailMarket("unknown", "ZZ999", "Mystery yes no", [detailSelection("y", 1, 0, "0.8", "Yes"),
        detailSelection("n", 3, 0, "-0.9", "No")])
    ];

    expect(extractBtiNativeMarketObservations({ data: [event] }, 123)).toEqual([
      expect.objectContaining({ providerMarketId: "known:2.5", disposition: "NORMALIZED" }),
      expect.objectContaining({ providerMarketId: "refund", disposition: "EXCLUDED",
        reason: "PUSH_OR_REFUND_SETTLEMENT" }),
      expect.objectContaining({ providerMarketId: "closed", disposition: "EXCLUDED",
        reason: "MARKET_CLOSED" }),
      expect.objectContaining({ providerMarketId: "unknown", disposition: "UNMAPPED",
        reason: "NATIVE_TYPE_UNMAPPED" })
    ]);
  });

  it("retains a structurally valid roster event while its supported markets are still hidden", () => {
    const payload = { serializedData: [["id", "League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event-hidden", [["h", { VN: "A" }, ""], ["a", { VN: "B" }, ""]], "", "2026-09-07T00:15:00.000Z",
      ["", "", null, {}], false, false, [false, 0, null, null, null], ["event-hidden", 0, [], []]
    ]]]] };

    expect(extractBtiCatalogRecords(payload)).toEqual([expect.objectContaining({
      eventId: "event-hidden", teamNames: ["A", "B"], markets: []
    })]);
  });

  it("fails closed for malformed data", () => {
    expect(extractBtiCatalogRecords({ serializedData: [["id", "League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event", [["h", { VI: "A" }], ["a", { VI: "B" }]], "A vs B", "", ["0", "0"], false, false, [], []
    ]]]]})).toEqual([]);
    expect(extractBtiCatalogRecords({ serializedData: "private-canary" })).toEqual([]);
  });
});
