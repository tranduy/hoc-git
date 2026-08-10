import type { ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import type { ComparisonCell, ComparisonRow } from "../catalog/comparison.js";
import { buildFixedBaseStakePlan, type FixedBaseStakePolicy } from "./fixed-base-stake.js";

const selected = new Set<ProviderId>(["SABA", "SBOBET"]);
const policy: FixedBaseStakePolicy = {
  currency: "VND", baseStake: "100000", minStake: "30000",
  maxStake: "100000", stakeStep: "1000", balance: "100000"
};

function cell(provider: "SABA" | "SBOBET", marketType: "FT_TOTAL" | "FT_1X2",
  prices: Readonly<Record<string, string>>, status: "OPEN" | "SUSPENDED" = "OPEN"): ComparisonCell {
  const providerEventId = `${provider}-event`;
  const providerMarketId = `${provider}-${marketType}`;
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId, providerMarketId,
    marketType, scope: "FULL_TIME", line: marketType === "FT_TOTAL" ? "2.5" : null,
    settlementProfile: "football-regulation-including-added-time", status };
  const quotes: ProviderQuote[] = Object.entries(prices).map(([selection, rawOdds]) => ({
    provider, category: "FOOTBALL", providerEventId, providerMarketId,
    providerSelectionId: `${provider}-${selection}`, marketType, scope: "FULL_TIME", selection,
    line: market.line, rawOdds, rawFormat: "DECIMAL", status, isLive: true,
    sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  }));
  return { provider, market, quotes };
}

function row(marketType: "FT_TOTAL" | "FT_1X2", cells: readonly ComparisonCell[]): ComparisonRow {
  return { key: `${marketType}|FULL_TIME|2.5|settlement`, marketType, scope: "FULL_TIME",
    line: marketType === "FT_TOTAL" ? "2.5" : null, cells, bestBySelection: {}, margin: null, crossBook: true };
}

describe("fixed-base two-way stake planning", () => {
  it("fixes 100000 on odds 1.8 and balances odds 2.5 with 72000", () => {
    const plan = buildFixedBaseStakePlan(row("FT_TOTAL", [
      cell("SABA", "FT_TOTAL", { OVER: "1.8", UNDER: "1.5" }),
      cell("SBOBET", "FT_TOTAL", { OVER: "1.7", UNDER: "2.5" })
    ]), selected, policy);

    expect(plan).toMatchObject({
      legs: [
        { provider: "SABA", selection: "OVER", decimalOdds: "1.8", stake: "100000", role: "BASE", profit: "8000" },
        { provider: "SBOBET", selection: "UNDER", decimalOdds: "2.5", stake: "72000", role: "HEDGE", profit: "8000" }
      ],
      totalStake: "172000", profitsBySelection: { OVER: "8000", UNDER: "8000" },
      worstCaseProfit: "8000", roi: "0.04651162790697674418604651162790697674419"
    });
  });

  it("rejects three outcomes even when their inverse sum is profitable", () => {
    expect(buildFixedBaseStakePlan(row("FT_1X2", [
      cell("SABA", "FT_1X2", { HOME: "4", DRAW: "4", AWAY: "2" }),
      cell("SBOBET", "FT_1X2", { HOME: "3", DRAW: "3", AWAY: "4" })
    ]), selected, policy)).toBeNull();
  });

  it.each([
    ["same provider", [cell("SABA", "FT_TOTAL", { OVER: "2.2", UNDER: "2.2" })]],
    ["not profitable after rounding", [cell("SABA", "FT_TOTAL", { OVER: "1.95" }), cell("SBOBET", "FT_TOTAL", { UNDER: "1.95" })]],
    ["suspended quote", [cell("SABA", "FT_TOTAL", { OVER: "2.2" }, "SUSPENDED"), cell("SBOBET", "FT_TOTAL", { UNDER: "2.2" })]]
  ])("rejects %s", (_name, cells) => {
    expect(buildFixedBaseStakePlan(row("FT_TOTAL", cells as readonly ComparisonCell[]), selected, policy)).toBeNull();
  });
});
