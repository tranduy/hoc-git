import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";

export type MatchWatchKind =
  | "ODDS_CHANGED"
  | "MARKET_SUSPENDED"
  | "MARKET_REOPENED"
  | "QUOTE_SUSPENDED"
  | "QUOTE_REOPENED"
  | "EVENT_MISSING"
  | "POLL_FAILED"
  | "STALE";

export interface MatchSample {
  readonly provider: string;
  readonly providerEventId: string;
  readonly observedAtMs: number;
  readonly event: ProviderEvent | null;
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
}

export interface MatchWatchEntry {
  readonly id: string;
  readonly kind: MatchWatchKind;
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerMarketId: string | null;
  readonly providerSelectionId: string | null;
  readonly competition: string;
  readonly matchLabel: string;
  readonly marketType: string | null;
  readonly scope: string | null;
  readonly line: string | null;
  readonly selection: string | null;
  readonly previousValue: string | null;
  readonly currentValue: string | null;
  readonly detectedAtMs: number;
  readonly providerObservedAtMs: number;
  readonly sampleIntervalMs: number;
}

export function sampleMatch(catalog: LiveCatalogResponse, providerEventId: string): MatchSample {
  return {
    provider: catalog.provider,
    providerEventId,
    observedAtMs: catalog.observedAtMs,
    event: catalog.events.find((candidate) => candidate.providerEventId === providerEventId) ?? null,
    markets: catalog.markets.filter((candidate) => candidate.providerEventId === providerEventId),
    quotes: catalog.quotes.filter((candidate) => candidate.providerEventId === providerEventId)
  };
}

function marketKey(market: ProviderMarket): string {
  return `${market.provider}\u0000${market.providerEventId}\u0000${market.providerMarketId}`;
}

function quoteKey(quote: ProviderQuote): string {
  return `${quote.provider}\u0000${quote.providerEventId}\u0000${quote.providerMarketId}\u0000${quote.providerSelectionId}`;
}

function baseEntry(
  previous: MatchSample,
  current: MatchSample,
  detectedAtMs: number,
  kind: MatchWatchKind,
  market: ProviderMarket | null,
  quote: ProviderQuote | null,
  previousValue: string | null,
  currentValue: string | null
): MatchWatchEntry {
  const event = current.event ?? previous.event;
  const providerMarketId = market?.providerMarketId ?? quote?.providerMarketId ?? null;
  const providerSelectionId = quote?.providerSelectionId ?? null;
  const suffix = [kind, providerMarketId ?? "event", providerSelectionId ?? "all"].join(":");
  return {
    id: `${detectedAtMs}:${suffix}`,
    kind,
    provider: current.provider,
    providerEventId: current.providerEventId,
    providerMarketId,
    providerSelectionId,
    competition: event?.competition ?? "Unknown competition",
    matchLabel: event === null ? "Unknown event" : `${event.participantA} vs ${event.participantB}`,
    marketType: market?.marketType ?? quote?.marketType ?? null,
    scope: market?.scope ?? quote?.scope ?? null,
    line: market?.line ?? quote?.line ?? null,
    selection: quote?.selection ?? null,
    previousValue,
    currentValue,
    detectedAtMs,
    providerObservedAtMs: current.observedAtMs,
    sampleIntervalMs: Math.max(0, current.observedAtMs - previous.observedAtMs)
  };
}

export function diffMatchSamples(
  previous: MatchSample,
  current: MatchSample,
  detectedAtMs: number
): readonly MatchWatchEntry[] {
  if (previous.event !== null && current.event === null) {
    return [baseEntry(previous, current, detectedAtMs, "EVENT_MISSING", null, null, "PRESENT", "MISSING")];
  }
  if (previous.event === null || current.event === null) return [];

  const entries: MatchWatchEntry[] = [];
  const previousMarkets = new Map(previous.markets.map((candidate) => [marketKey(candidate), candidate]));
  for (const market of current.markets) {
    const prior = previousMarkets.get(marketKey(market));
    if (prior?.status === "OPEN" && market.status === "SUSPENDED") {
      entries.push(baseEntry(previous, current, detectedAtMs, "MARKET_SUSPENDED", market, null, "OPEN", "SUSPENDED"));
    } else if (prior?.status === "SUSPENDED" && market.status === "OPEN") {
      entries.push(baseEntry(previous, current, detectedAtMs, "MARKET_REOPENED", market, null, "SUSPENDED", "OPEN"));
    }
  }

  const previousQuotes = new Map(previous.quotes.map((candidate) => [quoteKey(candidate), candidate]));
  for (const quote of current.quotes) {
    const prior = previousQuotes.get(quoteKey(quote));
    if (prior === undefined) continue;
    if (prior.rawOdds !== quote.rawOdds || prior.rawFormat !== quote.rawFormat) {
      entries.push(baseEntry(
        previous, current, detectedAtMs, "ODDS_CHANGED", null, quote,
        `${prior.rawOdds} ${prior.rawFormat}`, `${quote.rawOdds} ${quote.rawFormat}`
      ));
    }
    if (prior.status === "OPEN" && quote.status === "SUSPENDED") {
      entries.push(baseEntry(previous, current, detectedAtMs, "QUOTE_SUSPENDED", null, quote, "OPEN", "SUSPENDED"));
    } else if (prior.status === "SUSPENDED" && quote.status === "OPEN") {
      entries.push(baseEntry(previous, current, detectedAtMs, "QUOTE_REOPENED", null, quote, "SUSPENDED", "OPEN"));
    }
  }
  return entries;
}

export function boundWatchEntries(
  entries: readonly MatchWatchEntry[],
  maximum = 200
): readonly MatchWatchEntry[] {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("WATCH_ENTRY_LIMIT_INVALID");
  return entries.slice(Math.max(0, entries.length - maximum));
}
