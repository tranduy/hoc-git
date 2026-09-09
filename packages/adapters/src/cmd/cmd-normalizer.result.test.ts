import { describe, expect, it } from "vitest";
import { normalizeCmdCatalog, normalizeObservedFootballCatalog, observeNativeCmdMarkets, type CmdCatalogInputRecord } from "./cmd-normalizer.js";

const options = { observedAtMs: Date.UTC(2026, 8, 9), receivedMonotonicMs: 100, timezoneOffsetMinutes: 480, sequence: 1 };
const record = (type: string, labels: string[], prices: string[]): CmdCatalogInputRecord => ({
  sportId: "1", leagueId: "league", leagueName: "League", matchId: "event", timeText: "09/10 15:00",
  teamNames: ["Alpha", "Beta"], groups: [{ betTypeIds: [type], labels,
    odds: prices.map((priceText, index) => ({ marketOddsId: "result-market", selectionId: `native-${index}`,
      priceText, priceFormat: "DECIMAL", status: null, greyedOut: null })) }]
});

describe("CMD proven result prices", () => {
  it.each([["5", "FT_1X2", "FULL_TIME"], ["FH:5", "FH_1X2", "FIRST_HALF"]])(
    "preserves %s decimal prices by explicit outcome labels and native IDs", (code, type, scope) => {
      const input = record(code, ["AWAY", "DRAW", "HOME"], ["3.2", "3.1", "2.1"]);
      const result = normalizeCmdCatalog([input], options);
      expect(result.markets).toEqual([expect.objectContaining({ marketType: type, scope, line: null })]);
      expect(result.quotes.map(value => [value.providerSelectionId, value.selection, value.rawOdds, value.rawFormat]))
        .toEqual([["native-0", "AWAY", "3.2", "DECIMAL"], ["native-1", "DRAW", "3.1", "DECIMAL"], ["native-2", "HOME", "2.1", "DECIMAL"]]);
  });

  it("keeps a proved available leg when another result price is closed", () => {
    const result = normalizeCmdCatalog([record("5", ["HOME", "DRAW", "AWAY"], ["-999", "3.1", "0"])], options);
    expect(result.quotes.map(value => value.selection)).toEqual(["DRAW"]);
  });

  it("requires explicit odds format for double chance while retaining proven semantics", () => {
    const known = record("DOUBLE_CHANCE", ["X2", "1X", "12"], ["1.4", "1.3", "1.2"]);
    expect(normalizeCmdCatalog([known], options).quotes.map(value => value.selection))
      .toEqual(["DRAW_AWAY", "HOME_DRAW", "HOME_AWAY"]);
    const unknown = { ...known, groups: known.groups.map(group => ({ ...group,
      odds: group.odds.map(({ priceFormat: _format, ...odd }) => odd) })) };
    expect(normalizeCmdCatalog([unknown], options).markets).toEqual([]);
    expect(observeNativeCmdMarkets("CMD", [unknown], options)).toEqual([expect.objectContaining({
      nativeScope: "FULL_TIME", outcomeLabels: ["DRAW_AWAY", "HOME_DRAW", "HOME_AWAY"],
      disposition: "EXCLUDED", reason: "NATIVE_ODDS_FORMAT_UNPROVEN", nativeSelections: expect.any(Array)
    })]);
  });

  it("never assigns unlabeled or duplicate result outcomes from price order", () => {
    for (const labels of [["unknown", "unknown", "unknown"], ["HOME", "HOME", "AWAY"]]) {
      const input = record("5", labels, ["2.1", "3.1", "3.2"]);
      expect(normalizeCmdCatalog([input], options).markets).toEqual([]);
      expect(observeNativeCmdMarkets("CMD", [input], options)[0]?.disposition).not.toBe("NORMALIZED");
    }
  });

  it("preserves explicitly labeled SABA DOM result semantics without borrowing CMD native type meanings", () => {
    expect(normalizeObservedFootballCatalog("SABA", [record("15", ["DRAW"], ["2.1"])], options).quotes)
      .toEqual([expect.objectContaining({ marketType: "FH_1X2", selection: "DRAW", rawFormat: "DECIMAL" })]);
    expect(normalizeCmdCatalog([record("15", ["DRAW"], ["2.1"])], options).markets).toEqual([]);
  });
});
