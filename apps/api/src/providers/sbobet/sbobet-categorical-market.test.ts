import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import { extractSbobetDirectCatalogRecords, extractSbobetNativeMarketObservations, mergeSbobetSocketCatalogRecords } from "./sbobet-direct-catalog.js";

const fixture = JSON.parse(readFileSync(new URL("./sbobet-categorical-native.fixture.json", import.meta.url), "utf8")) as {
  cases: Array<{ group: string; row: string; eventId: string }>;
};
const fallback = [{ eventId: "5691706", leagueName: "UEFA Champions League", timeText: "PREMATCH", scoreText: null,
  startAtUtcMs: 1789058700000, teamNames: ["Fenerbahce", "AS Roma"], markets: [] }];
const options = { observedAtMs: 1789005080000, receivedMonotonicMs: 0, sequence: 0 };
const raw = (group: string) => fixture.cases.find(c => c.group === group)!.row;
function decode(group: string, row = raw(group)) {
  const body = { "8": "5691706", "7": { [group]: [row] } };
  return { ...normalizeSbobetCatalog(extractSbobetDirectCatalogRecords(body, fallback), options),
    observation: extractSbobetNativeMarketObservations(body, fallback, options.observedAtMs)[0] };
}

describe("SBO categorical offers from frozen native rows and public outcome tables", () => {
  it.each([
    ["10", "FT_CORRECT_SCORE", "SCORE_1_3"], ["11", "FH_CORRECT_SCORE", "SCORE_0_3"],
    ["14", "FT_GOAL_RANGE", "RANGE_0_1"], ["15", "FH_GOAL_RANGE", "RANGE_0_0"],
    ["68", "FT_HALF_FULL_RESULT", "HOME_DRAW"], ["81", "FT_RESULT_BTTS", "HOME_YES"],
    ["82", "FT_RESULT_TOTAL", "AWAY_OVER"], ["98", "FT_DOUBLE_CHANCE_BTTS", "HOME_AWAY_YES"],
    ["131", "CORNER_FT_RANGE", "RANGE_0_4"], ["132", "HOME_FT_GOAL_RANGE", "RANGE_2_2"],
    ["133", "AWAY_FT_GOAL_RANGE", "RANGE_3_PLUS"], ["134", "HOME_CORNER_FT_RANGE", "RANGE_6_PLUS"],
    ["135", "AWAY_CORNER_FT_RANGE", "RANGE_6_PLUS"], ["136", "CORNER_FH_RANGE", "RANGE_0_1"]
  ])("decodes group %s with its own outcome domain", (group, marketType, selection) => {
    const result = decode(group!); const tokens = raw(group!).split(" ");
    expect(result.markets).toEqual([expect.objectContaining({ marketType, providerMarketId: tokens[2],
      line: group === "82" ? "1.5" : null, scope: ["11", "15", "136"].includes(group!) ? "FIRST_HALF" : "FULL_TIME" })]);
    expect(result.quotes).toEqual([expect.objectContaining({ selection, rawOdds: tokens[1]!.split("*")[0],
      providerSelectionId: tokens[1]!.split("*")[1], rawFormat: "DECIMAL", status: "OPEN", receivedMonotonicMs: 0 })]);
    expect(result.observation).toMatchObject({ disposition: "NORMALIZED", nativeRow: raw(group!), providerMarketId: tokens[2] });
  });
  it.each([
    ["16", "FT_DRAW_NO_BET", ["HOME", "AWAY"]], ["75", "FH_DRAW_NO_BET", ["HOME", "AWAY"]],
    ["17", "CORNER_FT_1X2", ["HOME", "AWAY", "DRAW"]], ["18", "CORNER_FH_1X2", ["HOME", "AWAY", "DRAW"]],
    ["65", "FT_HIGHEST_SCORING_HALF", ["FIRST_HALF", "SECOND_HALF", "EQUAL"]],
    ["87", "HOME_FT_HIGHEST_SCORING_HALF", ["FIRST_HALF", "SECOND_HALF", "EQUAL"]],
    ["88", "AWAY_FT_HIGHEST_SCORING_HALF", ["FIRST_HALF", "SECOND_HALF", "EQUAL"]],
    ["140", "CORNER_FH_THREE_WAY_TOTAL", ["OVER", "UNDER", "EXACT"]]
  ] as const)("preserves all native slots of group %s without binary substitution", (group, marketType, selections) => {
    const result = decode(group); const pairs = raw(group).split(" ").filter(t => t.includes("*"));
    expect(result.markets).toEqual([expect.objectContaining({ marketType, line: group === "140" ? "5" : null })]);
    expect(result.quotes.map(q => [q.selection, q.rawOdds, q.providerSelectionId, q.rawFormat])).toEqual(
      pairs.map((p, i) => [selections[i], p.split("*")[0], p.split("*")[1], "DECIMAL"]));
  });
  it("does not reuse the half/full result numbering for result-BTTS or double-chance-BTTS", () => {
    expect(decode("68", raw("68").replace(/^13 /u, "31 ")).quotes[0]?.selection).toBe("DRAW_HOME");
    expect(decode("81", raw("81").replace(/^14 /u, "24 ")).quotes[0]?.selection).toBe("DRAW_YES");
    expect(decode("98").quotes[0]?.selection).toBe("HOME_AWAY_YES");
    expect(decode("82", raw("82").replace(/^5:/u, "4:")).quotes[0]?.selection).toBe("DRAW_UNDER");
  });
  it("keeps SBO's 9:9 OTHER sentinel in native inventory, never as an exact 9-9 score", () => {
    const result = decode("10", raw("10").replace(/^1:3 /u, "9:9 "));
    expect(result.markets).toEqual([]);
    expect(result.observation).toMatchObject({ disposition: "UNMAPPED", reason: "OTHER_SCORE_DOMAIN_REQUIRED",
      nativeSelections: [expect.objectContaining({ line: "9:9" })] });
  });
  it.each(["10", "65", "16", "140"])("does not reopen group %s with absent or invalid suspension evidence", group => {
    const tokens = raw(group!).split(" "); const idIndex = group === "65" ? 3 : group === "140" ? 4 : 2;
    tokens[idIndex + 1] = "1";
    const suspended = decode(group!, tokens.join(" ")).quotes;
    const absent = decode(group!, tokens.slice(0, idIndex + 1).join(" ")).quotes;
    expect(suspended.length).toBeGreaterThan(0); expect(absent.length).toBe(suspended.length);
    expect(suspended.every(q => q.status === "SUSPENDED")).toBe(true);
    expect(absent.every(q => q.status === "SUSPENDED")).toBe(true);
    tokens[idIndex + 1] = "broken";
    expect(decode(group!, tokens.join(" ")).quotes).toEqual([]);
  });
  it("retains a valid half outcome when other prices are unavailable", () => {
    const tokens = raw("65").split(" "); tokens[1] = tokens[1]!.replace(/^[^*]+/u, "0"); tokens[2] = tokens[2]!.replace(/^[^*]+/u, "0");
    expect(decode("65", tokens.join(" ")).quotes.map(q => q.selection)).toEqual(["FIRST_HALF"]);
  });
  it("does not let an OTHER score discard the separate corner component of the same receipt", () => {
    const metadata = { "8": "5691706", "0": "2026-09-10T18:05:00Z", "2": "Fenerbahce", "3": "AS Roma" };
    const goals = { ...metadata, "7": { "10": [raw("10"), raw("10").replace(/^1:3 /u, "9:9 ")] } };
    const corners = { ...metadata, "7": { "17": [raw("17")] } };
    for (const bodies of [[goals, corners], [corners, goals]]) {
      const out = normalizeSbobetCatalog(extractSbobetDirectCatalogRecords(bodies, fallback), options);
      expect(out.markets.map(m => m.marketType).sort()).toEqual(["CORNER_FT_1X2", "FT_CORRECT_SCORE"]);
      expect(extractSbobetNativeMarketObservations(bodies, fallback, options.observedAtMs)).toHaveLength(3);
    }
  });
  it("withdraws a categorical price when the native slot becomes unavailable", () => {
    const body = { "8": "5691706", "7": { "10": [raw("10")] } };
    const initial = extractSbobetDirectCatalogRecords(body, fallback);
    const unavailable = { "8": "5691706", "7": { "10": [raw("10").replace("16.0*", "0*")] } };
    const merged = normalizeSbobetCatalog(mergeSbobetSocketCatalogRecords(initial, [unavailable]), options);
    expect(merged.quotes).toEqual([]);
    expect(extractSbobetNativeMarketObservations(unavailable, fallback, options.observedAtMs)[0])
      .toMatchObject({ providerMarketId: "184675719101013", disposition: "EXCLUDED", reason: "INVALID_CATEGORICAL_SHAPE" });
  });
  it.each(["-0.8", "1", "01.8", "Infinity"])("does not reinterpret malformed/invalid decimal odds %s", odds => {
    expect(decode("10", raw("10").replace("16.0*", `${odds}*`)).quotes).toEqual([]);
  });
  it.each([["14", "5:2"], ["10", "3+"], ["68", "41"], ["81", "21"], ["82", "7:1.5"], ["82", "1:1.25"]])(
    "retains an unknown/invalid group %s label %s without inventing a mapping", (group, label) => {
      const result = decode(group!, raw(group!).replace(/^\S+/u, label!));
      expect(result.quotes).toEqual([]); expect(result.observation?.nativeRow).toContain(label!);
    });
});
