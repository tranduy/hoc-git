import { describe, expect, it } from "vitest";
import { normalizeCmdCatalog, observeNativeCmdMarkets, type CmdCatalogInputRecord } from "./cmd-normalizer.js";
const options = { observedAtMs: Date.UTC(2026, 8, 10), receivedMonotonicMs: 0, sequence: 0, timezoneOffsetMinutes: 480 };
const record = (family: "CORNERS" | "BOOKINGS", betType: string, prices: string[]): CmdCatalogInputRecord => ({
  sportId: "1", leagueId: "100", leagueName: `UEFA CHAMPIONS LEAGUE - ${family}`, matchId: "25429607", timeText: "09/11 03:30",
  teamNames: ["Fenerbahce", "AS Roma"].map(team => `${team} (${family === "CORNERS" ? "No. of Corners" : "Total Bookings"})`),
  groups: [{ betTypeIds: [betType], labels: betType.endsWith("5") ? ["HOME", "DRAW", "AWAY"] : ["ODD", "EVEN"], odds: prices.map((priceText, i) => ({
    marketOddsId: `25429607:native:${betType}`, selectionId: `native-${i}`, priceText,
    ...(betType.endsWith("5") ? { priceFormat: "DECIMAL" as const } : {}), status: "OPEN", greyedOut: "false"
  })) }]
});
describe("CMD named stat result and odd/even groups", () => {
  it.each([["5", "CORNER_FT_1X2", "FULL_TIME"], ["FH:5", "CORNER_FH_1X2", "FIRST_HALF"]])("maps %s corner results using their own decimal prices", (type, marketType, scope) => {
    const raw = record("CORNERS", type, ["1.35", "10", "3.6"]);
    const value = normalizeCmdCatalog([raw], options);
    expect(value.markets[0]).toMatchObject({ marketType, scope });
    expect(value.quotes.map(q => [q.selection, q.rawOdds, q.rawFormat])).toEqual([["HOME", "1.35", "DECIMAL"], ["DRAW", "10", "DECIMAL"], ["AWAY", "3.6", "DECIMAL"]]);
    expect(value.quotes.map(q => q.providerSelectionId)).toEqual(["native-0", "native-1", "native-2"]);
    expect(observeNativeCmdMarkets("CMD", [raw], options)[0]).toMatchObject({ disposition: "NORMALIZED", outcomeLabels: ["HOME", "DRAW", "AWAY"] });
    const closed = record("CORNERS", type, ["1.35", "-999", "3.6"]);
    expect(normalizeCmdCatalog([closed], options).quotes.map(q => q.selection)).toEqual(["HOME", "AWAY"]);
    const unknown = { ...raw, groups: raw.groups.map(g => ({ ...g, odds: g.odds.map(({ priceFormat: _format, ...odd }) => odd) })) };
    expect(normalizeCmdCatalog([unknown], options).quotes).toEqual([]);
    const duplicate = { ...raw, groups: raw.groups.map(g => ({ ...g, odds: g.odds.map(odd => ({ ...odd, selectionId: "same" })) })) };
    expect(normalizeCmdCatalog([duplicate], options).quotes).toEqual([]);
  });
  it.each([["MAIN:2", "CARD_FT_ODD_EVEN"], ["FH:2", "CARD_FH_ODD_EVEN"]])("maps named %s booking parity without treating it as goals", (type, marketType) => {
    const raw = record("BOOKINGS", type, ["-0.99", "0.87"]);
    expect(normalizeCmdCatalog([raw], options).markets[0]).toMatchObject({ marketType });
    expect(observeNativeCmdMarkets("CMD", [raw], options)[0]).toMatchObject({ disposition: "NORMALIZED", outcomeLabels: ["ODD", "EVEN"] });
    expect(normalizeCmdCatalog([{ ...raw, groups: [{ ...raw.groups[0]!, labels: ["1", "2"] }] }], options).quotes).toEqual([]);
    expect(normalizeCmdCatalog([{ ...raw, groups: [{ ...raw.groups[0]!, normalizationBlockReason: "NATIVE_MR_ODDS_UNPROVEN" }] }], options).quotes).toEqual([]);
  });
});
