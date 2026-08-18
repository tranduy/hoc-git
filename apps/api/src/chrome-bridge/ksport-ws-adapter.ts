import { normalizeSbobetCatalog, type SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { extractSbobetDirectCatalogRecords } from "../providers/sbobet/sbobet-direct-catalog.js";
import { decodeSbobetStompBodies } from "../providers/sbobet/sbobet-stomp.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function bootstrapRecords(body: unknown, live: boolean): readonly SbobetCatalogInputRecord[] {
  const output: SbobetCatalogInputRecord[] = [];
  const visit = (value: unknown, leagueName = "K-Sports Football", depth = 0): void => {
    if (depth > 20) return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, leagueName, depth + 1)); return; }
    const item = record(value);
    if (item === null) return;
    const nestedLeague = typeof item["1"] === "string" && item["1"].trim() ? item["1"].trim() : leagueName;
    const eventId = typeof item["8"] === "string" || typeof item["8"] === "number" ? String(item["8"]) : "";
    const home = typeof item["2"] === "string" ? item["2"].trim() : "";
    const away = typeof item["3"] === "string" ? item["3"].trim() : "";
    const startAtUtcMs = typeof item["0"] === "string" ? Date.parse(item["0"]) : Number.NaN;
    if (/^\d+$/u.test(eventId) && home && away && home !== away && record(item["7"]) !== null) {
      output.push({ eventId, leagueName, timeText: live ? "LIVE" : "PREMATCH", scoreText: null,
        ...(Number.isFinite(startAtUtcMs) ? { startAtUtcMs } : {}), teamNames: [home, away], markets: [] });
    }
    Object.values(item).forEach((child) => visit(child, nestedLeague, depth + 1));
  };
  visit(body);
  return output;
}

export class KsportWsCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "ksport-ws-catalog-v1";
  readonly lobby = "KSPORT" as const;
  readonly providerFamily = "SBOBET";
  readonly #records = new Map<string, Map<string, { record: SbobetCatalogInputRecord; seenAtMs: number }>>();

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    return envelope.lobby === "KSPORT" && envelope.transport === "WS_FRAME" &&
      envelope.payload.encoding === "UTF8" && envelope.request.pathnameClass.startsWith("/sport/") &&
      envelope.payload.body.includes("destination:/topic/sports/") &&
      decodeSbobetStompBodies(envelope.payload.body).length > 0;
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const live = envelope.payload.body.includes("/live/");
    const changed: readonly SbobetCatalogInputRecord[] = decodeSbobetStompBodies(envelope.payload.body).flatMap((body) => {
      const bootstrap = bootstrapRecords(body, live);
      return extractSbobetDirectCatalogRecords(body, bootstrap);
    });
    if (changed.length === 0) return [];
    const retained: Map<string, { record: SbobetCatalogInputRecord; seenAtMs: number }> =
      this.#records.get(envelope.sourceId) ?? new Map();
    for (const incoming of changed) {
      const previous = retained.get(incoming.eventId)?.record;
      const markets = new Map<string, SbobetCatalogInputRecord["markets"][number]>(
        previous?.markets.map((market) => [market.marketId, market] as const) ?? []);
      incoming.markets.forEach((market) => markets.set(market.marketId, market));
      retained.set(incoming.eventId, { record: { ...incoming, markets: [...markets.values()] }, seenAtMs: envelope.observedAtMs });
    }
    for (const [eventId, entry] of retained) {
      if (envelope.observedAtMs - entry.seenAtMs > 2 * 60 * 60 * 1_000) retained.delete(eventId);
    }
    this.#records.set(envelope.sourceId, retained);
    const records = [...retained.values()].map((entry) => entry.record);
    const normalized = normalizeSbobetCatalog(records, {
      observedAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
      sequence: envelope.sequence, provider: "SBOBET",
      settlementProfile: "football-regulation-including-added-time"
    });
    if (normalized.events.length === 0 || normalized.markets.length === 0 || normalized.quotes.length === 0) return [];
    const catalog: ObservedProviderCatalog = {
      dataMode: "LIVE", accountId: "catalog-source:SBOBET:FOOTBALL", provider: "SBOBET", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: envelope.observedAtMs,
      rejectedMarketCount: normalized.diagnostics.length,
      events: normalized.events, markets: normalized.markets, quotes: normalized.quotes
    };
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog }];
  }
}
