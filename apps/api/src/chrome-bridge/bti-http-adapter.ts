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
  readonly listedEventIds: Set<string>;
}

interface SourceParts {
  lists: Map<string, ObservedProviderCatalog>;
  readonly details: Map<string, ObservedProviderCatalog>;
  readonly pending: Map<string, PendingGeneration>;
  listedEventIds: Set<string>;
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
    const rawListedEventIds = isDetail ? new Set<string>() : btiListEventIds(payload);
    if (payloadState === "INVALID" || (records.length === 0 && payloadState !== "EMPTY" &&
      (isDetail || rawListedEventIds.size === 0))) return [];
    const parts = this.#parts.get(envelope.sourceId) ?? {
      lists: new Map<string, ObservedProviderCatalog>(), details: new Map<string, ObservedProviderCatalog>(),
      pending: new Map<string, PendingGeneration>(), listedEventIds: new Set<string>(),
      latestGeneration: null, newestGenerationSeen: null
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
      // A hydrated BTI roster legitimately contains event shells whose full
      // markets only exist on /eventpage/events/:id. Keep those identities so
      // the correlated detail queue can enrich every advertised event.
      if (normalized.events.length === 0) return [];
      part = {
        ...emptyCatalog(envelope.observedAtMs), rejectedMarketCount: normalized.diagnostics.length,
        events: normalized.events, markets: normalized.markets, quotes: normalized.quotes
      };
    }
    if (isDetail) {
      const eventId = decodeURIComponent(envelope.request.pathnameClass.slice("/api/eventpage/events/".length));
      const isBatch = /^__fieldline_batch_\d+__$/u.test(eventId);
      const detailEntries = isBatch
        ? part.events.map(({ providerEventId }) => [providerEventId,
          catalogForEvent(part, providerEventId)] as const)
        : [[eventId, records.length === 0 ? null : catalogForEvent(part, eventId)] as const];
      if (records.length > 0 && (detailEntries.length === 0 ||
        detailEntries.some(([, detail]) => detail === null))) return [];
      if (parts.latestGeneration !== null && compareGeneration(generation.order, parts.latestGeneration) < 0) return [];
      const targetsCurrent = parts.latestGeneration !== null &&
        compareGeneration(generation.order, parts.latestGeneration) === 0;
      if (targetsCurrent) {
        let accepted = false;
        for (const [detailEventId, detail] of detailEntries) {
          if (!parts.listedEventIds.has(detailEventId)) continue;
          accepted = true;
          if (detail === null) parts.details.delete(detailEventId);
          else parts.details.set(detailEventId, detail);
        }
        if (!accepted) return [];
      } else {
        if (!acceptNewestGeneration(parts, generation.order)) return [];
        const pending = parts.pending.get(generation.id) ?? {
          order: generation.order, lists: new Map<string, ObservedProviderCatalog>(),
          details: new Map<string, ObservedProviderCatalog | null>(), listedEventIds: new Set<string>()
        };
        for (const [detailEventId, detail] of detailEntries) pending.details.set(detailEventId, detail);
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
        for (const eventId of rawListedEventIds) parts.listedEventIds.add(eventId);
      } else {
        if (!acceptNewestGeneration(parts, generation.order)) return [];
        const pending = parts.pending.get(generation.id) ?? { order: generation.order,
          lists: new Map<string, ObservedProviderCatalog>(),
          details: new Map<string, ObservedProviderCatalog | null>(), listedEventIds: new Set<string>() };
        pending.lists.set(envelope.request.pathnameClass, part);
        for (const eventId of rawListedEventIds) pending.listedEventIds.add(eventId);
        parts.pending.set(generation.id, pending);
        this.#parts.set(envelope.sourceId, parts);
        if ([...LIST_PATHS].some((path) => !pending.lists.has(path))) return [];
        const currentEventIds = pending.listedEventIds;
        for (const eventId of parts.details.keys()) {
          if (!currentEventIds.has(eventId)) parts.details.delete(eventId);
        }
        for (const [eventId, detail] of pending.details) {
          if (!currentEventIds.has(eventId) || detail === null) parts.details.delete(eventId);
          else parts.details.set(eventId, detail);
        }
        parts.lists = pending.lists;
        parts.listedEventIds = new Set(currentEventIds);
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
    const mergedEvents = new Map<string, (typeof all)[number]["events"][number]>();
    for (const event of [...parts.details.values(), ...parts.lists.values()].flatMap(({ events }) => events)) {
      const existing = mergedEvents.get(event.providerEventId);
      if (existing !== undefined && placeholderParticipants(event) && !placeholderParticipants(existing)) continue;
      mergedEvents.set(event.providerEventId, event);
    }
    const catalog: ObservedProviderCatalog = {
      ...emptyCatalog(envelope.observedAtMs),
      rejectedMarketCount: all.reduce((sum, value) => sum + value.rejectedMarketCount, 0),
      // The public roster normally owns identity, but its hidden rows can expose
      // only generic Home/Away labels. In that case retain the hydrated names
      // from event detail so cross-book event matching remains possible.
      events: [...mergedEvents.values()],
      markets: unique(all.flatMap(({ markets }) => markets),
        (market) => `${market.providerEventId}\u0000${market.providerMarketId}`),
      quotes: unique(all.flatMap(({ quotes }) => quotes),
        (quote) => `${quote.providerEventId}\u0000${quote.providerMarketId}\u0000${quote.providerSelectionId}`)
    };
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog, generation: generation.id,
      authoritativeBaseline: !isDetail }];
  }
}

function placeholderParticipants(event: { readonly participantA: string; readonly participantB: string }): boolean {
  const normalized = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en").replace(/[^a-z0-9]+/gu, " ").trim();
  const pair = `${normalized(event.participantA)}\u0000${normalized(event.participantB)}`;
  return pair === "home\u0000away" || pair === "team a\u0000team b" ||
    pair === "doi nha\u0000doi khach" || pair === "chu nha\u0000doi khach";
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

function btiListEventIds(payload: unknown): Set<string> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return new Set();
  const serializedData = (payload as Record<string, unknown>).serializedData;
  if (!Array.isArray(serializedData)) return new Set();
  const ids = new Set<string>();
  for (const league of serializedData) {
    if (!Array.isArray(league) || !Array.isArray(league[12])) continue;
    for (const event of league[12]) {
      if (!Array.isArray(event)) continue;
      const id = event[0];
      if (typeof id === "string" && id.trim() !== "") ids.add(id);
      else if (typeof id === "number" && Number.isSafeInteger(id)) ids.add(String(id));
    }
  }
  return ids;
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
