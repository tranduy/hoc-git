import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";

function catalog(provider: "SABA" | "SBOBET", accountId: string, odds: readonly [string, string]): LiveCatalogResponse {
  const event: ProviderEvent = { provider, category: "FOOTBALL", providerEventId: accountId,
    competition: "Eliteserien", seasonStage: null, startAtUtcMs: 2_000_000,
    participantA: "Kristiansund BK", participantB: "Molde", eventScope: "REGULATION",
    bestOf: null, isLive: false, rematchCandidate: false, fixtureDiscriminator: null,
    isVirtual: false, sportVariant: "FOOTBALL", liveState: null };
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: accountId,
    providerMarketId: `${accountId}-total`, marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5",
    settlementProfile: "football-regulation-including-added-time", status: "OPEN" };
  const quotes: ProviderQuote[] = (["OVER", "UNDER"] as const).map((selection, index) => ({
    provider, category: "FOOTBALL", providerEventId: accountId, providerMarketId: market.providerMarketId,
    providerSelectionId: `${accountId}-${selection}`, marketType: "FT_TOTAL", scope: "FULL_TIME",
    selection, line: "2.5", rawOdds: odds[index]!, rawFormat: "DECIMAL", status: "OPEN", isLive: false,
    sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  }));
  return { dataMode: "LIVE", accountId, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", snapshotState: "FRESH", observedAtMs: 1,
    rejectedMarketCount: 0, events: [event], markets: [market], quotes };
}

describe("ComparisonWorkerEngine", () => {
  it("returns compact parity projections without cloning full catalogs back", () => {
    const saba = catalog("SABA", "saba-account", ["2.20", "1.80"]);
    const sbobet = catalog("SBOBET", "sbobet-account", ["2.10", "1.90"]);
    const engine = new ComparisonWorkerEngine();

    const output = engine.apply({ type: "RESET", generation: 1,
      catalogs: [saba, sbobet], staleAccountIds: [] });

    expect(output.generation).toBe(1);
    expect(output.displayEvents).toHaveLength(1);
    expect(output.freshEvents).toHaveLength(1);
    expect(output.displayEvents[0]).toMatchObject({
      providers: ["SABA", "SBOBET"], accountIds: ["saba-account", "sbobet-account"],
      providerEventIds: { SABA: "saba-account", SBOBET: "sbobet-account" },
      rows: [{ marketType: "FT_TOTAL", line: "2.5" }]
    });
    expect(output.displayEvents[0]).not.toHaveProperty("catalogs");
  });

  it("keeps stale catalogs in display output but excludes them from executable output", () => {
    const saba = catalog("SABA", "saba-account", ["2.20", "1.80"]);
    const sbobet = catalog("SBOBET", "sbobet-account", ["2.10", "1.90"]);
    const engine = new ComparisonWorkerEngine();
    engine.apply({ type: "RESET", generation: 1, catalogs: [saba, sbobet], staleAccountIds: [] });

    const stale = engine.apply({ type: "SET_STALE", generation: 2,
      accountId: "sbobet-account", stale: true });

    expect(stale.displayEvents[0]?.providers).toEqual(["SABA", "SBOBET"]);
    expect(stale.freshEvents[0]?.providers).toEqual(["SABA"]);
  });

  it("upserts and removes only the addressed account at the requested generation", () => {
    const engine = new ComparisonWorkerEngine();
    engine.apply({ type: "RESET", generation: 1,
      catalogs: [catalog("SABA", "saba-account", ["2.20", "1.80"])], staleAccountIds: [] });
    const added = engine.apply({ type: "UPSERT", generation: 2,
      catalog: catalog("SBOBET", "sbobet-account", ["2.10", "1.90"]), stale: false });
    expect(added.displayEvents[0]?.providers).toEqual(["SABA", "SBOBET"]);

    const removed = engine.apply({ type: "REMOVE", generation: 3, accountId: "saba-account" });
    expect(removed.generation).toBe(3);
    expect(removed.displayEvents[0]?.providers).toEqual(["SBOBET"]);
  });
});
