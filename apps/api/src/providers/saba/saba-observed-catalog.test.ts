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
      clock: { now: () => ({ wallClockNowMs: 1_788_000_000_000, monotonicNowMs: 500 }) }
    });

    await expect(reader.read("saba-account")).rejects.toThrow("SABA_FOOTBALL_CATALOG_SCHEMA_ERROR");
  });

  it("reads and labels a live SABA catalog without exposing the launch secret", async () => {
    const handle: ActiveSecretHandle = {
      sessionId: "saba-session", provider: "SABA",
      withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://saba.test/launch?token=secret-canary" })
    };
    let requestedCategory: string | undefined;
    const reader = new SabaObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, provider, consume, category) => {
        expect(provider).toBe("SABA");
        requestedCategory = category;
        return consume(handle);
      } },
      source: { readCatalog: async () => [
        { type: "l", leagueid: "league", leaguenameen: "Eliteserien", sporttype: 1 },
        { type: "m", matchid: "match", leagueid: "league", hteamnameen: "Kristiansund BK",
          ateamnameen: "Molde", kickofftime: 1_788_000_000, marketid: "L", sporttype: 1 },
        { type: "o", oddsid: "handicap", matchid: "match", bettype: 1, parenttypeid: 1,
          oddsstatus: "running", enable: 1, odds1a: -0.85, odds2a: 0.69, hdp1: 0, hdp2: 0.5 }
      ] },
      clock: { now: () => ({ wallClockNowMs: 1_788_000_000_000, monotonicNowMs: 500 }) }
    });
    const result = await reader.read("saba-account");
    expect(result.provider).toBe("SABA");
    expect(requestedCategory).toBe("FOOTBALL");
    expect(result.events[0]).toMatchObject({ provider: "SABA", participantA: "Kristiansund BK", participantB: "Molde" });
    expect(result.markets[0]).toMatchObject({ provider: "SABA", marketType: "FT_AH", line: "0.5" });
    expect(JSON.stringify(result)).not.toMatch(/secret-canary|saba\.test/iu);
  });
});
