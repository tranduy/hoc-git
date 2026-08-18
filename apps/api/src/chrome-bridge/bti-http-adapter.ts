import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { extractBtiCatalogRecords } from "../providers/bti/bti-direct-catalog.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";

const ACCOUNT_ID = "catalog-source:BTI:FOOTBALL";
const DETAIL_TTL_MS = 60_000;

interface SourceParts {
  live?: ObservedProviderCatalog;
  prematch?: ObservedProviderCatalog;
  readonly details: Map<string, ObservedProviderCatalog>;
}

export class BtiHttpCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "bti-http-catalog-v1";
  readonly lobby = "BTI" as const;
  readonly providerFamily = "BTI";
  readonly #parts = new Map<string, SourceParts>();

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    return envelope.lobby === "BTI" && envelope.transport === "HTTP_RESPONSE" &&
      envelope.payload.encoding === "UTF8" &&
      (/^\/api\/eventlist\/asia\/leagues\/v2\/1\/(?:live|prematch)(?:\/initial)?$/u.test(
        envelope.request.pathnameClass) || /^\/api\/eventpage\/events\/[^/]+$/u.test(envelope.request.pathnameClass));
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    let payload: unknown;
    try { payload = JSON.parse(envelope.payload.body); } catch { return []; }
    const isDetail = envelope.request.pathnameClass.startsWith("/api/eventpage/events/");
    const records = extractBtiCatalogRecords(payload);
    const parts = this.#parts.get(envelope.sourceId) ?? { details: new Map<string, ObservedProviderCatalog>() };
    for (const [eventId, detail] of parts.details) {
      if (envelope.observedAtMs - detail.observedAtMs > DETAIL_TTL_MS) parts.details.delete(eventId);
    }
    if (records.length === 0) {
      if (isDetail) {
        const eventId = decodeURIComponent(envelope.request.pathnameClass.slice("/api/eventpage/events/".length));
        parts.details.delete(eventId);
        this.#parts.set(envelope.sourceId, parts);
      }
      return [];
    }
    const normalized = normalizeSbobetCatalog(records, {
      observedAtMs: envelope.observedAtMs,
      receivedMonotonicMs: envelope.receivedMonotonicMs,
      sequence: envelope.sequence,
      provider: "BTI",
      settlementProfile: "football-regulation-including-added-time"
    });
    if (normalized.events.length === 0 || normalized.markets.length === 0 || normalized.quotes.length === 0) return [];
    const part: ObservedProviderCatalog = {
      dataMode: "LIVE", accountId: ACCOUNT_ID, provider: "BTI", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: envelope.observedAtMs,
      rejectedMarketCount: normalized.diagnostics.length,
      events: normalized.events, markets: normalized.markets, quotes: normalized.quotes
    };
    if (isDetail) {
      for (const event of part.events) {
        const detail: ObservedProviderCatalog = {
          ...part,
          events: part.events.filter((candidate) => candidate.providerEventId === event.providerEventId),
          markets: part.markets.filter((candidate) => candidate.providerEventId === event.providerEventId),
          quotes: part.quotes.filter((candidate) => candidate.providerEventId === event.providerEventId)
        };
        parts.details.set(event.providerEventId, detail);
      }
    } else {
      const mode = envelope.request.pathnameClass.includes("/prematch") ? "prematch" : "live";
      parts[mode] = part;
    }
    this.#parts.set(envelope.sourceId, parts);
    const all = [parts.live, parts.prematch, ...parts.details.values()]
      .filter((value): value is ObservedProviderCatalog => value !== undefined);
    const unique = <T>(items: readonly T[], key: (item: T) => string): readonly T[] =>
      [...new Map(items.map((item) => [key(item), item])).values()];
    const catalog: ObservedProviderCatalog = {
      ...part,
      observedAtMs: Math.max(...all.map(({ observedAtMs }) => observedAtMs)),
      rejectedMarketCount: all.reduce((sum, value) => sum + value.rejectedMarketCount, 0),
      events: unique(all.flatMap(({ events }) => events), (event) => event.providerEventId),
      markets: unique(all.flatMap(({ markets }) => markets),
        (market) => `${market.providerEventId}\u0000${market.providerMarketId}`),
      quotes: unique(all.flatMap(({ quotes }) => quotes),
        (quote) => `${quote.providerEventId}\u0000${quote.providerMarketId}\u0000${quote.providerSelectionId}`)
    };
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog }];
  }
}
