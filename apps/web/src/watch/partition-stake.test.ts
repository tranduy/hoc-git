import { describe, expect, it } from "vitest";
import type { ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { ComparisonCell, ComparisonRow } from "../catalog/comparison.js";
import { buildFixedBaseStakePlan, buildObservedFixedBaseStakeEstimate,
  type FixedBaseStakePolicy } from "./fixed-base-stake.js";

const policy: FixedBaseStakePolicy = {
  currency: "VND", baseStake: "100", minStake: "10", maxStake: "10000",
  stakeStep: "1", balance: "100000"
};

const cell = (provider: "SABA" | "SBOBET" | "CMD",
  odds: Readonly<Record<"HOME" | "DRAW" | "AWAY", string>>): ComparisonCell => {
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: `${provider}-event`,
    providerMarketId: `${provider}-corner`, marketType: "CORNER_FT_1X2", scope: "FULL_TIME",
    line: null, settlementProfile: "football-corners-regulation", status: "OPEN" };
  const quotes: ProviderQuote[] = (["HOME", "DRAW", "AWAY"] as const).map((selection) => ({
    provider, category: "FOOTBALL", providerEventId: market.providerEventId,
    providerMarketId: market.providerMarketId, providerSelectionId: `${provider}-${selection}`,
    marketType: "CORNER_FT_1X2", scope: "FULL_TIME", selection, line: null,
    rawOdds: odds[selection], rawFormat: "DECIMAL", status: "OPEN", isLive: false,
    sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  }));
  return { provider, market, quotes } as ComparisonCell;
};

const row = (cells: readonly ComparisonCell[]): ComparisonRow => ({
  key: "corner-row", marketType: "CORNER_FT_1X2", scope: "FULL_TIME", line: null,
  cells, crossBook: true, margin: null, bestBySelection: {}
} as ComparisonRow);

const providers: ReadonlySet<ProviderId> = new Set<ProviderId>(["SABA", "SBOBET", "CMD"]);

describe("three-leg stakes for a partition market", () => {
  it("buys the same payout on every outcome and reports one profit", () => {
    // 1/4.1 + 1/4.2 + 1/4.3 < 1, so a leg on each pays whatever happens.
    const plan = buildFixedBaseStakePlan(row([
      cell("SABA", { HOME: "4.10", DRAW: "3.10", AWAY: "2.20" }),
      cell("SBOBET", { HOME: "2.30", DRAW: "4.20", AWAY: "2.50" }),
      cell("CMD", { HOME: "2.40", DRAW: "3.00", AWAY: "4.30" })
    ]), providers, policy);

    expect(plan).not.toBeNull();
    expect(plan!.legs).toHaveLength(3);
    expect(plan!.legs.map((leg) => [leg.provider, leg.selection])).toEqual([
      ["CMD", "AWAY"], ["SBOBET", "DRAW"], ["SABA", "HOME"]
    ]);
    // Every outcome pays, so the worst case is a profit and the ROI is positive.
    expect(Number(plan!.worstCaseProfit)).toBeGreaterThan(0);
    expect(Number(plan!.roi)).toBeGreaterThan(0);
    // Each leg is priced to buy roughly the same payout.
    const payouts = plan!.legs.map((leg) => Number(leg.payout));
    expect(Math.max(...payouts) - Math.min(...payouts)).toBeLessThan(Math.min(...payouts) * 0.02);
    expect(Object.keys(plan!.profitsBySelection).sort()).toEqual(["AWAY", "DRAW", "HOME"]);
  });

  it("refuses a losing book sum when a profit is required, and still estimates it", () => {
    const losing = row([
      cell("SABA", { HOME: "2.10", DRAW: "3.00", AWAY: "3.00" }),
      cell("SBOBET", { HOME: "2.00", DRAW: "3.10", AWAY: "3.10" })
    ]);
    expect(buildFixedBaseStakePlan(losing, providers, policy)).toBeNull();
    const estimate = buildObservedFixedBaseStakeEstimate(losing, providers, policy);
    expect(estimate).not.toBeNull();
    expect(Number(estimate!.worstCaseProfit)).toBeLessThan(0);
  });

  it("refuses a ticket one book could fill on its own", () => {
    expect(buildFixedBaseStakePlan(row([
      cell("SABA", { HOME: "4.10", DRAW: "4.20", AWAY: "4.30" }),
      cell("SBOBET", { HOME: "2.00", DRAW: "2.00", AWAY: "2.00" })
    ]), providers, policy)).toBeNull();
  });

  it("refuses a book that does not price every outcome of the market", () => {
    // A book quoting two of three outcomes is not offering this market, and a
    // leg drawn from it would leave the third outcome uncovered.
    const partial = cell("CMD", { HOME: "2.40", DRAW: "3.00", AWAY: "4.30" });
    const missingDraw = { ...partial,
      quotes: partial.quotes.filter((quote) => quote.selection !== "DRAW") } as ComparisonCell;
    expect(buildFixedBaseStakePlan(row([
      cell("SABA", { HOME: "4.10", DRAW: "3.10", AWAY: "2.20" }),
      missingDraw
    ]), providers, policy)).toBeNull();

    // With a third book carrying the whole market the ticket forms again.
    expect(buildFixedBaseStakePlan(row([
      cell("SABA", { HOME: "4.10", DRAW: "3.10", AWAY: "2.20" }),
      missingDraw,
      cell("SBOBET", { HOME: "2.30", DRAW: "4.20", AWAY: "2.50" })
    ]), providers, policy)).not.toBeNull();
  });

  it("keeps every stake on its provider's step and inside its limits", () => {
    const stepped = buildFixedBaseStakePlan(row([
      cell("SABA", { HOME: "4.10", DRAW: "3.10", AWAY: "2.20" }),
      cell("SBOBET", { HOME: "2.30", DRAW: "4.20", AWAY: "2.50" }),
      cell("CMD", { HOME: "2.40", DRAW: "3.00", AWAY: "4.30" })
    ]), providers, { ...policy, stakeStep: "5", minStake: "25" });
    expect(stepped).not.toBeNull();
    for (const leg of stepped!.legs) {
      expect(Number(leg.stake) % 5).toBe(0);
      expect(Number(leg.stake)).toBeGreaterThanOrEqual(25);
    }
  });
});
