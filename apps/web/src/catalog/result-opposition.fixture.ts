import type { MarketType, ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";

export function resultCatalog(provider: ProviderId, dc: boolean, selections?: readonly string[],
  period: "FT" | "FH" | "SH" = "FT"): LiveCatalogResponse {
  const providerEventId = `${provider}-event`, providerMarketId = `${provider}-${period}-${dc ? "dc" : "result"}`;
  const scope = period === "FT" ? "FULL_TIME" : period === "FH" ? "FIRST_HALF" : "SECOND_HALF";
  const marketType = `${period}_${dc ? "DOUBLE_CHANCE" : "1X2"}` as MarketType;
  const market: ProviderMarket = { provider, providerEventId, providerMarketId, category: "FOOTBALL",
    marketType, scope, line: null, status: "OPEN", settlementProfile: period === "FT"
      ? "football-regulation-including-added-time" : `football-${period === "FH" ? "first" : "second"}-half-including-added-time` };
  const quotes: ProviderQuote[] = (selections ?? (dc ? ["HOME_DRAW", "HOME_AWAY", "DRAW_AWAY"]
    : ["HOME", "DRAW", "AWAY"])).map(selection => ({ ...market, selection,
    providerSelectionId: `${providerMarketId}-${selection}`, rawOdds: "2", rawFormat: "DECIMAL",
    isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1 }));
  return { dataMode: "LIVE", accountId: `catalog-source:${provider}:FOOTBALL`, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1, observedMonotonicMs: 1, rejectedMarketCount: 0,
    events: [{ provider, category: "FOOTBALL", providerEventId, competition: "Shared League", seasonStage: null,
      startAtUtcMs: 2000000, participantA: "Home Club", participantB: "Away Club", eventScope: "REGULATION",
      bestOf: null, isLive: false, rematchCandidate: false, fixtureDiscriminator: null, isVirtual: false,
      sportVariant: "FOOTBALL", liveState: null }], markets: [market], quotes };
}
