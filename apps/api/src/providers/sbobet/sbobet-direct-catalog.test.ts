import { describe, expect, it } from "vitest";
import {
  extractSbobetDirectCatalogRecords,
  inspectSbobetMarketGroups,
  inspectSbobetMarketLabelEvidence
} from "./sbobet-direct-catalog.js";

const fallback = [{
  eventId: "5574638", leagueName: "Champions League", timeText: "1H 29'", scoreText: "0 - 1",
  teamNames: ["Kairat", "Levski"], markets: []
}];

describe("extractSbobetDirectCatalogRecords", () => {
  it("reads exact two-outcome half-goal markets and provider IDs from getEvent", () => {
    const body = [{ "8": 5574638, "0": "2026-08-11T15:00:00Z", "2": "Kairat", "3": "Levski", "7": {
      "1": ["7.5*55746380010000000h 1.51*55746380010000000a 3.56*55746380010000000d 73007850811000"],
      "3": ["2.5 0.93*55746380030002005h -0.91*55746380030002005a 730078508181025 0 0"],
      "4": ["1.5 0.82*55746380040001005h -0.96*55746380040001005a 730078508181015 0 0"],
      "5": ["0.5 -0.91*55746380050009905h 0.79*55746380050009905a h 730078508161105 0 0"],
      "6": ["0.5 0.72*55746380060009905h -0.88*55746380060009905a a 730078508261105 0 0"]
    } }];
    const [record] = extractSbobetDirectCatalogRecords(body, fallback);
    expect(record?.markets).toEqual(expect.arrayContaining([
      { marketId: "730078508181025", marketType: "FT_TOTAL", lineText: "2.5", selections: [
        { selectionId: "55746380030002005h", selection: "OVER", priceText: "0.93", locked: false },
        { selectionId: "55746380030002005a", selection: "UNDER", priceText: "-0.91", locked: false }
      ] },
      { marketId: "730078508161105", marketType: "FT_AH", lineText: null, selections: [
        { selectionId: "55746380050009905h", selection: "HOME", priceText: "-0.91", locked: false, lineText: "0.5" },
        { selectionId: "55746380050009905a", selection: "AWAY", priceText: "0.79", locked: false, lineText: null }
      ] },
      { marketId: "730078508181015", marketType: "FH_TOTAL", lineText: "1.5", selections: [
        { selectionId: "55746380040001005h", selection: "OVER", priceText: "0.82", locked: false },
        { selectionId: "55746380040001005a", selection: "UNDER", priceText: "-0.96", locked: false }
      ] },
      { marketId: "730078508261105", marketType: "FH_AH", lineText: null, selections: [
        { selectionId: "55746380060009905h", selection: "HOME", priceText: "0.72", locked: false, lineText: null },
        { selectionId: "55746380060009905a", selection: "AWAY", priceText: "-0.88", locked: false, lineText: "0.5" }
      ] }
    ]));
    expect(record?.markets).toHaveLength(4);
  });

  it("rejects quarter lines, zero odds, three-way markets, and events absent from the live DOM", () => {
    const body = [{ "8": 5574638, "2": "A", "3": "B", "7": {
      "3": ["2.25 0.93*1h 0.93*1a 12345"], "5": ["0.5 0*1h 0.8*1a h 12345"]
    } }, { "8": 999, "2": "X", "3": "Y", "7": { "5": ["0.5 0.8*1h -0.9*1a h 12345"] } }];
    expect(extractSbobetDirectCatalogRecords(body, fallback)).toEqual([]);
  });
});

describe("inspectSbobetMarketGroups", () => {
  it("reports only bounded numeric group keys and token kinds", () => {
    const body = [{ "8": 5574638, "2": "Kairat", "3": "Levski", "7": {
      "3": ["2.5 0.93*55746380030002005h -0.91*55746380030002005a 730078508181025 0 0"],
      "8": ["1.5 0.82*55746380080001005h -0.96*55746380080001005a 730078508281015 0 0"],
      "not-numeric": ["secret-value"]
    } }];

    const result = inspectSbobetMarketGroups(body);

    expect(result).toEqual([
      { groupKey: "3", rowCount: 1, rowShapes: [{ tokenCount: 6,
        tokenKinds: ["LINE", "ODDS_SELECTION_H", "ODDS_SELECTION_A", "INTEGER_ID", "INTEGER", "INTEGER"] }] },
      { groupKey: "8", rowCount: 1, rowShapes: [{ tokenCount: 6,
        tokenKinds: ["LINE", "ODDS_SELECTION_H", "ODDS_SELECTION_A", "INTEGER_ID", "INTEGER", "INTEGER"] }] }
    ]);
    expect(JSON.stringify(result)).not.toMatch(/Kairat|Levski|5574638|730078|0\.93|secret-value/u);
  });

  it("bounds recursion, groups, rows and tokens for diagnostic safety", () => {
    const groups = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [String(index),
      Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => "x").join(" "))]));
    const result = inspectSbobetMarketGroups([{ "7": groups }]);
    expect(result.length).toBeLessThanOrEqual(32);
    expect(result.every((group) => group.rowCount <= 8 && group.rowShapes.every((row) =>
      row.tokenCount <= 16 && row.tokenKinds.length <= 16))).toBe(true);
  });
});

describe("inspectSbobetMarketLabelEvidence", () => {
  it("returns only known market labels and bounded nearby numeric keys", () => {
    const source = `secret-token-should-not-leak {4:"First Half Over/Under",6:"First Half Handicap",` +
      `25:"Second Half Over/Under",27:"Second Half Handicap",99999:"x"}`;

    const result = inspectSbobetMarketLabelEvidence(source);
    expect(result.map(({ label, nearbyNumericKeys }) => ({ label, nearbyNumericKeys }))).toEqual([
      { label: "FIRST_HALF_OVER_UNDER", nearbyNumericKeys: ["4"] },
      { label: "FIRST_HALF_HANDICAP", nearbyNumericKeys: ["6"] },
      { label: "SECOND_HALF_OVER_UNDER", nearbyNumericKeys: ["25"] },
      { label: "SECOND_HALF_HANDICAP", nearbyNumericKeys: ["27"] }
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(result.every((item) => item.contextShape.length <= 240)).toBe(true);
  });

  it("bounds source size, evidence rows and numeric values", () => {
    const source = Array.from({ length: 100 }, (_, index) => `${index}:\"First Half Handicap\"`).join(",");
    const result = inspectSbobetMarketLabelEvidence(source);
    expect(result.length).toBeLessThanOrEqual(16);
    expect(result.every((item) => item.nearbyNumericKeys.length <= 8)).toBe(true);
  });
});
