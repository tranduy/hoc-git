import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { extractBtiCatalogRecords } from "../providers/bti/bti-direct-catalog.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";

const ACCOUNT_ID = "catalog-source:BTI:FOOTBALL";
const LIST_PATHS = new Set([
  "/api/eventlist/asia/leagues/v2/1/live",
  "/api/eventlist/asia/leagues/v2/1/live/initial",
  "/api/eventlist/asia/leagues/v2/1/prematch/initial"
]);
const OPTIONAL_LIST_PATH = "/api/eventlist/asia/leagues/v2/1/prematch";

interface PendingGeneration {
  readonly order: readonly [number, number];
  readonly lists: Map<string, ObservedProviderCatalog>;
  readonly details: Map<string, ObservedProviderCatalog | null>;
}

interface SourceParts {
  lists: Map<string, ObservedProviderCatalog>;
  readonly details: Map<string, ObservedProviderCatalog>;
  readonly pending: Map<string, PendingGeneration>;
  latestGeneration: readonly [number, number] | null;
  newestGenerationSeen: readonly [number, number] | null;
}

export class BtiHttpCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "bti-http-catalog-v1";
  readonly lobby = "BTI" as const;
  readonly providerFamily = "BTI";
  readonly #parts = new Map<string, SourceParts>();

  resetSource(sourceId: string): void {
    this.#parts.delete(sourceId);
  }

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
    const payloadState = btiPayloadState(payload, isDetail);
    if (payloadState === "INVALID" || (records.length === 0 && payloadState !== "EMPTY")) return [];
    const parts = this.#parts.get(envelope.sourceId) ?? {
      lists: new Map<string, ObservedProviderCatalog>(), details: new Map<string, ObservedProviderCatalog>(),
      pending: new Map<string, PendingGeneration>(), latestGeneration: null, newestGenerationSeen: null
    };
    const generation = parseGeneration(envelope.request.streamId);
    if (generation === null) return [];
    let part = emptyCatalog(envelope.observedAtMs);
    if (records.length > 0) {
      const normalized = normalizeSbobetCatalog(records, {
        observedAtMs: envelope.observedAtMs,
        receivedMonotonicMs: envelope.receivedMonotonicMs,
        sequence: envelope.sequence,
        provider: "BTI",
        settlementProfile: "football-regulation-including-added-time"
      });
      if (normalized.events.length === 0 || normalized.markets.length === 0 || normalized.quotes.length === 0) return [];
      part = {
        ...emptyCatalog(envelope.observedAtMs), rejectedMarketCount: normalized.diagnostics.length,
        events: normalized.events, markets: normalized.markets, quotes: normalized.quotes
      };
    }
    if (isDetail) {
      const eventId = decodeURIComponent(envelope.request.pathnameClass.slice("/api/eventpage/events/".length));
      const detail = records.length === 0 ? null : catalogForEvent(part, eventId);
      if (records.length > 0 && detail === null) return [];
      if (parts.latestGeneration !== null && compareGeneration(generation.order, parts.latestGeneration) < 0) return [];
      const targetsCurrent = parts.latestGeneration !== null &&
        compareGeneration(generation.order, parts.latestGeneration) === 0;
      if (targetsCurrent) {
        if (!listedEventIds(parts.lists).has(eventId)) return [];
        if (detail === null) parts.details.delete(eventId);
        else parts.details.set(eventId, detail);
      } else {
        if (!acceptNewestGeneration(parts, generation.order)) return [];
        const pending = parts.pending.get(generation.id) ?? {
          order: generation.order, lists: new Map<string, ObservedProviderCatalog>(),
          details: new Map<string, ObservedProviderCatalog | null>()
        };
        pending.details.set(eventId, detail);
        parts.pending.set(generation.id, pending);
        this.#parts.set(envelope.sourceId, parts);
        return [];
      }
    } else {
      const latestComparison = parts.latestGeneration === null ? 1 :
        compareGeneration(generation.order, parts.latestGeneration);
      if (latestComparison < 0) return [];
      if (latestComparison === 0) {
        if (envelope.request.pathnameClass !== OPTIONAL_LIST_PATH ||
          parts.lists.has(OPTIONAL_LIST_PATH)) return [];
        parts.lists.set(OPTIONAL_LIST_PATH, part);
      } else {
        if (!acceptNewestGeneration(parts, generation.order)) return [];
        const pending = parts.pending.get(generation.id) ?? { order: generation.order,
          lists: new Map<string, ObservedProviderCatalog>(),
          details: new Map<string, ObservedProviderCatalog | null>() };
        pending.lists.set(envelope.request.pathnameClass, part);
        parts.pending.set(generation.id, pending);
        this.#parts.set(envelope.sourceId, parts);
        if ([...LIST_PATHS].some((path) => !pending.lists.has(path))) return [];
        const currentEventIds = listedEventIds(pending.lists);
        for (const eventId of parts.details.keys()) {
          if (!currentEventIds.has(eventId)) parts.details.delete(eventId);
        }
        for (const [eventId, detail] of pending.details) {
          if (!currentEventIds.has(eventId) || detail === null) parts.details.delete(eventId);
          else parts.details.set(eventId, detail);
        }
        parts.lists = pending.lists;
        parts.latestGeneration = pending.order;
        for (const [id, candidate] of parts.pending) {
          if (compareGeneration(candidate.order, pending.order) <= 0) parts.pending.delete(id);
        }
      }
    }
    this.#parts.set(envelope.sourceId, parts);
    if (parts.lists.size === 0) return [];
    const all = [...parts.lists.values(), ...parts.details.values()];
    const unique = <T>(items: readonly T[], key: (item: T) => string): readonly T[] =>
      [...new Map(items.map((item) => [key(item), item])).values()];
    const catalog: ObservedProviderCatalog = {
      ...emptyCatalog(envelope.observedAtMs),
      rejectedMarketCount: all.reduce((sum, value) => sum + value.rejectedMarketCount, 0),
      events: unique(all.flatMap(({ events }) => events), (event) => event.providerEventId),
      markets: unique(all.flatMap(({ markets }) => markets),
        (market) => `${market.providerEventId}\u0000${market.providerMarketId}`),
      quotes: unique(all.flatMap(({ quotes }) => quotes),
        (quote) => `${quote.providerEventId}\u0000${quote.providerMarketId}\u0000${quote.providerSelectionId}`)
    };
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog, authoritativeBaseline: !isDetail }];
  }
}

function acceptNewestGeneration(parts: SourceParts, order: readonly [number, number]): boolean {
  if (parts.newestGenerationSeen !== null && compareGeneration(order, parts.newestGenerationSeen) < 0) return false;
  if (parts.newestGenerationSeen === null || compareGeneration(order, parts.newestGenerationSeen) > 0) {
    parts.newestGenerationSeen = order;
    for (const [id, candidate] of parts.pending) {
      if (compareGeneration(candidate.order, order) < 0) parts.pending.delete(id);
    }
  }
  return true;
}

function listedEventIds(lists: ReadonlyMap<string, ObservedProviderCatalog>): Set<string> {
  return new Set([...lists.values()].flatMap(({ events }) => events.map(({ providerEventId }) => providerEventId)));
}

function catalogForEvent(part: ObservedProviderCatalog, eventId: string): ObservedProviderCatalog | null {
  if (!part.events.some((event) => event.providerEventId === eventId)) return null;
  return {
    ...part,
    events: part.events.filter((event) => event.providerEventId === eventId),
    markets: part.markets.filter((market) => market.providerEventId === eventId),
    quotes: part.quotes.filter((quote) => quote.providerEventId === eventId)
  };
}

function parseGeneration(value: string | undefined): { readonly id: string; readonly order: readonly [number, number] } | null {
  const match = /^bti:(\d+):(\d+)$/u.exec(value ?? "");
  if (match === null) return null;
  const timestamp = Number(match[1]);
  const ordinal = Number(match[2]);
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(ordinal)) return null;
  return { id: value!, order: [timestamp, ordinal] };
}

function compareGeneration(left: readonly [number, number], right: readonly [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}

function emptyCatalog(observedAtMs: number): ObservedProviderCatalog {
  return {
    dataMode: "LIVE", accountId: ACCOUNT_ID, provider: "BTI", category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs, rejectedMarketCount: 0,
    events: [], markets: [], quotes: []
  };
}

function btiPayloadState(payload: unknown, detail: boolean): "EMPTY" | "NONEMPTY" | "INVALID" {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return "INVALID";
  const root = payload as Record<string, unknown>;
  if (detail) {
    if (!Array.isArray(root.data)) return "INVALID";
    return root.data.length === 0 ? "EMPTY" : "NONEMPTY";
  }
  if (!Array.isArray(root.serializedData)) return "INVALID";
  let eventCount = 0;
  for (const league of root.serializedData) {
    if (!Array.isArray(league) || !Array.isArray(league[12])) return "INVALID";
    eventCount += league[12].length;
  }
  return eventCount === 0 ? "EMPTY" : "NONEMPTY";
}
