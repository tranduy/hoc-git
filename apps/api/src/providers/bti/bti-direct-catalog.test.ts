import { describe, expect, it } from "vitest";
import { extractBtiCatalogRecords } from "./bti-direct-catalog.js";

const selection = (id: string, side: 1 | 3, line: number, malay: string, locked = false) =>
  [id, { VI: "team" }, { VI: "team line" }, locked, false, 1.9, ["", "1.90", "", "", "", malay], side, 2, {}, "", "event", "market", line];
const market = (id: string, code: "HC39" | "HC0" | "HC1" | "OU39" | "OU0" | "OU1" | "ML39" | "ML1", selections: unknown[]) =>
  [id, "Cược trực tiếp", "Cược trực tiếp", [code, code === "OU1" ? "first half" : "full time", 1],
    "event", "league", "1", selections];

describe("BTI direct catalog", () => {
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
