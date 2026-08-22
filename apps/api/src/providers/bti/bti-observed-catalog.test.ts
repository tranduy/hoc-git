import { describe, expect, it } from "vitest";
import { BtiObservedCatalogReader } from "./bti-observed-catalog.js";

describe("BTI observed catalog", () => {
  it("publishes exact live two-outcome full-time markets", async () => {
    const reader = new BtiObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume({ sessionId: "bti-session", provider: "BTI", category: "FOOTBALL",
        withSecret: async (read) => read({ kind: "LAUNCH_URL", value: "https://prod20091.fxf774.com/launch" }) }) },
      source: { readCatalog: async () => ({ observedAtMs: 2_000, receivedMonotonicMs: 100, records: [{
        eventId: "event-1", leagueName: "Champions League", timeText: "LIVE", scoreText: "1 - 0", teamNames: ["NEC", "Olympiakos"], markets: [{
          marketId: "market:-0.5", marketType: "FT_AH", lineText: "-0.5", selections: [
            { selectionId: "home", selection: "HOME", priceText: "0.82", locked: false, lineText: "-0.5" },
            { selectionId: "away", selection: "AWAY", priceText: "-0.92", locked: false, lineText: "+0.5" }
          ]
        }]
      }] }) }
    });
    const catalog = await reader.read("bti-account");
    expect(catalog).toMatchObject({ provider: "BTI", category: "FOOTBALL", rejectedMarketCount: 0 });
    expect(catalog.events[0]).toMatchObject({ participantA: "NEC", participantB: "Olympiakos", isLive: true });
    expect(catalog.markets[0]).toMatchObject({ provider: "BTI", marketType: "FT_AH", line: "-0.5", settlementProfile: "football-regulation-including-added-time" });
    expect(catalog.quotes).toHaveLength(2);
  });
});
