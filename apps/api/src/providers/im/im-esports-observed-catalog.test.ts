import { describe, expect, it } from "vitest";
import { ImEsportsObservedCatalogReader } from "./im-esports-observed-catalog.js";

describe("ImEsportsObservedCatalogReader", () => {
  it("returns a live LoL catalog without exposing the launch URL", async () => {
    const reader = new ImEsportsObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume({
        sessionId: "im-lol", provider: "IM",
        withSecret: async (use) => use({ kind: "LAUNCH_URL", value: "https://private.test/?token=secret-canary" })
      }) },
      source: { readCatalog: async () => [{
        sportId: 45, sportName: "League of Legends", leagueId: 1, leagueName: "LCK",
        parentMatchNo: 10, parentHomeId: 1, parentHomeName: "G2", parentAwayId: 2, parentAwayName: "TH",
        parentDate: "2026-08-11T04:00:00-04:00", matchNo: 11, gameTypeCode: "SeriesWin",
        gameTypeName: "BO5 Series Win", marketGroup: "", gameOrder: 0, status: 1, isLive: false,
        matchDate: "2026-08-11T04:00:00-04:00", selections: [
          { code: 1, name: "{TeamA}", odds: 1.8, handicap: 0, locked: false },
          { code: 2, name: "{TeamB}", odds: 2.1, handicap: 0, locked: false }
        ]
      }] },
      clock: { now: () => ({ wallClockNowMs: 1_800_000_000_000, monotonicNowMs: 50 }) }
    });
    const catalog = await reader.read("account-1");
    expect(catalog).toMatchObject({ provider: "IM", category: "LOL", accountId: "account-1" });
    expect(catalog.markets).toEqual([expect.objectContaining({ marketType: "SERIES_WINNER" })]);
    expect(JSON.stringify(catalog)).not.toContain("secret-canary");
  });
});
