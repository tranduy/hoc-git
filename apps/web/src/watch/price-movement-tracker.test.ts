import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "../catalog/comparison.js";
import { PriceMovementTracker } from "./price-movement-tracker.js";

function catalog(provider: "SABA" | "IM", odds: readonly [string, string]): LiveCatalogResponse {
  const providerEventId = `${provider}-event`;
  const providerMarketId = `${provider}-market`;
  const event: ProviderEvent = { provider, category: "LOL", providerEventId, competition: "LCK CL", seasonStage: null,
    startAtUtcMs: 10_000, participantA: "Team One", participantB: "Team Two", eventScope: "SERIES", bestOf: 3,
    isLive: false, rematchCandidate: false, fixtureDiscriminator: null, gameVariant: "LOL", liveState: null };
  const market: ProviderMarket = { provider, category: "LOL", providerEventId, providerMarketId,
    marketType: "SERIES_WINNER", scope: "SERIES", line: null,
    settlementProfile: provider === "SABA" ? "saba-profile" : "im-profile", status: "OPEN" };
  const quotes: ProviderQuote[] = (["TEAM_A", "TEAM_B"] as const).map((selection, index) => ({ provider,
    category: "LOL", providerEventId, providerMarketId, providerSelectionId: `${provider}-${selection}`,
    marketType: "SERIES_WINNER", scope: "SERIES", selection, line: null, rawOdds: odds[index]!, rawFormat: "DECIMAL",
    status: "OPEN", isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1 }));
  return { dataMode: "LIVE", accountId: provider, provider, category: "LOL", comparisonState: "AWAITING_SECOND_PROVIDER",
    observedAtMs: 1, rejectedMarketCount: 0, events: [event], markets: [market], quotes };
}

describe("observed price movement tracker", () => {
  it("detects and ranks a real observed-ticket move even when settlement profiles differ", () => {
    const tracker = new PriceMovementTracker();
    expect(tracker.update(buildComparisonEvents([catalog("SABA", ["2.2", "1.7"]), catalog("IM", ["2.1", "1.8"])]), 1_000)).toEqual([]);

    const movements = tracker.update(buildComparisonEvents([
      catalog("SABA", ["1.7", "2.2"]), catalog("IM", ["2.1", "1.8"])
    ]), 1_100);

    expect(movements).toMatchObject([{ provider: "SABA", selection: "TEAM_A", previousDecimal: "2.2",
      currentDecimal: "1.7", magnitude: "0.5", changedAtMs: 1_100 }]);
  });

  it("expires old movements and removes rows that disappear", () => {
    const tracker = new PriceMovementTracker(100);
    const initial = buildComparisonEvents([catalog("SABA", ["2.2", "1.7"]), catalog("IM", ["2.1", "1.8"])]);
    tracker.update(initial, 1_000);
    expect(tracker.update(buildComparisonEvents([catalog("SABA", ["2", "1.9"]), catalog("IM", ["2.1", "1.8"])]), 1_050)).toHaveLength(1);
    expect(tracker.update([], 1_060)).toEqual([]);
    tracker.update(initial, 2_000);
    expect(tracker.update(buildComparisonEvents([catalog("SABA", ["2", "1.9"]), catalog("IM", ["2.1", "1.8"])]), 2_010)).toHaveLength(1);
    expect(tracker.update(buildComparisonEvents([catalog("SABA", ["2", "1.9"]), catalog("IM", ["2.1", "1.8"])]), 2_111)).toEqual([]);
  });
});
