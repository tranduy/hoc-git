import { describe, expect, it } from "vitest";
import { ApsportObservedCatalogReader } from "./apsport-observed-catalog.js";

describe("APSPORT observed catalog", () => {
  it("publishes only live two-outcome full-time half-line markets with exact settlement", async () => {
    const reader = new ApsportObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume({
        sessionId: "apsport-session", provider: "APSPORT", category: "FOOTBALL",
        withSecret: async (read) => read({ kind: "LAUNCH_URL", value: "https://sport.asportsb.com/launch" })
      }) },
      source: { readCatalog: async () => ({
        observedAtMs: 2_000, receivedMonotonicMs: 100,
        records: [{
          eventId: "5543972", leagueName: "Champions League", timeText: "Trực tiếp Hết hiệp 1",
          scoreText: "2 - 2", teamNames: ["Bodo Glimt", "St Gilloise"], markets: [{
            marketId: "5543972:FT_AH:-0.5", marketType: "FT_AH", lineText: "-0.5",
            selections: [
              { selectionId: "home", selection: "HOME", priceText: "0.90", locked: false, lineText: "-0.5" },
              { selectionId: "away", selection: "AWAY", priceText: "0.98", locked: false, lineText: "+0.5" }
            ]
          }]
        }]
      }) }
    });

    const catalog = await reader.read("apsport-account");
    expect(catalog).toMatchObject({ provider: "APSPORT", category: "FOOTBALL", rejectedMarketCount: 0 });
    expect(catalog.events[0]).toMatchObject({ participantA: "Bodo Glimt", participantB: "St Gilloise", isLive: true });
    expect(catalog.markets[0]).toMatchObject({
      provider: "APSPORT", marketType: "FT_AH", line: "-0.5",
      settlementProfile: "football-regulation-including-added-time"
    });
    expect(catalog.quotes).toHaveLength(2);
  });
});
