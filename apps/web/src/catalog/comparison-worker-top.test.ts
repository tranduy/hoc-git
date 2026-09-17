import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { buildComparisonEvents } from "./comparison.js";
import { selectTopRateProjections, selectTopRateWorkerOutput } from "./comparison-worker-top.js";
import type { LiveCatalogResponse } from "../api/catalog.js";

function event(provider: "SABA" | "SBOBET" | "CMD", id: string): ProviderEvent {
  return { provider, category: "FOOTBALL", providerEventId: id, competition: "League",
    seasonStage: null, startAtUtcMs: 1_700_000_000_000, participantA: `Home-${id}`,
    participantB: `Away-${id}`, eventScope: "REGULATION", bestOf: null, rematchCandidate: null,
    fixtureDiscriminator: null, isLive: false, isVirtual: false, sportVariant: null, liveState: null };
}

function market(provider: "SABA" | "SBOBET" | "CMD", id: string, line = "2.5"): ProviderMarket {
  return { provider, category: "FOOTBALL", providerEventId: id, providerMarketId: `${id}-m`,
    marketType: "FT_TOTAL", scope: "FULL_TIME", line, settlementProfile: "TOTAL", status: "OPEN" };
}

function quotes(provider: "SABA" | "SBOBET" | "CMD", id: string, over: string, under: string,
  line = "2.5"): ProviderQuote[] {
  return [
    { provider, category: "FOOTBALL", providerEventId: id, providerMarketId: `${id}-m`,
      providerSelectionId: `${id}-over`, marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER",
      line, rawOdds: over, rawFormat: "DECIMAL", status: "OPEN", isLive: false, sourceTimestampMs: 1,
      receivedMonotonicMs: 1, sequence: 1 },
    { provider, category: "FOOTBALL", providerEventId: id, providerMarketId: `${id}-m`,
      providerSelectionId: `${id}-under`, marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER",
      line, rawOdds: under, rawFormat: "DECIMAL", status: "OPEN", isLive: false, sourceTimestampMs: 1,
      receivedMonotonicMs: 1, sequence: 1 }
  ];
}

function catalog(provider: "SABA" | "SBOBET" | "CMD", entries: readonly {
  readonly id: string; readonly over: string; readonly under: string;
}[]): LiveCatalogResponse {
  return {
    dataMode: "LIVE", accountId: `catalog-source:${provider}:FOOTBALL`, provider, category: "FOOTBALL",
    comparisonState: "READY", snapshotState: "FRESH", observedAtMs: 1_000, rejectedMarketCount: 0,
    events: entries.map((entry) => event(provider, entry.id)),
    markets: entries.map((entry) => market(provider, entry.id)),
    quotes: entries.flatMap((entry) => quotes(provider, entry.id, entry.over, entry.under))
  };
}

describe("selectTopRateProjections", () => {
  it("keeps full counts while shipping only the highest-ROI tickets", () => {
    const weak = Array.from({ length: 30 }, (_unused, index) => ({
      id: `weak-${index}`, over: "1.90", under: "1.90"
    }));
    const strong = { id: "strong", over: "2.20", under: "2.20" };
    const saba = catalog("SABA", [...weak, strong]);
    const sbobet = catalog("SBOBET", [
      ...weak.map((entry) => ({ ...entry, over: "1.91", under: "1.91" })),
      { id: "strong", over: "2.25", under: "2.25" }
    ]);
    const projections = buildComparisonEvents([saba, sbobet]).map((item) => {
      const { catalogs: _catalogs, ...rest } = item;
      return { ...rest, accountIds: [saba.accountId, sbobet.accountId] };
    });
    expect(projections.length).toBeGreaterThan(20);
    const output = selectTopRateWorkerOutput(projections, projections, { limit: 5 });
    expect(output.comparisonCounts.matchedContractCount).toBeGreaterThan(20);
    expect(output.freshEvents.flatMap((item) => item.rows).length).toBeLessThanOrEqual(5);
    expect(output.freshEvents.some((item) => item.key.includes("strong") ||
      item.event.participantA.includes("strong") ||
      Object.values(item.providerEventIds).includes("strong"))).toBe(true);
  });

  it("does not drop a small projection set", () => {
    const saba = catalog("SABA", [{ id: "one", over: "2.10", under: "1.80" }]);
    const sbobet = catalog("SBOBET", [{ id: "one", over: "1.80", under: "2.10" }]);
    const projections = buildComparisonEvents([saba, sbobet]).map((item) => {
      const { catalogs: _catalogs, ...rest } = item;
      return { ...rest, accountIds: [saba.accountId, sbobet.accountId] };
    });
    expect(selectTopRateProjections(projections, 5)).toEqual(projections);
  });
});
