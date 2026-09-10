import { footballBinaryMarketSpec, footballResultMarketSpec,
  type ProviderMarket, type ProviderQuote } from "@tool-chenh/contracts";
import type { CmdCatalogGroup } from "../cmd/cmd-normalizer.js";

export interface SabaDomMarketEvidence {
  readonly marketType: ProviderMarket["marketType"];
  readonly scope: ProviderMarket["scope"];
  readonly settlementProfile: string;
  readonly isHandicap: false;
  readonly linePolicy: "LINE" | "NONE";
  readonly selections: readonly ProviderQuote["selection"][];
  readonly rawFormat: "DECIMAL";
}

/** SABA's public MS2L desktop renderer, retrieved 2026-09-10:
 * dt/main.js?v202609091166291, sha256
 * 85cfee418f3b63665791f7d2bb6eefa58d531b7864fd1bd1e749f83ec1d70d02.
 * Its main data-bt 5/15 columns render selection keys 1,2,x, without
 * labels; data-bt 461/462 render o,u with the line and EventHasUnder.
 * foundation.js (ee393dc6d3b8c537ce5792db9fec284fac90745302c19f51b5cbd789567921bd)
 * excludes these four types from pairOdds and fixes their format to 1,
 * explicitly named Decimal_Odds. Do not extend this to other layouts/types.
 * Taxonomy: https://github.com/Saba-sports/OddsDirectAPI/wiki/BetType-Selection-Information
 */
export function sabaDomMarketEvidence(group: CmdCatalogGroup): SabaDomMarketEvidence | null {
  if (group.betTypeIds.length !== 1 || group.odds.some(odd =>
    odd.priceFormat !== undefined && odd.priceFormat !== "DECIMAL")) return null;
  const type = group.betTypeIds[0];
  if ((type === "5" || type === "15") && group.labels.length === 0 && group.odds.length === 3) {
    const marketType = type === "5" ? "FT_1X2" : "FH_1X2";
    const spec = footballResultMarketSpec(marketType)!;
    return { marketType, scope: spec.scope, settlementProfile: spec.settlementProfile,
      isHandicap: false, linePolicy: "NONE", selections: ["HOME", "AWAY", "DRAW"], rawFormat: "DECIMAL" };
  }
  if ((type === "461" || type === "462") && group.odds.length === 2 && group.labels.length === 2 &&
    /^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/u.test(group.labels[0]!) && group.labels[1] === "u") {
    const marketType = type === "461" ? "HOME_FT_TOTAL" : "AWAY_FT_TOTAL";
    const spec = footballBinaryMarketSpec(marketType)!;
    return { marketType, scope: spec.scope, settlementProfile: spec.settlementProfile,
      isHandicap: false, linePolicy: "LINE", selections: ["OVER", "UNDER"], rawFormat: "DECIMAL" };
  }
  return null;
}
