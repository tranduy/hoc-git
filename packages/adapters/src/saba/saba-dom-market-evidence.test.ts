import { describe, expect, it } from "vitest";
import { normalizeObservedFootballCatalog, observeNativeCmdMarkets,
  type CmdCatalogGroup } from "../cmd/cmd-normalizer.js";

const options = { observedAtMs: 1789008004223, receivedMonotonicMs: 19,
  timezoneOffsetMinutes: 480, sequence: 7 };
const record = { sportId: "1" as const, leagueId: "league", leagueName: "League",
  matchId: "match", timeText: "09/11 08:00PM", teamNames: ["Home", "Away"] };
const catalog = (group: CmdCatalogGroup, provider: "SABA" | "CMD" = "SABA") =>
  normalizeObservedFootballCatalog(provider, [{ ...record, groups: [group] }], options);
const native = (group: CmdCatalogGroup) =>
  observeNativeCmdMarkets("SABA", [{ ...record, groups: [group] }], options)[0];
const group = (type: string, labels: string[], prices: string[]): CmdCatalogGroup => ({
  betTypeIds: [type], labels, odds: prices.map(priceText => ({ marketOddsId: "match__market",
    priceText, status: null, greyedOut: "false" })) });

describe("SABA public main renderer evidence", () => {
  it.each([["5", "FT_1X2", "FULL_TIME"], ["15", "FH_1X2", "FIRST_HALF"]])(
    "reads native %s in renderer 1,2,x order rather than 1,x,2 order", (type, marketType, scope) => {
      const input = group(type, [], ["11.00", "1.40", "3.15"]);
      const result = catalog(input);
      expect(result.markets).toEqual([expect.objectContaining({ marketType, scope, line: null })]);
      expect(result.quotes.map(q => [q.selection, q.rawOdds, q.rawFormat]))
        .toEqual([["HOME", "11.00", "DECIMAL"], ["AWAY", "1.40", "DECIMAL"], ["DRAW", "3.15", "DECIMAL"]]);
      expect(native(input)).toMatchObject({ nativeLabel: null, disposition: "NORMALIZED",
        outcomeLabels: ["HOME", "AWAY", "DRAW"] });
      expect(catalog(input, "CMD").markets).toEqual([]);
    });

  it.each([
    ["461", "HOME_FT_TOTAL", "football-home-goals-regulation"],
    ["462", "AWAY_FT_TOTAL", "football-away-goals-regulation"]
  ])("maps native %s to a named-team total with original decimal prices", (type, marketType, settlementProfile) => {
    const input = group(type, ["1.5", "u"], ["2.38", "1.51"]);
    const result = catalog(input);
    expect(result.markets).toEqual([expect.objectContaining({ marketType, scope: "FULL_TIME",
      settlementProfile, line: "1.5" })]);
    expect(result.quotes.map(q => [q.selection, q.rawOdds, q.rawFormat, q.receivedMonotonicMs, q.sequence]))
      .toEqual([["OVER", "2.38", "DECIMAL", 19, 7], ["UNDER", "1.51", "DECIMAL", 19, 7]]);
    expect(native(input)).toMatchObject({ nativeLabel: "1.5 | u", disposition: "NORMALIZED",
      outcomeLabels: ["OVER", "UNDER"] });
    expect(catalog(input, "CMD").markets).toEqual([]);
  });

  it("refuses ambiguous layouts, mixed types, invalid lines, formats and missing prices", () => {
    for (const input of [group("5", [], ["1.40", "3.15"]), group("5", ["unknown"], ["11", "1.40", "3.15"]),
      group("461", ["u", "1.5"], ["2.38", "1.51"]), group("461", ["1.3", "u"], ["2.38", "1.51"]),
      group("461", [], ["2.38", "1.51"]),
      { ...group("461", ["1.5", "u"], ["2.38", "1.51"]), betTypeIds: ["461", "462"] },
      { ...group("461", ["1.5", "u"], ["2.38", "1.51"]), odds: group("461", [], ["2.38", "1.51"])
        .odds.map(o => ({ ...o, priceFormat: "HK" as const })) }
    ]) expect(catalog(input).quotes).toEqual([]);
  });

  it("retains the valid UNDER quote when the OVER slot has an unavailable price", () => {
    const input = group("461", ["1.5", "u"], ["0", "1.51"]);
    const result = catalog(input);
    expect(result.markets).toHaveLength(1);
    expect(result.quotes.map(q => [q.selection, q.rawOdds])).toEqual([["UNDER", "1.51"]]);
    expect(native(input)?.nativeSelections?.map(s => s.price)).toEqual(["0", "1.51"]);
  });

  it("keeps Next Goal unmapped without an exact next-goal state contract", () => {
    const input = group("22", ["Đội Nhà", "Đội Khách", "Không có"], ["3.60", "3.55", "1.87"]);
    expect(catalog(input).markets).toEqual([]);
    expect(native(input)).toMatchObject({ disposition: "UNMAPPED", nativeType: "22" });
    expect(native(input)?.nativeSelections).toHaveLength(3);
  });

  it("preserves per-selection closed and suspended status without executable quotes", () => {
    const input = { ...group("462", ["1.5", "u"], ["2.38", "1.51"]),
      odds: group("462", [], ["2.38", "1.51"]).odds.map((o, i) =>
        ({ ...o, status: i === 0 ? "CLOSED" : "SUSPENDED" })) };
    expect(catalog(input).markets[0]?.status).toBe("SUSPENDED");
    expect(catalog(input).quotes.map(q => q.status)).toEqual(["CLOSED", "SUSPENDED"]);
  });
});
