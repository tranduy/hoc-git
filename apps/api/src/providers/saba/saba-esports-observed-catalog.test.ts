import { describe, expect, it } from "vitest";
import { SabaEsportsObservedCatalogReader } from "./saba-esports-observed-catalog.js";

describe("SabaEsportsObservedCatalogReader", () => {
  it("returns a live LoL catalog without exposing the launch URL", async () => {
    let requestedCategory: string | undefined;
    const reader = new SabaEsportsObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume, category) => {
        requestedCategory = category;
        return consume({ sessionId: "saba-lol", provider: "SABA",
          withSecret: async (use) => use({ kind: "LAUNCH_URL", value: "https://private.test/?token=secret-canary" }) });
      } },
      source: { readCatalog: async () => [
        { type: "l", leagueid: 99, leaguegroupid: 25, leaguenameen: "League of Legends - LCK" },
        { type: "m", matchid: 10, leagueid: 99, hteamnameen: "G2", ateamnameen: "TH",
          kickofftime: 1_800_000_000, marketid: "T", bestofmap: 5 },
        { type: "o", oddsid: "series", matchid: 10, bettype: 20, oddsstatus: "running", odds1a: -0.5, odds2a: 0.4 }
      ] },
      clock: { now: () => ({ wallClockNowMs: 1_800_000_000_000, monotonicNowMs: 50 }) }
    });

    const catalog = await reader.read("account-1");
    expect(catalog).toMatchObject({ provider: "SABA", category: "LOL", accountId: "account-1" });
    expect(requestedCategory).toBe("LOL");
    expect(catalog.markets).toEqual([expect.objectContaining({ marketType: "SERIES_WINNER" })]);
    expect(JSON.stringify(catalog)).not.toContain("secret-canary");
  });
});
