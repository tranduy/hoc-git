import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import {
  extractSbobetDirectCatalogRecords,
  extractSbobetNativeMarketObservations,
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

  it("preserves detail-only corner and card markets when a socket updates one main market", () => {
    const bootstrap = extractSbobetDirectCatalogRecords([{ "8": 5574638, "2": "Kairat", "3": "Levski", "7": {
      "3": ["2.5 0.91*301h -0.93*301a 30001"],
      "21": ["9.5 0.92*211h -0.94*211a 21001"],
      "31": ["3.5 0.93*311h -0.95*311a 31001"]
    } }], fallback);
    const updated = mergeSbobetSocketCatalogRecords(bootstrap, [{ "8": 5574638,
      "2": "Kairat", "3": "Levski", "7": { "3": ["2.5 0.95*301h -0.97*301a 30001"] }
    }]);

    expect(updated[0]?.markets.map((item) => item.marketId)).toEqual(["30001", "21001", "31001"]);
    expect(updated[0]?.markets[0]?.selections.map((selection) => selection.priceText)).toEqual(["0.95", "-0.97"]);
    expect(updated[0]?.markets.slice(1)).toEqual(bootstrap[0]?.markets.slice(1));
  });

  it("uses retained event metadata for an identity-only socket price update", () => {
    const records = extractSbobetDirectCatalogRecords([{ "8": 5574638,
      "7": { "21": ["9.5 0.95*211h -0.97*211a 21001"] }
    }], fallback);

    expect(records).toEqual([expect.objectContaining({
      eventId: "5574638", leagueName: "Champions League", teamNames: ["Kairat", "Levski"],
      timeText: "1H 29'", markets: [expect.objectContaining({ marketId: "21001" })]
    })]);
  });

  it("returns explicit empty detail membership while a sparse socket container preserves retained markets", () => {
    const bootstrap = extractSbobetDirectCatalogRecords([{ "8": 5574638,
      "2": "Kairat", "3": "Levski", "7": { "21": ["9.5 0.92*211h -0.94*211a 21001"] }
    }], fallback);
    const empty = { "8": 5574638, "2": "Kairat", "3": "Levski", "7": {} };

    expect(extractSbobetDirectCatalogRecords(empty, bootstrap)).toEqual([
      expect.objectContaining({ eventId: "5574638", markets: [] })
    ]);
    expect(extractSbobetDirectCatalogRecords({ "8": 5574638 }, bootstrap)).toEqual([]);
    expect(mergeSbobetSocketCatalogRecords(bootstrap, [empty])).toEqual(bootstrap);
  });

  it("retires an invalidated native market without retaining its old open prices", () => {
    const bootstrap = extractSbobetDirectCatalogRecords([{ "8": 5574638, "7": {
      "3": ["2.5 0.91*301h -0.93*301a 30001"],
      "21": ["9.5 0.92*211h -0.94*211a 21001"]
    } }], fallback);
    const delta = { "8": 5574638, "7": {
      "3": ["2.5 0*301h -0.93*301a 30001 1000000"]
    } };

    expect(extractSbobetNativeMarketObservations(delta, bootstrap, 123)).toEqual([
      expect.objectContaining({ providerMarketId: "30001", disposition: "EXCLUDED" })
    ]);
    expect(mergeSbobetSocketCatalogRecords(bootstrap, [delta])[0]?.markets.map((item) => item.marketId))
      .toEqual(["21001"]);
  });

  it("does not treat a malformed detail market container as valid empty membership", () => {
    expect(extractSbobetDirectCatalogRecords({ "8": 5574638, "7": { error: "unavailable" } }, fallback))
      .toEqual([]);
  });

  it("rejects mixed valid and malformed groups as detail authority and accounts for the malformed group", () => {
    const body = { "8": 5574638, "7": { "3": null, "21": [] } };

    expect(extractSbobetDirectCatalogRecords(body, fallback)).toEqual([]);
    expect(extractSbobetNativeMarketObservations(body, fallback, 123)).toEqual([
      expect.objectContaining({ providerMarketId: "5574638:native:3:group", nativeType: "3",
        outcomeLabels: [], disposition: "EXCLUDED", reason: "INVALID_NATIVE_GROUP_SHAPE" })
    ]);
    const mixed = { "8": 5574638, "7": {
      "3": null, "21": ["9.5 0.91*211h -0.93*211a 21001"]
    } };
    expect(extractSbobetDirectCatalogRecords(mixed, fallback)).toEqual([]);
    expect(extractSbobetNativeMarketObservations(mixed, fallback, 123)).toEqual([
      expect.objectContaining({ providerMarketId: "5574638:native:3:group", disposition: "EXCLUDED" }),
      expect.objectContaining({ providerMarketId: "21001", disposition: "EXCLUDED",
        reason: "INVALID_NATIVE_GROUP_SHAPE" })
    ]);
  });

  it("does not infer an unknown native market ID from trailing numbers and delete a known market", () => {
    const bootstrap = extractSbobetDirectCatalogRecords([{ "8": 5574638, "7": {
      "3": ["2.5 0.91*301h -0.93*301a 30001"]
    } }], fallback);
    const delta = { "8": 5574638, "7": {
      "777": ["2.5 0.81*777h -0.83*777a 77777 30001"]
    } };

    expect(extractSbobetNativeMarketObservations(delta, bootstrap, 123)).toEqual([
      expect.objectContaining({ providerMarketId: "5574638:native:777:0", disposition: "UNMAPPED" })
    ]);
    expect(mergeSbobetSocketCatalogRecords(bootstrap, [delta])).toEqual(bootstrap);
  });

  it("retains zero handicap with signed native orientation through normalization", () => {
    const body = { "8": 5574638, "7": {
      "5": ["0 0.91*501h -0.93*501a h 50001"]
    } };
    const records = extractSbobetDirectCatalogRecords(body, fallback);
    const catalog = normalizeSbobetCatalog(records, { observedAtMs: 123, receivedMonotonicMs: 456, sequence: 1 });

    expect(catalog.markets).toEqual([expect.objectContaining({ providerMarketId: "50001", line: "0" })]);
    expect(catalog.quotes.map((quote) => ({ id: quote.providerSelectionId, line: quote.line }))).toEqual([
      { id: "501h", line: "0" }, { id: "501a", line: "0" }
    ]);
    expect(extractSbobetNativeMarketObservations(body, fallback, 123)).toEqual([
      expect.objectContaining({ providerMarketId: "50001", disposition: "NORMALIZED" })
    ]);
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

  it("accounts for mapped, excluded and unknown native groups without guessing their semantics", () => {
    const body = [{ "8": 5574638, "2": "A", "3": "B", "7": {
      "3": ["2.5 0.93*1h -0.91*1a 12345"],
      "1": ["2.1*2h 3.1*2a 3.4*2d 12346"],
      "777": ["0.81*3h -0.91*3a 12347"]
    } }];

    const observations = extractSbobetNativeMarketObservations(body, fallback, 123);
    expect(observations).toHaveLength(3);
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "12345", nativeType: "3", disposition: "NORMALIZED" }),
      expect.objectContaining({ providerMarketId: "5574638:native:1:0", nativeType: "1", disposition: "EXCLUDED",
        reason: "THREE_WAY_OUTCOME_DOMAIN" }),
      expect.objectContaining({ providerMarketId: "5574638:native:777:0", nativeType: "777", disposition: "UNMAPPED",
        reason: "NATIVE_TYPE_UNMAPPED" })
    ]));
  });

  it("excludes malformed prices and outcome identities before they can invalidate a valid market", () => {
    const body = [{ "8": 5574638, "2": "Kairat", "3": "Levski", "7": {
      "3": ["2.5 0.93*301h -0.91*301a 30001", "3.5 1.51*302h -0.91*302a 30002",
        "4.5 0.93*303h -0.91*303h 30003", "5.5 0.93*304a -0.91*304h 30004"]
    } }];

    expect(extractSbobetDirectCatalogRecords(body, fallback)[0]?.markets.map((item) => item.marketId))
      .toEqual(["30001"]);
    expect(extractSbobetNativeMarketObservations(body, fallback, 123).map((item) => ({
      id: item.providerMarketId, disposition: item.disposition
    }))).toEqual([
      { id: "30001", disposition: "NORMALIZED" }, { id: "30002", disposition: "EXCLUDED" },
      { id: "30003", disposition: "EXCLUDED" }, { id: "30004", disposition: "EXCLUDED" }
    ]);
  });

  it("accounts for non-string native rows without inventing a two-outcome domain", () => {
    const body = [{ "8": 5574638, "7": { "777": [null, { unexpected: "shape" }, 42] } }];

    expect(extractSbobetNativeMarketObservations(body, fallback, 123)).toEqual([
      expect.objectContaining({ providerMarketId: "5574638:native:777:0", outcomeLabels: [],
        disposition: "EXCLUDED", reason: "INVALID_NATIVE_ROW_SHAPE" }),
      expect.objectContaining({ providerMarketId: "5574638:native:777:1", outcomeLabels: [],
        disposition: "EXCLUDED", reason: "INVALID_NATIVE_ROW_SHAPE" }),
      expect.objectContaining({ providerMarketId: "5574638:native:777:2", outcomeLabels: [],
        disposition: "EXCLUDED", reason: "INVALID_NATIVE_ROW_SHAPE" })
    ]);
  });

  it("does not count a parsed native row as normalized when its event is rejected", () => {
    const body = [{ "8": 5574638, "2": "Kairat", "3": "Levski", "7": {
      "3": ["2.5 0.93*301h -0.91*301a 30001"]
    } }];
    const virtualFallback = fallback.map((record) => ({ ...record, leagueName: "Virtual Football" }));

    expect(extractSbobetNativeMarketObservations(body, virtualFallback, 123)).toEqual([
      expect.objectContaining({ providerMarketId: "30001", disposition: "EXCLUDED",
        reason: "NORMALIZATION_REJECTED" })
    ]);
  });

  it("retains an event whose only native market group is not mapped yet", () => {
    const body = [{ "1": "Prematch", "2": [{
      "0": "2026-09-08T12:00:00Z", "2": "Hidden Home", "3": "Hidden Away", "8": 778899,
      "7": { "777": ["0.5 0.91*77889901h -0.97*77889902a 778899777001"] }
    }] }];

    const records = extractSbobetDirectCatalogRecords(body, [{
      eventId: "778899", leagueName: "Prematch", timeText: "PREMATCH", scoreText: null,
      startAtUtcMs: Date.parse("2026-09-08T12:00:00Z"), teamNames: ["Hidden Home", "Hidden Away"], markets: []
    }]);

    expect(records).toEqual([expect.objectContaining({
      eventId: "778899", teamNames: ["Hidden Home", "Hidden Away"], markets: []
    })]);
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
