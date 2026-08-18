import { describe, expect, it } from "vitest";
import {
  extractSbobetDirectCatalogRecords,
  extractSbobetMarketDomCandidates,
  inspectSbobetMarketGroups,
  inspectSbobetMarketLabelEvidence,
  mergeSbobetSocketCatalogRecords
} from "./sbobet-direct-catalog.js";

const fallback = [{
  eventId: "5574638", leagueName: "Champions League", timeText: "1H 29'", scoreText: "0 - 1",
  teamNames: ["Kairat", "Levski"], markets: []
}];

describe("extractSbobetDirectCatalogRecords", () => {
  it("merges an exact socket event update over the HTTP bootstrap snapshot", () => {
    const bootstrap = extractSbobetDirectCatalogRecords([{ "8": 5574638, "2": "Kairat", "3": "Levski", "7": {
      "5": ["0.5 -0.91*55746380050009905h 0.79*55746380050009905a h 730078508161105"]
    } }], fallback);
    const updated = mergeSbobetSocketCatalogRecords(bootstrap, [{ body: [{ "8": 5574638, "2": "Kairat", "3": "Levski",
      "7": { "5": ["0.5 0.95*55746380050009905h -0.75*55746380050009905a h 730078508161105"] } }] }]);
    expect(updated[0]?.markets[0]?.selections.map((selection) => selection.priceText)).toEqual(["0.95", "-0.75"]);
  });

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

  it("keeps quarter lines while rejecting zero odds, three-way markets, and events absent from the live DOM", () => {
    const body = [{ "8": 5574638, "2": "A", "3": "B", "7": {
      "3": ["2.25 0.93*1h 0.93*1a 12345"],
      "4": ["1.75 0.81*2h -0.91*2a 12346"],
      "5": ["0.75 0.82*3h -0.92*3a h 12347", "0.5 0*4h 0.8*4a h 12348"],
      "6": ["0.25 -0.88*5h 0.78*5a a 12349"]
    } }, { "8": 999, "2": "X", "3": "Y", "7": { "5": ["0.5 0.8*1h -0.9*1a h 12345"] } }];
    const [record] = extractSbobetDirectCatalogRecords(body, fallback);
    expect(record?.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ marketType: "FT_TOTAL", lineText: "2.25" }),
      expect.objectContaining({ marketType: "FH_TOTAL", lineText: "1.75" }),
      expect.objectContaining({ marketType: "FT_AH", selections: expect.arrayContaining([
        expect.objectContaining({ selection: "HOME", lineText: "0.75" })
      ]) }),
      expect.objectContaining({ marketType: "FH_AH", selections: expect.arrayContaining([
        expect.objectContaining({ selection: "AWAY", lineText: "0.25" })
      ]) })
    ]));
    expect(record?.markets).toHaveLength(4);
  });

  it("decodes only the provider-defined second-half, corner and card two-way groups", () => {
    const body = [{ "8": 5574638, "2": "A", "3": "B", "7": {
      "19": ["1.25 0.82*19h -0.92*19a h 19001"],
      "20": ["0.75 0.83*20h -0.93*20a a 20001"],
      "21": ["9.5 0.84*21h -0.94*21a 21001"],
      "22": ["4.25 0.85*22h -0.95*22a 22001"],
      "25": ["2.5 0.86*25h -0.96*25a 25001"],
      "27": ["0.5 0.87*27h -0.97*27a h 27001"],
      "31": ["3.5 0.88*31h -0.98*31a 31001"],
      "32": ["1.25 0.89*32h -0.99*32a 32001"],
      "33": ["0.75 0.9*33h -0.8*33a h 33001"],
      "34": ["0.25 0.91*34h -0.81*34a a 34001"],
      "80": ["1.75 0.92*80h -0.82*80a 80001"],
      "85": ["0.5 0.93*85h -0.83*85a h 85001"]
    } }];

    const [record] = extractSbobetDirectCatalogRecords(body, fallback);

    expect(record?.markets.map((item) => item.marketType)).toEqual([
      "CORNER_FT_AH", "CORNER_FH_AH", "CORNER_FT_TOTAL", "CORNER_FH_TOTAL",
      "CARD_FT_TOTAL", "CARD_FH_TOTAL", "CARD_FT_AH", "CARD_FH_AH", "SH_TOTAL", "SH_AH"
    ]);
    expect(record?.markets.some((item) => item.marketId === "25001" || item.marketId === "27001")).toBe(false);
  });

  it("fails closed before an oversized payload can monopolize the API event loop", () => {
    const sentinel = new Proxy({}, { ownKeys: () => { throw new Error("UNBOUNDED_TRAVERSAL"); } });
    const oversized = [...Array.from({ length: 50_001 }, () => ({})), sentinel];

    expect(() => extractSbobetDirectCatalogRecords(oversized, fallback)).not.toThrow();
    expect(extractSbobetDirectCatalogRecords(oversized, fallback)).toEqual([]);
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

describe("extractSbobetMarketDomCandidates", () => {
  it("extracts only bounded selection IDs for explicitly requested groups", () => {
    const body = [{ "8": 5574638, "7": {
      "25": ["2.5 0.93*55746380250002005h -0.91*55746380250002005a 730078508181025 0 0"],
      "27": ["0.5 -0.91*55746380270009905h 0.79*55746380270009905a h 730078508161105 0 0"],
      "999": ["secret-token-should-not-leak"]
    } }];

    expect(extractSbobetMarketDomCandidates(body, ["25", "27"])).toEqual([
      { eventId: "5574638", groupKey: "25", selectionIds: ["55746380250002005h", "55746380250002005a"] },
      { eventId: "5574638", groupKey: "27", selectionIds: ["55746380270009905h", "55746380270009905a"] }
    ]);
    expect(JSON.stringify(extractSbobetMarketDomCandidates(body, ["25"]))).not.toContain("secret-token");
  });
});

describe("inspectSbobetMarketLabelEvidence", () => {
  it("returns only known market labels and bounded nearby numeric keys", () => {
    const source = `secret-token-should-not-leak {4:"First Half Over/Under",6:"First Half Handicap",` +
      `80:"Second Half Over/Under",85:"Second Half Handicap",99999:"x"}`;

    const result = inspectSbobetMarketLabelEvidence(source);
    expect(result.map(({ label, nearbyNumericKeys }) => ({ label, nearbyNumericKeys }))).toEqual([
      { label: "FIRST_HALF_OVER_UNDER", nearbyNumericKeys: ["4"] },
      { label: "FIRST_HALF_HANDICAP", nearbyNumericKeys: ["6"] },
      { label: "SECOND_HALF_OVER_UNDER", nearbyNumericKeys: ["80"] },
      { label: "SECOND_HALF_HANDICAP", nearbyNumericKeys: ["85"] }
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
