import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { NativeMarketObservation } from "@tool-chenh/contracts";
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

  it("marks native evidence excluded when the advertised normalized market is rejected", async () => {
    const handle: ActiveSecretHandle = {
      sessionId: "sbobet-session", provider: "SBOBET",
      withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://sbobet.test/launch" })
    };
    const observations: readonly NativeMarketObservation[] = ["30001", "30002"].map((marketId) => ({
      provider: "SBOBET", category: "FOOTBALL", providerEventId: "5574638", providerMarketId: marketId,
      nativeType: "3", nativeLabel: null, nativeScope: "FULL_TIME", outcomeLabels: ["H", "A"],
      observedAtMs: 1234, disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED"
    }));
    const reader = new SbobetObservedCatalogReader({
      accounts: { withActiveHandle: async (_id, _provider, consume) => consume(handle) },
      source: { readCatalog: async () => ({
        observedAtMs: 1234, receivedMonotonicMs: 56, nativeMarketObservations: observations,
        records: [{ eventId: "5574638", leagueName: "League", timeText: "PREMATCH", scoreText: null,
          startAtUtcMs: 9999, teamNames: ["Kairat", "Levski"], markets: [
            { marketId: "30001", marketType: "FT_TOTAL", lineText: "2.5", selections: [
              { selectionId: "301h", selection: "OVER", priceText: "0.93", locked: false },
              { selectionId: "301a", selection: "UNDER", priceText: "-0.91", locked: false }
            ] },
            { marketId: "30002", marketType: "FT_TOTAL", lineText: "3.5", selections: [
              { selectionId: "302h", selection: "OVER", priceText: "1.51", locked: false },
              { selectionId: "302a", selection: "UNDER", priceText: "-0.91", locked: false }
            ] }
          ] }]
      }) },
      clock: { now: () => ({ wallClockNowMs: 9999, monotonicNowMs: 999 }) }
    });

    const result = await reader.read("sbobet-account");

    expect(result.markets.map((market) => market.providerMarketId)).toEqual(["30001"]);
    expect(result.rejectedMarketCount).toBe(1);
    expect(result.nativeMarketObservations).toEqual([
      observations[0], { ...observations[1], disposition: "EXCLUDED", reason: "NORMALIZATION_REJECTED" }
    ]);
    expect(observations[1]?.disposition).toBe("NORMALIZED");
  });
});
