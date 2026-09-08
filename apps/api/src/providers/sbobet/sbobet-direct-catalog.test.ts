import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

const observedContainers = (JSON.parse(readFileSync(new URL("./sbobet-native-5717357.fixture.json", import.meta.url),
  "utf8")) as { records: Array<Record<string, unknown> & { "7": Record<string, string[]> }> }).records;
const observedFallback = [{ eventId: "5717357", leagueName: "K-Sports Football", timeText: "PREMATCH",
  scoreText: null, startAtUtcMs: Date.parse(String(observedContainers[0]!["0"])),
  teamNames: [String(observedContainers[0]!["2"]), String(observedContainers[0]!["3"])], markets: [] }];
const observedOptions = { observedAtMs: 1788841583335, receivedMonotonicMs: 126424, sequence: 1 };

// Exact getEventBetMore rows from the sanitized 5717357 HTTP receipt. Outcome
// order/indices are independently established by public chunk 7409 renderers.
const observedMoreRows = [
  { group: "8", type: "FT_ODD_EVEN", row: "1.91*57173570080000000h 1.8*57173570080000000a 18485280981000 0 2 0 0 0" },
  { group: "9", type: "FH_ODD_EVEN", row: "2.05*57173570090000000h 1.69*57173570090000000a 18485280991000 0 3 0 0 0" },
  { group: "36", type: "FT_BTTS", row: "0.0 1.71*57173570360000000h 2.02*57173570360000000a 184852809361000 0 2 0 0 0" },
  { group: "37", type: "FH_BTTS", row: "0.0 4.5*57173570370000000h 1.16*57173570370000000a 184852809371000 0 3 0 0 0" },
  { group: "56", type: "CORNER_FT_ODD_EVEN", row: "1.84*57173570560000000h 1.86*57173570560000000a 184852809561000 0 4 0 0 0" },
  { group: "57", type: "CORNER_FH_ODD_EVEN", row: "1.83*57173570570000000h 1.87*57173570570000000a 184852809571000 0 4 0 0 0" },
  { group: "76", type: "HOME_FT_ODD_EVEN", row: "1.88*57173570760000000h 1.82*57173570760000000a 184852809761000 0 2 0 0 0" },
  { group: "80", type: "SH_TOTAL", row: "1.5 1.88*57173570800001005h 1.83*57173570800001005a 184852809801015 0 11 0 0 0" },
  { group: "86", type: "SH_ODD_EVEN", row: "1.97*57173570860000000h 1.75*57173570860000000a 184852809861000 0 11 0 0 0" }
] as const;

const observedTeamMoreRows = [
  { group: "61", type: "HOME_CORNER_FT_TOTAL", line: "6.25", pairStart: 1, row: "6.25 1.83*57173570610060025h 1.87*57173570610060025a 1848528096110625 0 4 0 0 0" },
  { group: "62", type: "HOME_CORNER_FH_TOTAL", line: "3", pairStart: 1, row: "3.0 1.91*57173570620003000h 1.8*57173570620003000a 184852809621030 0 4 0 0 0" },
  { group: "63", type: "AWAY_CORNER_FT_TOTAL", line: "3.75", pairStart: 1, row: "3.75 1.9*57173570630030075h 1.8*57173570630030075a 1848528096310375 0 4 0 0 0" },
  { group: "64", type: "AWAY_CORNER_FH_TOTAL", line: "1.75", pairStart: 1, row: "1.75 1.93*57173570640010075h 1.78*57173570640010075a 1848528096410175 0 4 0 0 0" },
  { group: "69", type: "HOME_FT_SCORE_BOTH_HALVES", line: null, pairStart: 0, row: "2.33*57173570690000000h 1.54*57173570690000000a 184852809691000 0 2 0 0 0" },
  { group: "70", type: "AWAY_FT_SCORE_BOTH_HALVES", line: null, pairStart: 0, row: "6.5*57173570700000000h 1.08*57173570700000000a 184852809701000 0 2 0 0 0" },
  { group: "71", type: "HOME_FT_WIN_BOTH_HALVES", line: null, pairStart: 0, row: "4.12*57173570710000000h 1.19*57173570710000000a 184852809711000 0 2 0 0 0" },
  { group: "73", type: "HOME_FT_WIN_EITHER_HALF", line: null, pairStart: 0, row: "1.28*57173570730000000h 3.33*57173570730000000a 184852809731000 0 2 0 0 0" },
  { group: "74", type: "AWAY_FT_WIN_EITHER_HALF", line: null, pairStart: 0, row: "3.08*57173570740000000h 1.32*57173570740000000a 184852809741000 0 2 0 0 0" },
  { group: "78", type: "HOME_FT_WIN_TO_NIL", line: null, pairStart: 0, row: "2.79*57173570780000000h 1.39*57173570780000000a 184852809781000 0 2 0 0 0" },
  { group: "83", type: "HOME_FT_CLEAN_SHEET", line: null, pairStart: 0, row: "2.43*57173570830000000h 1.5*57173570830000000a 184852809831000 0 2 0 0 0" },
  { group: "84", type: "AWAY_FT_CLEAN_SHEET", line: null, pairStart: 0, row: "7.0*57173570840000000h 1.07*57173570840000000a 184852809841000 0 2 0 0 0" },
  { group: "99", type: "FT_BOTH_HALVES_OVER_TOTAL", line: "1.5", pairStart: 1, row: "1.5 4.85*57173570990001005h 1.15*57173570990001005a 184852809991015 0 12 0 0 0" },
  { group: "100", type: "FT_BOTH_HALVES_UNDER_TOTAL", line: "1.5", pairStart: 1, row: "1.5 2.98*57173571000001005h 1.34*57173571000001005a 1848528091001015 0 12 0 0 0" },
  { group: "101", type: "HOME_FT_TOTAL", line: "1.75", pairStart: 1, row: "1.75 1.72*57173571010010075h 2.01*57173571010010075a 18485280910110175 0 12 0 0 0" },
  { group: "102", type: "AWAY_FT_TOTAL", line: "0.75", pairStart: 1, row: "0.75 1.74*57173571020000075h 1.98*57173571020000075a 18485280910210075 0 12 0 0 0" }
] as const;

describe("observed More team and predicate formats", () => {
  it.each(observedTeamMoreRows)("keeps exact group $group team, period, predicate and prices", ({ group, type, line, pairStart, row }) => {
    const body = { "8": 5717357, "7": { [group]: [row] } };
    const result = normalizeSbobetCatalog(extractSbobetDirectCatalogRecords(body, observedFallback), observedOptions);
    const tokens = row.split(" ");
    const outcomes = ["61", "62", "63", "64", "101", "102"].includes(group) ? ["OVER", "UNDER"] : ["YES", "NO"];
    expect(result.markets).toEqual([expect.objectContaining({ marketType: type, line, providerMarketId: tokens[pairStart + 2] })]);
    expect(result.quotes.map(({ providerSelectionId, selection, rawOdds, rawFormat }) =>
      ({ providerSelectionId, selection, rawOdds, rawFormat }))).toEqual(tokens.slice(pairStart, pairStart + 2).map((token, index) => ({
      providerSelectionId: token.split("*")[1], selection: outcomes[index], rawOdds: token.split("*")[0], rawFormat: "DECIMAL"
    })));
    expect(extractSbobetNativeMarketObservations(body, observedFallback, 123)).toEqual([
      expect.objectContaining({ providerMarketId: tokens[pairStart + 2], disposition: "NORMALIZED" })
    ]);
  });

  it("maps absent-fixture sending-off and away predicate siblings using the proven no-line YES/NO layout", () => {
    for (const [group, type] of [["60", "SENDING_OFF"], ["72", "AWAY_FT_WIN_BOTH_HALVES"], ["79", "AWAY_FT_WIN_TO_NIL"]]) {
      const result = normalizeSbobetCatalog(extractSbobetDirectCatalogRecords({ "8": 5717357, "7": {
        [group!]: ["2.25*57173570000000000h 1.45*57173570000000000a 12345 0 2 0 0 0"]
      } }, observedFallback), observedOptions);
      expect(result.markets).toEqual([expect.objectContaining({ marketType: type, line: null })]);
      expect(result.quotes.map((quote) => quote.selection)).toEqual(["YES", "NO"]);
    }
  });

  it("withdraws an invalid line-bearing YES/NO price under the same native market ID", () => {
    const source = observedTeamMoreRows.find(({ group }) => group === "99")!;
    const body = { "8": 5717357, "7": { "99": [source.row] } };
    const bootstrap = extractSbobetDirectCatalogRecords(body, observedFallback);
    const invalid = { "8": 5717357, "7": { "99": [source.row.replace("4.85*", "0*")] } };
    expect(bootstrap[0]?.markets).toHaveLength(1);
    expect(extractSbobetNativeMarketObservations(invalid, observedFallback, 123)).toEqual([
      expect.objectContaining({ providerMarketId: "184852809991015", disposition: "EXCLUDED" })
    ]);
    expect(mergeSbobetSocketCatalogRecords(bootstrap, [invalid])[0]?.markets).toEqual([]);
  });
});

describe("observed More binary formats", () => {
  it.each(observedMoreRows)("preserves exact native identity, decimal prices and outcomes for group $group", ({ group, type, row }) => {
    const body = { ...observedContainers[0], "7": { [group]: [row] } };
    const result = normalizeSbobetCatalog(extractSbobetDirectCatalogRecords(body, observedFallback), observedOptions);
    const pairs = row.split(" ").filter((token) => token.includes("*"));
    const outcomes = type.includes("ODD_EVEN") ? ["ODD", "EVEN"] : type.includes("BTTS") ? ["YES", "NO"] : ["OVER", "UNDER"];
    const id = row.split(" ")[group === "36" || group === "37" || group === "80" ? 3 : 2];
    expect(result.markets).toEqual([expect.objectContaining({ marketType: type, providerMarketId: id,
      line: group === "80" ? "1.5" : null, status: "OPEN" })]);
    expect(result.quotes.map(({ providerSelectionId, selection, rawOdds, rawFormat }) =>
      ({ providerSelectionId, selection, rawOdds, rawFormat }))).toEqual(pairs.map((token, index) => ({
      providerSelectionId: token.split("*")[1], selection: outcomes[index], rawOdds: token.split("*")[0], rawFormat: "DECIMAL"
    })));
    expect(extractSbobetNativeMarketObservations(body, observedFallback, observedOptions.observedAtMs))
      .toEqual([expect.objectContaining({ providerMarketId: id, disposition: "NORMALIZED" })]);
  });

  it("adds all nine observed More markets while preserving the existing main/corner prices", () => {
    const bootstrap = extractSbobetDirectCatalogRecords(observedContainers, observedFallback);
    const more = { "8": 5717357, "7": Object.fromEntries(observedMoreRows.map(({ group, row }) => [group, [row]])) };
    const result = normalizeSbobetCatalog(mergeSbobetSocketCatalogRecords(bootstrap, [more]), observedOptions);
    expect(result.markets).toHaveLength(33);
    expect(result.quotes).toHaveLength(66);
    for (const quote of normalizeSbobetCatalog(bootstrap, observedOptions).quotes) expect(result.quotes).toContainEqual(quote);
  });

  it("maps the source-defined away odd/even and second-half handicap siblings", () => {
    const body = { "8": 5717357, "7": {
      "77": ["2.1*57173570770000000h 1.8*57173570770000000a 77001 0 2 0 0 0"],
      "85": ["0.5 2.2*57173570850000000h 1.7*57173570850000000a h 85001 0 11 0 0 0"]
    } };
    const result = normalizeSbobetCatalog(extractSbobetDirectCatalogRecords(body, observedFallback), observedOptions);
    expect(result.markets).toEqual([
      expect.objectContaining({ marketType: "AWAY_FT_ODD_EVEN", line: null, providerMarketId: "77001" }),
      expect.objectContaining({ marketType: "SH_AH", line: "-0.5", providerMarketId: "85001" })
    ]);
    expect(result.quotes.every((quote) => quote.rawFormat === "DECIMAL")).toBe(true);
  });

  it.each(["8", "36", "80"])("uses the exact status and market-ID token for suspension and withdrawal of group %s", (group) => {
    const source = observedMoreRows.find((item) => item.group === group)!;
    const tokens = source.row.split(" ");
    const idIndex = group === "8" ? 2 : 3;
    const id = tokens[idIndex];
    const bootstrap = extractSbobetDirectCatalogRecords({ "8": 5717357, "7": { [group]: [source.row] } }, observedFallback);
    tokens[idIndex + 1] = "1";
    const suspended = { "8": 5717357, "7": { [group]: [tokens.join(" ")] } };
    const result = normalizeSbobetCatalog(mergeSbobetSocketCatalogRecords(bootstrap, [suspended]), observedOptions);
    expect(result.quotes).toHaveLength(2);
    expect(result.quotes.every((quote) => quote.status === "SUSPENDED" && quote.providerMarketId === id)).toBe(true);
    tokens[group === "8" ? 0 : 1] = tokens[group === "8" ? 0 : 1]!.replace(/^[^*]+/u, "0");
    const invalid = { "8": 5717357, "7": { [group]: [tokens.join(" ")] } };
    expect(extractSbobetNativeMarketObservations(invalid, observedFallback, 123))
      .toEqual([expect.objectContaining({ providerMarketId: id, disposition: "EXCLUDED" })]);
    expect(mergeSbobetSocketCatalogRecords(bootstrap, [invalid])[0]?.markets).toEqual([]);
  });

  it.each([
    { group: "8", row: "1.9*801a 1.8*801h 80001 0" },
    { group: "8", row: "1.9*801h 1.8*801h 80001 0" },
    { group: "8", row: "0.9*801h -0.8*801a 80001 0" },
    { group: "8", row: "1*801h 1.8*801a 80001 0" },
    { group: "8", row: "1.9junk*801h 1.8*801a 80001 0" },
    { group: "8", row: "1.9*801h 1.8*801a 80001 closed" },
    { group: "36", row: "0.0 1.9*361a 1.8*361h 36001 0" },
    { group: "36", row: "0.5 1.9*361h 1.8*361a 36001 0" },
    { group: "36", row: "junk 1.9*361h 1.8*361a 36001 0" },
    { group: "80", row: "1.5 0.9*801h -0.8*801a 80001 0" }
  ])("rejects contradictory outcome/format/placeholder rows: $row", ({ group, row }) => {
    expect(extractSbobetDirectCatalogRecords({ "8": 5717357, "7": { [group]: [row] } }, observedFallback)[0]?.markets).toEqual([]);
  });

  it("keeps draw-no-bet explicitly excluded for refund settlement", () => {
    const body = { "8": 5717357, "7": { "16": [
      "1.17*57173570160000000h 4.33*57173570160000000a 184852809161000 0 2 0 0 0"
    ] } };
    expect(extractSbobetNativeMarketObservations(body, observedFallback, 123)).toEqual([
      expect.objectContaining({ nativeType: "16", disposition: "EXCLUDED", reason: "PUSH_OR_REFUND_SETTLEMENT" })
    ]);
  });
});

describe("observed same-event goal and corner containers", () => {
  it.each([
    { reversed: false, widerRoster: false }, { reversed: false, widerRoster: true },
    { reversed: true, widerRoster: false }, { reversed: true, widerRoster: true }
  ])("retains both disjoint native components independently of traversal and roster size: %j", ({ reversed, widerRoster }) => {
    const body = reversed ? [...observedContainers].reverse() : observedContainers;
    const bootstrap = widerRoster ? [...observedFallback, { ...observedFallback[0]!, eventId: "unmatched-roster-control" }]
      : observedFallback;
    const independent = observedContainers.map((raw) =>
      normalizeSbobetCatalog(extractSbobetDirectCatalogRecords(raw, observedFallback), observedOptions));
    const records = extractSbobetDirectCatalogRecords(body, bootstrap);
    const result = normalizeSbobetCatalog(records, observedOptions);
    expect(records).toHaveLength(1);
    expect(result.markets).toHaveLength(24);
    expect(result.quotes).toHaveLength(48);
    expect(result.markets.map((market) => market.providerMarketId).sort()).toEqual(
      independent.flatMap((catalog) => catalog.markets.map((market) => market.providerMarketId)).sort());
    expect(result.quotes).toHaveLength(independent.reduce((count, catalog) => count + catalog.quotes.length, 0));
    for (const quote of independent.flatMap((catalog) => catalog.quotes)) expect(result.quotes).toContainEqual(quote);
    const native = extractSbobetNativeMarketObservations(body, bootstrap, observedOptions.observedAtMs);
    expect(native.filter((item) => item.disposition === "NORMALIZED").every((item) =>
      result.markets.some((market) => market.providerMarketId === item.providerMarketId))).toBe(true);
  });

  it("accepts the observed neutral favorite token only for a zero handicap", () => {
    const raw = observedContainers[0]!;
    const zeroRow = raw["7"]["6"]!.find((row) => row.startsWith("0.0 "))!;
    const body = { ...raw, "7": { "6": [zeroRow, zeroRow.replace(/^0\.0 /u, "0.25 ")] } };
    const records = extractSbobetDirectCatalogRecords(body, observedFallback);
    const result = normalizeSbobetCatalog(records, observedOptions);
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "FH_AH", line: "0",
      providerMarketId: "18485280961000" })]);
    expect(result.quotes.map(({ providerSelectionId, rawOdds, line }) => ({ providerSelectionId, rawOdds, line })))
      .toEqual([
        { providerSelectionId: "57173570060000000h", rawOdds: "0.28", line: "0" },
        { providerSelectionId: "57173570060000000a", rawOdds: "-0.38", line: "0" }
      ]);
    expect(extractSbobetNativeMarketObservations(body, observedFallback, observedOptions.observedAtMs)
      .map((item) => item.disposition)).toEqual(["NORMALIZED", "EXCLUDED"]);
  });

  it.each([{}, { "3": [] }])("preserves a later explicit empty container or group as replacement: %j", (groups) => {
    const replacement = { ...observedContainers[0]!, "7": groups };
    expect(extractSbobetDirectCatalogRecords([...observedContainers, replacement], observedFallback))
      .toEqual(extractSbobetDirectCatalogRecords(replacement, observedFallback));
  });

  it("does not resurrect groups preceding an explicit empty container", () => {
    const cleared = { ...observedContainers[0]!, "7": {} };
    expect(extractSbobetDirectCatalogRecords([observedContainers[0], cleared, observedContainers[1]], observedFallback))
      .toEqual(extractSbobetDirectCatalogRecords(observedContainers[1], observedFallback));
  });

  it("preserves later overlapping-group replacement instead of keeping superseded native prices", () => {
    const replacement = { ...observedContainers[0]!, "7": {
      "3": [observedContainers[0]!["7"]["3"]![0]!.replace("0.98*", "0.97*")]
    } };
    expect(extractSbobetDirectCatalogRecords([...observedContainers, replacement], observedFallback))
      .toEqual(extractSbobetDirectCatalogRecords(replacement, observedFallback));
  });

  it.each([{ "2": "Different Home" }, { "0": "2026-09-09T15:00:00Z" }, { "0": undefined }])(
    "keeps later replacement when native event metadata conflicts or is unproven: %j", (metadata) => {
      const replacement = { ...observedContainers[1]!, ...metadata };
      expect(extractSbobetDirectCatalogRecords([observedContainers[0], replacement], observedFallback))
        .toEqual(extractSbobetDirectCatalogRecords(replacement, observedFallback));
    });

  it("does not combine disjoint native groups that reuse a canonical native market ID", () => {
    const replacement = { ...observedContainers[1]!, "7": {
      "21": [observedContainers[1]!["7"]["21"]![0]!.replace("18485280921101025", "184852809310275")]
    } };
    expect(extractSbobetDirectCatalogRecords([observedContainers[0], replacement], observedFallback))
      .toEqual(extractSbobetDirectCatalogRecords(replacement, observedFallback));
  });
});

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
      "80": ["1.75 1.92*80h 1.82*80a 80001"],
      "85": ["0.5 1.93*85h 1.83*85a h 85001"]
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

  it("does not traverse a body when no fallback events are admitted", () => {
    const unadmitted = new Proxy({}, { ownKeys: () => { throw new Error("UNADMITTED_TRAVERSAL"); } });
    expect(extractSbobetDirectCatalogRecords(unadmitted, [])).toEqual([]);
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
