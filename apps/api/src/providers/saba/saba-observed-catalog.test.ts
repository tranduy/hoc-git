import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import { SabaObservedCatalogReader } from "./saba-observed-catalog.js";

describe("SabaObservedCatalogReader", () => {
  it("rejects an empty transient browser snapshot instead of publishing zero events", async () => {
    const handle: ActiveSecretHandle = {
      sessionId: "saba-session", provider: "SABA",
      withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://saba.test/launch" })
    };
    const reader = new SabaObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume(handle) },
      source: { readCatalog: async () => [] },
      clock: { now: () => ({ wallClockNowMs: 1_788_000_000_000, monotonicNowMs: 500 }) },
      timezoneOffsetMinutes: 420
    });

    await expect(reader.read("saba-account")).rejects.toThrow("CMD_CATALOG_UNAVAILABLE");
  });

  it("reads and labels a live SABA catalog without exposing the launch secret", async () => {
    const handle: ActiveSecretHandle = {
      sessionId: "saba-session", provider: "SABA",
      withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://saba.test/launch?token=secret-canary" })
    };
    const reader = new SabaObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, provider, consume) => {
        expect(provider).toBe("SABA");
        return consume(handle);
      } },
      source: { readCatalog: async () => [{
        sportId: "1", leagueId: "league", leagueName: "Eliteserien", matchId: "match",
        timeText: "2H37'", teamNames: ["Kristiansund BK", "Molde"], groups: [{
          betTypeIds: ["1"], labels: ["0.5"], odds: [
            { marketOddsId: "handicap", priceText: "-0.85", status: null, greyedOut: "false", lineText: "0.5" },
            { marketOddsId: "handicap", priceText: "0.69", status: null, greyedOut: "false", lineText: null }
          ]
        }]
      }] },
      clock: { now: () => ({ wallClockNowMs: 1_788_000_000_000, monotonicNowMs: 500 }) },
      timezoneOffsetMinutes: 420
    });
    const result = await reader.read("saba-account");
    expect(result.provider).toBe("SABA");
    expect(result.events[0]).toMatchObject({ provider: "SABA", participantA: "Kristiansund BK", participantB: "Molde" });
    expect(result.markets[0]).toMatchObject({ provider: "SABA", marketType: "FT_AH", line: "-0.5" });
    expect(JSON.stringify(result)).not.toMatch(/secret-canary|saba\.test/iu);
  });
});
