import type { MarketType, ProviderId, ProviderQuote, Scope } from "@tool-chenh/contracts";
import { footballBinaryMarketSpec } from "@tool-chenh/contracts";
import type { ComparisonRow } from "../catalog/comparison.js";
import { buildObservedFixedBaseStakeEstimate } from "./fixed-base-stake.js";

export function capturedRefundExample(kind: "handicap" | "total" | "break-even") {
  const marketType: MarketType = kind === "handicap" ? "FH_AH" : kind === "total" ? "FH_TOTAL" : "SH_TOTAL";
  const scope: Scope = kind === "break-even" ? "SECOND_HALF" : "FIRST_HALF";
  const line = kind === "handicap" ? "0" : kind === "total" ? "1" : "1.5";
  const legs: readonly [ProviderId, string, string, ProviderQuote["rawFormat"]][] = kind === "handicap"
    ? [["BTI", "HOME", "1.83", "DECIMAL"], ["SABA", "AWAY", "-0.79", "MALAY"]]
    : kind === "total" ? [["BTI", "OVER", "1.89", "DECIMAL"], ["SBOBET", "UNDER", "-0.88", "MALAY"]]
      : [["IM", "OVER", "1.99", "DECIMAL"], ["BTI", "UNDER", "-0.99", "MALAY"]];
  const row: ComparisonRow = { key: `${marketType}|${scope}|${line}`, marketType, scope, line,
    cells: legs.map(([provider, selection, rawOdds, rawFormat]) => {
      const identity = { provider, category: "FOOTBALL" as const, providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-market`, marketType, scope, line, status: "OPEN" as const };
      return { provider, market: { ...identity, settlementProfile: footballBinaryMarketSpec(marketType)!.settlementProfile },
        quotes: [{ ...identity, providerSelectionId: `${provider}-${selection}`, selection, rawOdds, rawFormat,
          isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 100, sequence: 1 }] };
    }), bestBySelection: {}, margin: 0, crossBook: true };
  const plan = buildObservedFixedBaseStakeEstimate(row, new Set(legs.map(([provider]) => provider)), {
    currency: "VND", baseStake: "500000", minStake: "1000", maxStake: "1000000000000", stakeStep: "1", balance: "1000000000000"
  });
  if (plan === null) throw new Error("Captured opposing prices must produce an observed plan");
  return { row, plan };
}
