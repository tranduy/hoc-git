import { describe, expect, it } from "vitest";
import { normalizeObservedFootballCatalog, observeNativeCmdMarkets, type CmdCatalogInputRecord } from "./cmd-normalizer.js";

const options = { observedAtMs: Date.UTC(2026, 8, 9, 11, 57), receivedMonotonicMs: 3224530,
  timezoneOffsetMinutes: 480, sequence: 17 };
const record: CmdCatalogInputRecord = { sportId: "1", leagueId: "japan-cup", leagueName: "JAPAN EMPEROR CUP",
  matchId: "25426567", timeText: "LIVE", teamNames: ["AC Nagano Parceiro", "Mito Hollyhock"], groups: [
    { betTypeIds: ["3"], labels: ["0.5"], odds: ["0.64", "-0.78"].map(priceText => ({
      marketOddsId: "25426777:3", priceText, status: "OPEN", greyedOut: "false" })) }
  ] };

describe("observed football event settlement periods", () => {
  it.each([
    ["CMD", "ET", "EXTRA_TIME"], ["CMD", "PEN", "PENALTY_SHOOTOUT"],
    ["SABA", "Hiệp Phụ", "EXTRA_TIME"], ["SABA", "Luân Lưu", "PENALTY_SHOOTOUT"],
    ["SABA", "Hiep Phu", "EXTRA_TIME"], ["SABA", "Luan Luu", "PENALTY_SHOOTOUT"]
  ] as const)("retains %s (%s) native prices without assigning regulation settlement", (provider, suffix, eventScope) => {
    const input = { ...record, teamNames: record.teamNames.map(team => `${team} (${suffix})`) };
    const value = normalizeObservedFootballCatalog(provider, [input], options);
    expect(value.events).toHaveLength(1);
    expect(value.events[0]).toMatchObject({ providerEventId: record.matchId, eventScope,
      participantA: input.teamNames[0], participantB: input.teamNames[1] });
    expect(value.markets).toEqual([]);
    expect(value.quotes).toEqual([]);
    expect(value.diagnostics).toContain("EVENT_PERIOD_SETTLEMENT_UNSUPPORTED");
    expect(observeNativeCmdMarkets(provider, [input], options)).toEqual([
      expect.objectContaining({ providerEventId: record.matchId, providerMarketId: "25426777:3",
        nativeType: "3", nativeLabel: "0.5", nativeScope: "FULL_TIME", disposition: "EXCLUDED",
        reason: "EVENT_PERIOD_SETTLEMENT_UNSUPPORTED", observedAtMs: options.observedAtMs,
        nativeSelections: [expect.objectContaining({ price: "0.64", rawFormat: "MALAY", status: "OPEN" }),
          expect.objectContaining({ price: "-0.78", rawFormat: "MALAY", status: "OPEN" })] })
    ]);
  });

  it.each([["ET", ""], ["ET", "PEN"], ["", "Luân Lưu"]])(
    "retains ambiguous phase markers %s/%s without comparing them", (home, away) => {
      const input = { ...record, teamNames: record.teamNames.map((team, index) =>
        `${team}${[home, away][index] ? ` (${[home, away][index]})` : ""}`) };
      const value = normalizeObservedFootballCatalog("CMD", [input], options);
      expect(value.events[0]?.eventScope).toBe("UNKNOWN");
      expect(value.quotes).toEqual([]);
      expect(observeNativeCmdMarkets("CMD", [input], options)[0])
        .toMatchObject({ disposition: "EXCLUDED", reason: "EVENT_PERIOD_SETTLEMENT_UNSUPPORTED" });
    });

  it("keeps unmarked regulation and ordinary team-name substrings unchanged", () => {
    const value = normalizeObservedFootballCatalog("CMD", [{ ...record,
      teamNames: ["ET United", "Pen FC"] }], options);
    expect(value.events[0]?.eventScope).toBe("REGULATION");
    expect(value.markets[0]).toMatchObject({ marketType: "FT_TOTAL", line: "0.5",
      settlementProfile: "football-regulation-including-added-time" });
    expect(value.quotes.map(quote => quote.rawOdds)).toEqual(["0.64", "-0.78"]);
  });
});
