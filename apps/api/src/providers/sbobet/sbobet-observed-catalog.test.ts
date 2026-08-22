import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import { SbobetObservedCatalogReader } from "./sbobet-observed-catalog.js";

describe("SbobetObservedCatalogReader", () => {
  it("preserves the direct response receipt clock instead of making cached odds fresh", async () => {
    const handle: ActiveSecretHandle = {
      sessionId: "sbobet-session", provider: "SBOBET",
      withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://sbobet.test/launch" })
    };
    const record = {
      eventId: "5574638", leagueName: "League", timeText: "1H 29'", scoreText: "0 - 1",
      teamNames: ["Kairat", "Levski"], markets: [{
        marketId: "730078508161105", marketType: "FT_AH" as const, lineText: null,
        selections: [
          { selectionId: "55746380050009905h", selection: "HOME" as const, priceText: "-0.91", locked: false, lineText: "0.5" },
          { selectionId: "55746380050009905a", selection: "AWAY" as const, priceText: "0.79", locked: false, lineText: null }
        ]
      }]
    };
    const reader = new SbobetObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume(handle) },
      source: { readCatalog: async () => ({ records: [record], observedAtMs: 1234, receivedMonotonicMs: 56 }) },
      clock: { now: () => ({ wallClockNowMs: 9999, monotonicNowMs: 999 }) }
    });
    const result = await reader.read("sbobet-account");
    expect(result.observedAtMs).toBe(1234);
    expect(result.quotes).toHaveLength(2);
    expect(result.quotes.every((quote) => quote.receivedMonotonicMs === 56)).toBe(true);
  });
});
