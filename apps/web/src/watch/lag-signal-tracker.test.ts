import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "../catalog/comparison.js";
import type { FixedBaseStakePolicy } from "./fixed-base-stake.js";
import { LagSignalTracker } from "./lag-signal-tracker.js";

const policy: FixedBaseStakePolicy = {
  currency: "VND", baseStake: "100000", minStake: "30000", maxStake: "100000", stakeStep: "1000", balance: "100000"
};
const providers = new Set<ProviderId>(["SABA", "SBOBET"]);

function catalog(provider: "SABA" | "SBOBET", odds: readonly [string, string], observedAtMs: number,
  statuses: readonly ["OPEN" | "SUSPENDED", "OPEN" | "SUSPENDED"] = ["OPEN", "OPEN"],
  sourceTimestampMs = observedAtMs): LiveCatalogResponse {
  const id = `${provider.toLowerCase()}-event`;
  const event: ProviderEvent = { provider, category: "FOOTBALL", providerEventId: id, competition: "Eliteserien",
    seasonStage: null, startAtUtcMs: 2_000_000, participantA: "Alpha", participantB: "Beta", eventScope: "REGULATION",
    bestOf: null, isLive: false, rematchCandidate: false, fixtureDiscriminator: null, isVirtual: false,
    sportVariant: "FOOTBALL", liveState: null };
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: id,
    providerMarketId: `${id}-ah`, marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5",
    settlementProfile: "football-regulation", status: "OPEN" };
  const quotes: ProviderQuote[] = (["HOME", "AWAY"] as const).map((selection, index) => ({
    provider, category: "FOOTBALL", providerEventId: id, providerMarketId: market.providerMarketId,
    providerSelectionId: `${id}-${selection}`, marketType: "FT_AH", scope: "FULL_TIME", selection, line: "-0.5",
    rawOdds: odds[index]!, rawFormat: "DECIMAL", status: statuses[index]!, isLive: false,
    sourceTimestampMs, receivedMonotonicMs: observedAtMs, sequence: observedAtMs
  }));
  return { dataMode: "LIVE", accountId: `${provider}-account`, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs, rejectedMarketCount: 0, events: [event], markets: [market], quotes };
}

function snapshot(saba: readonly [string, string], sbobet: readonly [string, string], observedAtMs: number,
  sabaStatuses?: readonly ["OPEN" | "SUSPENDED", "OPEN" | "SUSPENDED"]) {
  return buildComparisonEvents([catalog("SABA", saba, observedAtMs, sabaStatuses), catalog("SBOBET", sbobet, observedAtMs)]);
}

describe("LagSignalTracker", () => {
  it("publishes the opposing stale and repriced 2.20 legs on the first changed snapshot", () => {
    const tracker = new LagSignalTracker();
    expect(tracker.update(snapshot(["2.20", "1.70"], ["2.20", "1.70"], 1_000), providers, policy, 1_000)).toEqual([]);

    const signals = tracker.update(snapshot(["1.70", "2.20"], ["2.20", "1.70"], 1_100), providers, policy, 1_100);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.plan.legs.map((leg) => [leg.provider, leg.selection, leg.decimalOdds])).toEqual([
      ["SABA", "AWAY", "2.2"], ["SBOBET", "HOME", "2.2"]
    ]);
    expect(signals[0]?.movements.map((movement) =>
      [movement.provider, movement.selection, movement.previousDecimal, movement.currentDecimal])).toEqual([
      ["SABA", "HOME", "2.2", "1.7"], ["SABA", "AWAY", "1.7", "2.2"]
    ]);
    expect(signals[0]?.triggeredAtMs).toBe(1_100);
  });

  it("keeps a live signal while prices remain unchanged and removes it as soon as the edge disappears", () => {
    const tracker = new LagSignalTracker();
    tracker.update(snapshot(["2.20", "1.70"], ["2.20", "1.70"], 1_000), providers, policy, 1_000);
    expect(tracker.update(snapshot(["1.70", "2.20"], ["2.20", "1.70"], 1_100), providers, policy, 1_100)).toHaveLength(1);
    expect(tracker.update(snapshot(["1.70", "2.20"], ["2.20", "1.70"], 1_200), providers, policy, 1_200)).toHaveLength(1);
    expect(tracker.update(snapshot(["1.70", "2.20"], ["1.70", "2.20"], 1_300), providers, policy, 1_300)).toEqual([]);
  });

  it("fails closed when a selected leg suspends", () => {
    const tracker = new LagSignalTracker();
    tracker.update(snapshot(["2.20", "1.70"], ["2.20", "1.70"], 1_000), providers, policy, 1_000);
    expect(tracker.update(snapshot(["1.70", "2.20"], ["2.20", "1.70"], 1_100, ["OPEN", "SUSPENDED"]),
      providers, policy, 1_100)).toEqual([]);
  });

  it("does not publish unchanged initial or changed non-profitable prices", () => {
    const tracker = new LagSignalTracker();
    expect(tracker.update(snapshot(["1.80", "1.80"], ["1.80", "1.80"], 1_000), providers, policy, 1_000)).toEqual([]);
    expect(tracker.update(snapshot(["1.70", "1.90"], ["1.90", "1.70"], 1_100), providers, policy, 1_100)).toEqual([]);
  });

  it("rejects an otherwise profitable flip when either selected quote is stale", () => {
    const tracker = new LagSignalTracker(5_000);
    tracker.update(snapshot(["2.20", "1.70"], ["2.20", "1.70"], 10_000), providers, policy, 10_000);
    const staleSaba = catalog("SABA", ["1.70", "2.20"], 20_000, ["OPEN", "OPEN"], 10_000);
    const freshSbobet = catalog("SBOBET", ["2.20", "1.70"], 20_000);

    expect(tracker.update(buildComparisonEvents([staleSaba, freshSbobet]), providers, policy, 20_000)).toEqual([]);
  });

  it("does not publish a changed edge below the 20,000 VND worst-case threshold", () => {
    const tracker = new LagSignalTracker();
    tracker.update(snapshot(["2.05", "1.75"], ["2.05", "1.75"], 1_000), providers, policy, 1_000);

    expect(tracker.update(snapshot(["1.75", "2.05"], ["2.05", "1.75"], 1_100), providers, policy, 1_100)).toEqual([]);
  });
});
