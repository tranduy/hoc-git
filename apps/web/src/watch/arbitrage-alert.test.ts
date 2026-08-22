import type { ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import type { ComparisonCell, ComparisonRow } from "../catalog/comparison.js";
import { buildArbitrageAlert, DEFAULT_WATCH_STAKE_POLICY } from "./arbitrage-alert.js";

const providers = ["SABA", "SBOBET"] as const;

function cell(
  provider: (typeof providers)[number],
  marketType: "FT_TOTAL" | "FT_1X2",
  prices: Readonly<Record<string, string>>,
  status: "OPEN" | "SUSPENDED" = "OPEN"
): ComparisonCell {
  const providerEventId = `${provider}-event`;
  const providerMarketId = `${provider}-${marketType}`;
  const market: ProviderMarket = {
    provider, category: "FOOTBALL", providerEventId, providerMarketId, marketType,
    scope: "FULL_TIME", line: marketType === "FT_TOTAL" ? "2.5" : null,
    settlementProfile: "football-regulation-including-added-time", status
  };
  const quotes: ProviderQuote[] = Object.entries(prices).map(([selection, rawOdds]) => ({
    provider, category: "FOOTBALL", providerEventId, providerMarketId,
    providerSelectionId: `${provider}-${selection}`, marketType, scope: "FULL_TIME", selection,
    line: market.line, rawOdds, rawFormat: "DECIMAL", status, isLive: true,
    sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  }));
  return { provider, market, quotes };
}

function row(
  marketType: "FT_TOTAL" | "FT_1X2",
  cells: readonly ComparisonCell[]
): ComparisonRow {
  return {
    key: `${marketType}|FULL_TIME|${marketType === "FT_TOTAL" ? "2.5" : ""}|settlement`,
    marketType, scope: "FULL_TIME", line: marketType === "FT_TOTAL" ? "2.5" : null,
    cells, bestBySelection: {}, margin: 0.1, crossBook: true
  };
}

const selected = new Set<ProviderId>(providers);

describe("watched arbitrage alert planning", () => {
  it("builds an exact rounded two-outcome plan from two open books", () => {
    const alert = buildArbitrageAlert(row("FT_TOTAL", [
      cell("SABA", "FT_TOTAL", { OVER: "1.80", UNDER: "1.50" }),
      cell("SBOBET", "FT_TOTAL", { OVER: "1.70", UNDER: "2.50" })
    ]), selected, DEFAULT_WATCH_STAKE_POLICY);

    expect(alert).toMatchObject({
      marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", currency: "VND",
      totalStake: "172000", worstCasePayout: "180000", worstCaseProfit: "8000",
      roi: "0.04651162790697674418604651162790697674419",
      legs: [
        { provider: "SABA", selection: "OVER", decimalOdds: "1.8", stake: "100000" },
        { provider: "SBOBET", selection: "UNDER", decimalOdds: "2.5", stake: "72000" }
      ]
    });
    expect(alert?.fingerprint).toContain("SABA|OVER|SABA-OVER|1.8|100000");
    expect(alert?.fingerprint).toContain("SBOBET|UNDER|SBOBET-UNDER|2.5|72000");
  });

  it("rejects a complete three-outcome plan", () => {
    const alert = buildArbitrageAlert(row("FT_1X2", [
      cell("SABA", "FT_1X2", { HOME: "4.00", DRAW: "4.00", AWAY: "2.00" }),
      cell("SBOBET", "FT_1X2", { HOME: "3.00", DRAW: "3.00", AWAY: "4.00" })
    ]), selected, DEFAULT_WATCH_STAKE_POLICY);

    expect(alert).toBeNull();
  });

  it("converts Malay odds with exact decimal arithmetic before stake optimization", () => {
    const saba = cell("SABA", "FT_TOTAL", { OVER: "-0.93", UNDER: "0.70" });
    const sbobet = cell("SBOBET", "FT_TOTAL", { OVER: "0.70", UNDER: "-0.93" });
    const asMalay = (value: ComparisonCell): ComparisonCell => ({ ...value,
      quotes: value.quotes.map((quote) => ({ ...quote, rawFormat: "MALAY" as const })) });

    const alert = buildArbitrageAlert(row("FT_TOTAL", [asMalay(saba), asMalay(sbobet)]),
      selected, DEFAULT_WATCH_STAKE_POLICY);

    expect(alert?.legs.map((leg) => leg.decimalOdds)).toEqual([
      "2.075268817204301075268817204301075268817",
      "2.075268817204301075268817204301075268817"
    ]);
  });

  it.each([
    ["single provider", [cell("SABA", "FT_TOTAL", { OVER: "2.20", UNDER: "2.20" })], selected],
    ["missing outcome", [cell("SABA", "FT_TOTAL", { OVER: "2.20" }), cell("SBOBET", "FT_TOTAL", { OVER: "2.10" })], selected],
    ["suspended leg", [cell("SABA", "FT_TOTAL", { OVER: "2.20" }, "SUSPENDED"), cell("SBOBET", "FT_TOTAL", { UNDER: "2.20" })], selected],
    ["filtered provider", [cell("SABA", "FT_TOTAL", { OVER: "2.20" }), cell("SBOBET", "FT_TOTAL", { UNDER: "2.20" })], new Set<ProviderId>(["SABA"])],
    ["invalid price", [cell("SABA", "FT_TOTAL", { OVER: "bad" }), cell("SBOBET", "FT_TOTAL", { UNDER: "2.20" })], selected],
    ["rounded unprofitable", [cell("SABA", "FT_TOTAL", { OVER: "1.95" }), cell("SBOBET", "FT_TOTAL", { UNDER: "1.95" })], selected]
  ])("rejects %s", (_name, cells, selectedProviders) => {
    expect(buildArbitrageAlert(row("FT_TOTAL", cells as readonly ComparisonCell[]),
      selectedProviders as ReadonlySet<ProviderId>, DEFAULT_WATCH_STAKE_POLICY)).toBeNull();
  });
});
