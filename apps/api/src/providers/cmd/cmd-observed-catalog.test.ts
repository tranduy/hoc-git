import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import { CmdObservedCatalogReader } from "./cmd-observed-catalog.js";

const handle: ActiveSecretHandle = {
  sessionId: "cmd-session",
  provider: "CMD",
  withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://private.test/launch?token=secret-canary" })
};

describe("CmdObservedCatalogReader", () => {
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

  it("returns only normalized live catalog evidence and marks one-provider rows non-comparable", async () => {
    const reader = new CmdObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume(handle) },
      source: { readCatalog: async () => [{
        sportId: "1", leagueId: "league-1", leagueName: "Premier Test", matchId: "match-1",
        timeText: "08/17 02:30AM", teamNames: ["Alpha", "Beta"], groups: [{
          betTypeIds: ["5"], labels: ["1", "X", "2"], odds: [
            { marketOddsId: "market-1", priceText: "2.1", status: null, greyedOut: null },
            { marketOddsId: "market-1", priceText: "3.2", status: null, greyedOut: null },
            { marketOddsId: "market-1", priceText: "3.4", status: null, greyedOut: null }
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
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "FT_1X2" })]);
    expect(result.quotes.map((quote) => quote.rawOdds)).toEqual(["2.1", "3.2", "3.4"]);
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

  it("quarantines one malformed market while retaining an exact sibling market", async () => {
    const reader = new CmdObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume(handle) },
      source: { readCatalog: async () => [{
        sportId: "1", leagueId: "l", leagueName: "League", matchId: "m", timeText: "1H27'",
        teamNames: ["A", "B"], groups: [
          { betTypeIds: ["3"], labels: [], odds: [
            { marketOddsId: "total", priceText: "0.8", status: null, greyedOut: null },
            { marketOddsId: "total", priceText: "-0.9", status: null, greyedOut: null }
          ] },
          { betTypeIds: ["5"], labels: [], odds: [
            { marketOddsId: "1x2", priceText: "2.1", status: null, greyedOut: null },
            { marketOddsId: "1x2", priceText: "3.2", status: null, greyedOut: null },
            { marketOddsId: "1x2", priceText: "3.4", status: null, greyedOut: null }
          ] }
        ]
      }] },
      clock: { now: () => ({ wallClockNowMs: 1_788_000_000_000, monotonicNowMs: 500 }) },
      timezoneOffsetMinutes: 420
    });

    const result = await reader.read("account-1");
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "FT_1X2" })]);
    expect(result.quotes).toHaveLength(3);
    expect(result.rejectedMarketCount).toBe(1);
  });
});
