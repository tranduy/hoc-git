import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { withScheduledPhaseResolved } from "./catalog-part-merge.js";

interface SelectionObservationBase {
  readonly accountId: string;
  readonly provider: ObservedProviderCatalog["provider"];
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
  readonly line: string | null;
  readonly expectedCatalogObservedAtMs: number;
  readonly expectedRawOdds: string;
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

export type SelectionCatalogObservation = SelectionObservationBase & (
  | { readonly kind: "FOUND"; readonly rawOdds: string }
  | { readonly kind: "REMOVE"; readonly reason: "NOT_FOUND" | "AMBIGUOUS" | "MARKET_NOT_OPEN" |
      "IDENTITY_MISMATCH" | "TIMEOUT" | "SOURCE_UNAVAILABLE" }
);

export function reconcileSabaDomDelta(retained: ObservedProviderCatalog,
  current: ObservedProviderCatalog): ObservedProviderCatalog {
  if (retained.provider !== "SABA" || current.provider !== "SABA" ||
    retained.accountId !== current.accountId) return current;

  const events = new Map(retained.events.map((event) => [event.providerEventId, event]));
  for (const event of current.events) events.set(event.providerEventId, event);

  const visibleFamilies = new Set(current.markets.map((market) => marketFamilyKey(market)));
  const markets = new Map(retained.markets
    .filter((market) => !visibleFamilies.has(marketFamilyKey(market)))
    .map((market) => [marketIdentityKey(market), market]));
  for (const market of current.markets) markets.set(marketIdentityKey(market), market);

  const quotes = new Map(retained.quotes
    .filter((quote) => !visibleFamilies.has(marketFamilyKey(quote)))
    .map((quote) => [quoteIdentityKey(quote), quote]));
  for (const quote of current.quotes) quotes.set(quoteIdentityKey(quote), quote);
  const retainedMarketIds = new Set([...markets.values()].map((market) => marketIdentityKey(market)));

  return withScheduledPhaseResolved({ ...current,
    rejectedMarketCount: Math.max(retained.rejectedMarketCount, current.rejectedMarketCount),
    events: [...events.values()], markets: [...markets.values()],
    quotes: [...quotes.values()].filter((quote) => retainedMarketIds.has(marketIdentityKey(quote))) });
}

export function reconcileSelectionObservation(catalog: ObservedProviderCatalog,
  observation: SelectionCatalogObservation): ObservedProviderCatalog | null {
  if (catalog.accountId !== observation.accountId || catalog.provider !== observation.provider ||
    observation.expectedCatalogObservedAtMs > catalog.observedAtMs ||
    !Number.isFinite(observation.observedAtMs) || observation.observedAtMs < catalog.observedAtMs ||
    !Number.isFinite(observation.receivedMonotonicMs) || observation.receivedMonotonicMs < 0) return null;
  const market = catalog.markets.find((candidate) =>
    candidate.providerEventId === observation.providerEventId &&
    candidate.providerMarketId === observation.providerMarketId);
  const quote = catalog.quotes.find((candidate) =>
    candidate.providerEventId === observation.providerEventId &&
    candidate.providerMarketId === observation.providerMarketId &&
    candidate.providerSelectionId === observation.providerSelectionId);
  if (market === undefined || quote === undefined || market.line !== observation.line ||
    quote.line !== observation.line || quote.rawOdds !== observation.expectedRawOdds) return null;

  if (observation.kind === "FOUND") {
    if (observation.rawOdds === quote.rawOdds) return null;
    return { ...catalog, observedAtMs: observation.observedAtMs,
      quotes: catalog.quotes.map((candidate) => candidate !== quote ? candidate : { ...candidate,
        rawOdds: observation.rawOdds, status: "OPEN", sourceTimestampMs: observation.observedAtMs,
        receivedMonotonicMs: observation.receivedMonotonicMs, sequence: null }) };
  }

  const markets = catalog.markets.filter((candidate) =>
    candidate.providerEventId !== observation.providerEventId ||
    candidate.providerMarketId !== observation.providerMarketId);
  const remainingEventIds = new Set(markets.map((candidate) => candidate.providerEventId));
  return { ...catalog, observedAtMs: observation.observedAtMs,
    events: catalog.events.filter((event) => event.providerEventId !== observation.providerEventId ||
      remainingEventIds.has(event.providerEventId)),
    markets, quotes: catalog.quotes.filter((candidate) =>
      candidate.providerEventId !== observation.providerEventId ||
      candidate.providerMarketId !== observation.providerMarketId) };
}

function marketFamilyKey(value: ObservedProviderCatalog["markets"][number] |
  ObservedProviderCatalog["quotes"][number]): string {
  return JSON.stringify([value.providerEventId, value.marketType, value.scope]);
}

function marketIdentityKey(value: ObservedProviderCatalog["markets"][number] |
  ObservedProviderCatalog["quotes"][number]): string {
  return `${value.providerEventId}\u0000${value.providerMarketId}`;
}

function quoteIdentityKey(value: ObservedProviderCatalog["quotes"][number]): string {
  return `${marketIdentityKey(value)}\u0000${value.providerSelectionId}`;
}
