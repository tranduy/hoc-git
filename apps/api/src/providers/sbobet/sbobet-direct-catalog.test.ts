import { describe, expect, it } from "vitest";
import { extractSbobetDirectCatalogRecords } from "./sbobet-direct-catalog.js";

const fallback = [{
  eventId: "5574638", leagueName: "Champions League", timeText: "1H 29'", scoreText: "0 - 1",
  teamNames: ["Kairat", "Levski"], markets: []
}];

describe("extractSbobetDirectCatalogRecords", () => {
  it("reads exact two-outcome half-goal markets and provider IDs from getEvent", () => {
    const body = [{ "8": 5574638, "0": "2026-08-11T15:00:00Z", "2": "Kairat", "3": "Levski", "7": {
      "1": ["7.5*55746380010000000h 1.51*55746380010000000a 3.56*55746380010000000d 73007850811000"],
      "3": ["2.5 0.93*55746380030002005h -0.91*55746380030002005a 730078508181025 0 0"],
      "5": ["0.5 -0.91*55746380050009905h 0.79*55746380050009905a h 730078508161105 0 0"]
    } }];
    const [record] = extractSbobetDirectCatalogRecords(body, fallback);
    expect(record?.markets).toEqual([
      { marketId: "730078508181025", marketType: "FT_TOTAL", lineText: "2.5", selections: [
        { selectionId: "55746380030002005h", selection: "OVER", priceText: "0.93", locked: false },
        { selectionId: "55746380030002005a", selection: "UNDER", priceText: "-0.91", locked: false }
      ] },
      { marketId: "730078508161105", marketType: "FT_AH", lineText: null, selections: [
        { selectionId: "55746380050009905h", selection: "HOME", priceText: "-0.91", locked: false, lineText: "0.5" },
        { selectionId: "55746380050009905a", selection: "AWAY", priceText: "0.79", locked: false, lineText: null }
      ] }
    ]);
  });

  it("rejects quarter lines, zero odds, three-way markets, and events absent from the live DOM", () => {
    const body = [{ "8": 5574638, "2": "A", "3": "B", "7": {
      "3": ["2.25 0.93*1h 0.93*1a 12345"], "5": ["0.5 0*1h 0.8*1a h 12345"]
    } }, { "8": 999, "2": "X", "3": "Y", "7": { "5": ["0.5 0.8*1h -0.9*1a h 12345"] } }];
    expect(extractSbobetDirectCatalogRecords(body, fallback)).toEqual([]);
  });
});
