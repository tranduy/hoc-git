import type { ProviderId } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

export interface NormalizedCatalogPart {
  readonly diagnostics: readonly unknown[];
  readonly events: ObservedProviderCatalog["events"];
  readonly markets: ObservedProviderCatalog["markets"];
  readonly quotes: ObservedProviderCatalog["quotes"];
}

export type CatalogEvent = ObservedProviderCatalog["events"][number];

function fixtureIdentity(event: CatalogEvent): string {
  const participant = (value: string): string => value.normalize("NFKD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const variant = event.category === "FOOTBALL"
    ? `${event.sportVariant ?? ""}/${String(event.isVirtual)}`
    : `${event.gameVariant ?? ""}/${String(event.bestOf)}`;
  return [event.category, event.isLive ? "LIVE" : "PREMATCH", event.eventScope, variant,
    participant(event.competition),
    [participant(event.participantA), participant(event.participantB)].sort().join("~")].join("|");
}

/**
 * A provider that publishes one fixture under several providerEventIds splits
 * that fixture's markets across records. The comparison layer then reads the
 * repeated identity as ambiguous and drops the fixture from every cross-book
 * pairing. Collapsing is scoped to one provider's own catalog, where a shared
 * competition string is reliable, and never merges records that disagree on
 * live phase, scope, variant or competition.
 */
function collapseDuplicates(
  events: Map<string, CatalogEvent>,
  markets: Map<string, ObservedProviderCatalog["markets"][number]>,
  quotes: Map<string, ObservedProviderCatalog["quotes"][number]>
): void {
  const canonicalByFixture = new Map<string, string>();
  const rewrite = new Map<string, string>();
  for (const [providerEventId, event] of events) {
    const identity = fixtureIdentity(event);
    const canonical = canonicalByFixture.get(identity);
    if (canonical === undefined) {
      canonicalByFixture.set(identity, providerEventId);
      continue;
    }
    rewrite.set(providerEventId, canonical);
    events.delete(providerEventId);
  }
  if (rewrite.size === 0) return;
  for (const [key, market] of [...markets]) {
    const canonical = rewrite.get(market.providerEventId);
    if (canonical === undefined) continue;
    markets.delete(key);
    markets.set(`${canonical}|${market.providerMarketId}`, { ...market, providerEventId: canonical });
  }
  for (const [key, quote] of [...quotes]) {
    const canonical = rewrite.get(quote.providerEventId);
    if (canonical === undefined) continue;
    quotes.delete(key);
    quotes.set(`${canonical}|${quote.providerMarketId}|${quote.providerSelectionId}`,
      { ...quote, providerEventId: canonical });
  }
}

export function mergeObservedCatalogParts(input: {
  readonly accountId: string;
  readonly provider: ProviderId;
  readonly observedAtMs: number;
  readonly parts: readonly NormalizedCatalogPart[];
  readonly selectEvent?: (current: CatalogEvent, candidate: CatalogEvent) => CatalogEvent;
  readonly collapseDuplicateEvents?: boolean;
}): ObservedProviderCatalog {
  const events = new Map<string, ObservedProviderCatalog["events"][number]>();
  const markets = new Map<string, ObservedProviderCatalog["markets"][number]>();
  const quotes = new Map<string, ObservedProviderCatalog["quotes"][number]>();
  for (const part of input.parts) {
    for (const event of part.events) {
      const current = events.get(event.providerEventId);
      events.set(event.providerEventId,
        current === undefined ? event : (input.selectEvent?.(current, event) ?? event));
    }
    for (const market of part.markets) markets.set(`${market.providerEventId}|${market.providerMarketId}`, market);
    for (const quote of part.quotes) {
      quotes.set(`${quote.providerEventId}|${quote.providerMarketId}|${quote.providerSelectionId}`, quote);
    }
  }
  if (input.collapseDuplicateEvents === true) collapseDuplicates(events, markets, quotes);
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
