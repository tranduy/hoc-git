import type { ProviderId } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

export interface NormalizedCatalogPart {
  readonly diagnostics: readonly unknown[];
  readonly events: ObservedProviderCatalog["events"];
  readonly markets: ObservedProviderCatalog["markets"];
  readonly quotes: ObservedProviderCatalog["quotes"];
}

export function mergeObservedCatalogParts(input: {
  readonly accountId: string;
  readonly provider: ProviderId;
  readonly observedAtMs: number;
  readonly parts: readonly NormalizedCatalogPart[];
}): ObservedProviderCatalog {
  const events = new Map<string, ObservedProviderCatalog["events"][number]>();
  const markets = new Map<string, ObservedProviderCatalog["markets"][number]>();
  const quotes = new Map<string, ObservedProviderCatalog["quotes"][number]>();
  for (const part of input.parts) {
    for (const event of part.events) events.set(event.providerEventId, event);
    for (const market of part.markets) markets.set(`${market.providerEventId}|${market.providerMarketId}`, market);
    for (const quote of part.quotes) {
      quotes.set(`${quote.providerEventId}|${quote.providerMarketId}|${quote.providerSelectionId}`, quote);
    }
  }
  return {
    dataMode: "LIVE",
    accountId: input.accountId,
    provider: input.provider,
    category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER",
    observedAtMs: input.observedAtMs,
    rejectedMarketCount: input.parts.reduce((total, part) => total + part.diagnostics.length, 0),
    events: [...events.values()],
    markets: [...markets.values()],
    quotes: [...quotes.values()]
  };
}
