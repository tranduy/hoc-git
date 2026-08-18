import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { extractBtiCatalogRecords } from "../providers/bti/bti-direct-catalog.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";

const ACCOUNT_ID = "catalog-source:BTI:FOOTBALL";

export class BtiHttpCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "bti-http-catalog-v1";
  readonly lobby = "BTI" as const;
  readonly providerFamily = "BTI";
  readonly #parts = new Map<string, { live?: ObservedProviderCatalog; prematch?: ObservedProviderCatalog }>();

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    return envelope.lobby === "BTI" && envelope.transport === "HTTP_RESPONSE" &&
      envelope.payload.encoding === "UTF8" &&
      /^\/api\/eventlist\/asia\/leagues\/v2\/1\/(?:live|prematch)(?:\/initial)?$/u.test(envelope.request.pathnameClass);
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    let payload: unknown;
    try { payload = JSON.parse(envelope.payload.body); } catch { return []; }
    const records = extractBtiCatalogRecords(payload);
    if (records.length === 0) return [];
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
    const mode = envelope.request.pathnameClass.includes("/prematch") ? "prematch" : "live";
    const parts = this.#parts.get(envelope.sourceId) ?? {};
    parts[mode] = part;
    this.#parts.set(envelope.sourceId, parts);
    const all = [parts.live, parts.prematch].filter((value): value is ObservedProviderCatalog => value !== undefined);
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
