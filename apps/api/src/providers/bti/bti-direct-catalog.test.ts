import { describe, expect, it } from "vitest";
import { extractBtiCatalogRecords } from "./bti-direct-catalog.js";

const selection = (id: string, side: 1 | 3, line: number, malay: string, locked = false) =>
  [id, { VI: "team" }, { VI: "team line" }, locked, false, 1.9, ["", "1.90", "", "", "", malay], side, 2, {}, "", "event", "market", line];
const market = (id: string, code: "HC39" | "OU39", selections: unknown[]) =>
  [id, "Cược trực tiếp", "Cược trực tiếp", [code, "full time", 1], "event", "league", "1", selections];

describe("BTI direct catalog", () => {
  it("extracts exact live full-time half-lines and public provider IDs", () => {
    const payload = { serializedData: [["league", "Champions League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event-1", [["home-id", { VI: "NEC Nijmegen" }, "Home"], ["away-id", { VI: "Olympiakos" }, "Away"]],
      "NEC vs Olympiakos", "2026-08-11T17:30:00Z", ["1", "0"], true, false, [], ["event-1", 0, [], [
        market("hc-real", "HC39", [selection("home-real", 1, -0.5, "0.82"), selection("away-real", 3, 0.5, "-0.92")]),
        market("ou-real", "OU39", [selection("over-real", 1, 2.5, "0.90"), selection("under-real", 3, 2.5, "-0.99")]),
        market("quarter", "HC39", [selection("q-home", 1, -0.25, "0.80"), selection("q-away", 3, 0.25, "-0.90")])
      ]]
    ]], "Bóng đá"]] };
    expect(extractBtiCatalogRecords(payload)).toEqual([expect.objectContaining({
      eventId: "event-1", leagueName: "Champions League", teamNames: ["NEC Nijmegen", "Olympiakos"], scoreText: "1 - 0",
      markets: [
        expect.objectContaining({ marketId: "hc-real:-0.5", marketType: "FT_AH", lineText: "-0.5",
          selections: [expect.objectContaining({ selectionId: "home-real", priceText: "0.82" }), expect.objectContaining({ selectionId: "away-real", priceText: "-0.92" })] }),
        expect.objectContaining({ marketId: "ou-real:2.5", marketType: "FT_TOTAL", lineText: "2.5" })
      ]
    })]);
  });

  it("fails closed for prematch, malformed, and three-way data", () => {
    expect(extractBtiCatalogRecords({ serializedData: [["id", "League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event", [["h", { VI: "A" }], ["a", { VI: "B" }]], "A vs B", "", ["0", "0"], false, false, [], []
    ]]]]})).toEqual([]);
    expect(extractBtiCatalogRecords({ serializedData: "private-canary" })).toEqual([]);
  });
});
