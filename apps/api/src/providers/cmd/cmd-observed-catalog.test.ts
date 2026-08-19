import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import { CmdObservedCatalogReader } from "./cmd-observed-catalog.js";

const handle: ActiveSecretHandle = {
  sessionId: "cmd-session",
  provider: "CMD",
  withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://private.test/launch?token=secret-canary" })
};

describe("CmdObservedCatalogReader", () => {
  it("reads CMD from the current Fabet page without requiring a stale one-time launch handle", async () => {
    const reader = new CmdObservedCatalogReader({
      jitSource: { readCatalogFromFabet: async () => ({ records: [{
        sportId: "1", leagueId: "l", leagueName: "League", matchId: "m", timeText: "1H27'",
        teamNames: ["Alpha", "Beta"], groups: []
      }], observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 500 }) },
      clock: { now: () => ({ wallClockNowMs: 9, monotonicNowMs: 9 }) },
      timezoneOffsetMinutes: 420
    });

    await expect(reader.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({
      provider: "CMD", category: "FOOTBALL", observedAtMs: 1_788_000_000_000,
      events: [expect.objectContaining({ participantA: "Alpha", participantB: "Beta" })]
    });
  });

  it("binds account access and normalized output to the configured provider", async () => {
    let requestedProvider = "";
    const sabaHandle: ActiveSecretHandle = { ...handle, provider: "SABA" };
    const reader = new CmdObservedCatalogReader({
      provider: "SABA",
      accounts: { withActiveHandle: async (_id, provider, consume) => {
        requestedProvider = provider;
        return consume(sabaHandle);
      } },
      source: { readCatalog: async () => [{
        sportId: "1", leagueId: "l", leagueName: "League", matchId: "m", timeText: "1H27'",
        teamNames: ["A", "B"], groups: []
      }] },
      clock: { now: () => ({ wallClockNowMs: 1_788_000_000_000, monotonicNowMs: 500 }) },
      timezoneOffsetMinutes: 420
    });
    const result = await reader.read("account-1");
    expect(requestedProvider).toBe("SABA");
    expect(result.provider).toBe("SABA");
    expect(result.events[0]?.provider).toBe("SABA");
  });

  it("returns only normalized half-goal handicap evidence and marks one-provider rows non-comparable", async () => {
    const reader = new CmdObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume(handle) },
      source: { readCatalog: async () => [{
        sportId: "1", leagueId: "league-1", leagueName: "Premier Test", matchId: "match-1",
        timeText: "08/17 02:30AM", teamNames: ["Alpha", "Beta"], groups: [{
          betTypeIds: ["1"], labels: ["0.5"], odds: [
            { marketOddsId: "market-1", priceText: "0.8", status: null, greyedOut: null, lineText: "0.5" },
            { marketOddsId: "market-1", priceText: "-0.9", status: null, greyedOut: null, lineText: null }
          ]
        }]
      }] },
      clock: { now: () => ({ wallClockNowMs: 1_788_000_000_000, monotonicNowMs: 500 }) },
      timezoneOffsetMinutes: 420
    });

    const result = await reader.read("account-1");
    expect(result).toMatchObject({
      dataMode: "LIVE", accountId: "account-1", provider: "CMD", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1_788_000_000_000
    });
    expect(result.events).toEqual([expect.objectContaining({ participantA: "Alpha", participantB: "Beta" })]);
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "FT_AH", line: "0.5" })]);
    expect(result.quotes.map((quote) => quote.rawOdds)).toEqual(["0.8", "-0.9"]);
    expect(JSON.stringify(result)).not.toMatch(/secret-canary|private\.test|launch\?/u);
  });

  it("fails closed when any supported CMD record is malformed", async () => {
    const reader = new CmdObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume(handle) },
      source: { readCatalog: async () => [{
        sportId: "1", leagueId: "l", leagueName: "League", matchId: "m", timeText: "bad-time",
        teamNames: ["A", "B"], groups: []
      }] },
      clock: { now: () => ({ wallClockNowMs: 1_788_000_000_000, monotonicNowMs: 500 }) },
      timezoneOffsetMinutes: 420
    });

    await expect(reader.read("account-1")).rejects.toThrow("CMD_CATALOG_SCHEMA_ERROR");
  });

  it("retains exact full-time totals and quarter, half, and three-quarter handicaps while excluding 1X2", async () => {
    const reader = new CmdObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume(handle) },
      source: { readCatalog: async () => [{
        sportId: "1", leagueId: "l", leagueName: "League", matchId: "m", timeText: "1H27'",
        teamNames: ["A", "B"], groups: [
          { betTypeIds: ["3"], labels: ["2.5"], odds: [
            { marketOddsId: "total", priceText: "0.8", status: null, greyedOut: null },
            { marketOddsId: "total", priceText: "-0.9", status: null, greyedOut: null }
          ] },
          { betTypeIds: ["5"], labels: [], odds: [
            { marketOddsId: "1x2", priceText: "2.1", status: null, greyedOut: null },
            { marketOddsId: "1x2", priceText: "3.2", status: null, greyedOut: null },
            { marketOddsId: "1x2", priceText: "3.4", status: null, greyedOut: null }
          ] },
          { betTypeIds: ["1"], labels: ["0/0.5"], odds: [
            { marketOddsId: "quarter", priceText: "0.7", status: null, greyedOut: null, lineText: "0/0.5" },
            { marketOddsId: "quarter", priceText: "-0.8", status: null, greyedOut: null, lineText: null }
          ] },
          { betTypeIds: ["1"], labels: ["0.5"], odds: [
            { marketOddsId: "half", priceText: "0.8", status: null, greyedOut: null, lineText: "0.5" },
            { marketOddsId: "half", priceText: "-0.9", status: null, greyedOut: null, lineText: null }
          ] },
          { betTypeIds: ["1"], labels: ["0.5/1"], odds: [
            { marketOddsId: "three-quarter", priceText: "0.76", status: null, greyedOut: null, lineText: "0.5/1" },
            { marketOddsId: "three-quarter", priceText: "-0.86", status: null, greyedOut: null, lineText: null }
          ] }
        ]
      }] },
      clock: { now: () => ({ wallClockNowMs: 1_788_000_000_000, monotonicNowMs: 500 }) },
      timezoneOffsetMinutes: 420
    });

    const result = await reader.read("account-1");
    expect(result.markets).toEqual([
      expect.objectContaining({ providerMarketId: "total", marketType: "FT_TOTAL", line: "2.5" }),
      expect.objectContaining({ providerMarketId: "quarter", marketType: "FT_AH", line: "0.25" }),
      expect.objectContaining({ providerMarketId: "half", marketType: "FT_AH", line: "0.5" }),
      expect.objectContaining({ providerMarketId: "three-quarter", marketType: "FT_AH", line: "0.75" })
    ]);
    expect(result.quotes).toHaveLength(8);
    expect(result.rejectedMarketCount).toBe(0);
  });

  it("retains an exact full-time half-goal handicap market", async () => {
    const reader = new CmdObservedCatalogReader({
      provider: "SABA",
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume({ ...handle, provider: "SABA" }) },
      source: { readCatalog: async () => [{
        sportId: "1", leagueId: "l", leagueName: "Allsvenskan", matchId: "m", timeText: "1H41'",
        teamNames: ["IK Sirius", "Brommapojkarna"], groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
          { marketOddsId: "ah", priceText: "0.79", status: null, greyedOut: null, lineText: "0.5" },
          { marketOddsId: "ah", priceText: "-0.87", status: null, greyedOut: null, lineText: null }
        ] }]
      }] },
      clock: { now: () => ({ wallClockNowMs: 1_788_000_000_000, monotonicNowMs: 500 }) },
      timezoneOffsetMinutes: 420
    });

    const result = await reader.read("saba-account");
    expect(result.markets).toEqual([expect.objectContaining({ provider: "SABA", marketType: "FT_AH", line: "0.5" })]);
    expect(result.quotes.map((quote) => quote.selection)).toEqual(["HOME", "AWAY"]);
  });
});
