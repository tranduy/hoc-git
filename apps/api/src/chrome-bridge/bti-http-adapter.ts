import { isSupportedFootballTwoWayLine, normalizeSbobetCatalog } from "@tool-chenh/adapters";
import { footballBinaryMarketSpec, footballCategoricalMarketSpec, footballResultMarketSpec, isValidProviderPlayerIdentity,
  type ChromeBridgeEnvelope, type MarketType, type Scope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { extractBtiCatalogRecords,
  extractBtiNativeMarketIdentities,
  extractBtiNativeMarketObservations } from "../providers/bti/bti-direct-catalog.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";

const ACCOUNT_ID = "catalog-source:BTI:FOOTBALL";
const LIST_PATHS = new Set([
  "/api/eventlist/asia/leagues/v2/1/live",
  "/api/eventlist/asia/leagues/v2/1/live/initial",
  "/api/eventlist/asia/leagues/v2/1/prematch/initial"
]);
const OPTIONAL_LIST_PATH = "/api/eventlist/asia/leagues/v2/1/prematch";

interface BtiPart extends ObservedProviderCatalog {
  readonly requestedAtMs: number;
  readonly nativeMarketIds: readonly { readonly eventId: string; readonly marketId: string }[];
  readonly closedEventIds: ReadonlySet<string>;
  readonly isDetail: boolean;
  readonly closureHistory?: ReadonlyMap<string, BtiPart>;
  readonly unresolvedDetail?: { readonly rows: readonly unknown[][];
    readonly receivedMonotonicMs: number; readonly sequence: number };
}

interface PendingGeneration {
  readonly order: readonly [number, number];
  readonly lists: Map<string, BtiPart>;
  readonly details: Map<string, BtiPart>;
  readonly listedEventIds: Set<string>;
}

interface SourceParts {
  lists: Map<string, BtiPart>;
  readonly details: Map<string, BtiPart>;
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
    const isDetail = envelope.request.pathnameClass.startsWith("/api/eventpage/events/");
    const generation = parseGeneration(envelope.request.streamId);
    if (generation === null) return [];
    const retained = this.#parts.get(envelope.sourceId);
    const latestComparison = retained?.latestGeneration == null ? 1 :
      compareGeneration(generation.order, retained.latestGeneration);
    // Continuous replay repairs a lost forward or API restart. Once this
    // decoder has committed a list, repeating its large body cannot update it.
    if (latestComparison < 0 || (!isDetail && latestComparison === 0 &&
      (envelope.request.pathnameClass !== OPTIONAL_LIST_PATH || retained!.lists.has(OPTIONAL_LIST_PATH)))) return [];
    let payload: unknown;
    try { payload = JSON.parse(envelope.payload.body); } catch { return []; }
    if (isDetail && latestComparison === 0 && retainedDetailReplay(payload, envelope, generation.order, retained!)) return [];
    if (isDetail) payload = hydrateDetailIdentity(payload, retained?.lists);
    const root = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown> : null;
    const rosterClock = root?.fieldlineBtiRoster === undefined ? null :
      parseClock(root.fieldlineBtiRoster, envelope, generation.order);
    if (!isDetail && root?.fieldlineBtiRoster !== undefined && rosterClock === null) return [];
    if (!isDetail && rosterClock !== null) {
      const complete = (root!.fieldlineBtiRoster as Record<string, unknown>).complete;
      // Raw league pages share the refresh generation but are not authoritative
      // roster partitions. Wait for the collector's fully hydrated partition.
      if (complete !== undefined && complete !== true) return [];
    }
    const records = extractBtiCatalogRecords(payload);
    const resolvedEventIds = new Set(records.map((record) => record.eventId));
    const nativeMarketObservations = extractBtiNativeMarketObservations(payload, envelope.observedAtMs).map((observation) =>
      isDetail && !resolvedEventIds.has(observation.providerEventId) && observation.disposition === "NORMALIZED"
        ? { ...observation, disposition: "EXCLUDED" as const, reason: "EVENT_IDENTITY_UNRESOLVED" } : observation);
    const closedEventIds = new Set<string>(isDetail && Array.isArray(root?.data) ? root.data.flatMap((row) =>
      Array.isArray(row) && nativeEventId(row[0]) !== "" && row[32] === true ? [nativeEventId(row[0])] : []) : []);
    const payloadState = btiPayloadState(payload, isDetail);
    const rawListedEventIds = isDetail ? new Set<string>() : btiListEventIds(payload);
    if (payloadState === "INVALID" || (records.length === 0 && payloadState !== "EMPTY" &&
      (isDetail ? closedEventIds.size === 0 && nativeMarketObservations.length === 0 : rawListedEventIds.size === 0))) return [];
    const parts = this.#parts.get(envelope.sourceId) ?? {
      lists: new Map<string, BtiPart>(), details: new Map<string, BtiPart>(),
      pending: new Map<string, PendingGeneration>(), listedEventIds: new Set<string>(),
      latestGeneration: null, newestGenerationSeen: null
    };
    const unresolvedRows = isDetail && Array.isArray(root?.data) ? root.data.filter((row): row is unknown[] =>
      Array.isArray(row) && !resolvedEventIds.has(nativeEventId(row[0])) && !closedEventIds.has(nativeEventId(row[0]))) : [];
    let part: BtiPart = { ...emptyCatalog(envelope.observedAtMs), requestedAtMs: envelope.observedAtMs,
      nativeMarketIds: extractBtiNativeMarketIdentities(payload), nativeMarketObservations, closedEventIds, isDetail,
      ...(unresolvedRows.length === 0 ? {} : { unresolvedDetail: { rows: unresolvedRows,
        receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence } }) };
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
        ...part, rejectedMarketCount: normalized.diagnostics.length,
        events: normalized.events, markets: normalized.markets, quotes: normalized.quotes,
        nativeMarketObservations
      };
    }
    if (!isDetail && rosterClock !== null) part = withClock(part, rosterClock, envelope);
    if (isDetail) {
      let eventId: string;
      try { eventId = decodeURIComponent(envelope.request.pathnameClass.slice("/api/eventpage/events/".length)); }
      catch { return []; }
      const isBatch = /^__fieldline_batch_\d+__$/u.test(eventId);
      const detailEntries: Array<readonly [string, BtiPart]> = [];
      if (root?.fieldlineBtiDetails !== undefined) {
        if (!Array.isArray(root.fieldlineBtiDetails)) return [];
        const seen = new Set<string>();
        for (const value of root.fieldlineBtiDetails) {
          const clock = parseClock(value, envelope, generation.order);
          const id = typeof value === "object" && value !== null ? (value as Record<string, unknown>).eventId : null;
          if (clock === null || typeof id !== "string" || id.trim() === "" || seen.has(id) ||
            (!isBatch && id !== eventId)) return [];
          seen.add(id);
          const detail = catalogForEvent(part, id, closedEventIds.has(id));
          // Missing rows only mean an authoritative empty when the successful
          // collector response explicitly includes that requested event's clock.
          if (detail === null) {
            const rows = (root.data as unknown[]).filter((row): row is unknown[] =>
              Array.isArray(row) && nativeEventId(row[0]) === id);
            if (rows.length > 0) {
              // An unresolved event shell is neither a usable partition nor
              // authoritative empty detail. It must not block its valid peers.
              if (rows.every((row) => Array.isArray(row[20]) && row[20].length === 0 &&
                (row[33] === null || row[33] === undefined || (Array.isArray(row[33]) && row[33].length === 0)))) continue;
              return [];
            }
          }
          const { unresolvedDetail: _unresolved, ...withoutUnresolved } = part;
          detailEntries.push([id, { ...withClock(detail ?? { ...withoutUnresolved, events: [], markets: [], quotes: [],
            nativeMarketObservations: [], nativeMarketIds: [], closedEventIds: new Set() }, clock, envelope) }]);
        }
        if ((root.data as unknown[]).some((row) => !Array.isArray(row) || !seen.has(String(row[0])))) return [];
      } else {
        const ids = isBatch ? [...new Set([...part.events.map((event) => event.providerEventId), ...closedEventIds,
          ...(part.nativeMarketObservations ?? []).map((observation) => observation.providerEventId)])] : [eventId];
        for (const id of ids) {
          const detail = catalogForEvent(part, id, closedEventIds.has(id));
          if (detail === null && records.length > 0) return [];
          detailEntries.push([id, detail ?? part]);
        }
      }
      if (parts.latestGeneration !== null && compareGeneration(generation.order, parts.latestGeneration) < 0) return [];
      const targetsCurrent = parts.latestGeneration !== null &&
        compareGeneration(generation.order, parts.latestGeneration) === 0;
      if (targetsCurrent) {
        let accepted = false;
        const rosterEvents = rosterByEvent(parts.lists);
        for (const [detailEventId, detail] of detailEntries) {
          if (!parts.listedEventIds.has(detailEventId)) continue;
          if (!detailMatchesRoster(detail, rosterEvents)) continue;
          const previous = parts.details.get(detailEventId);
          if (previous !== undefined && comparePartClock(detail, previous) <= 0) continue;
          accepted = true;
          parts.details.set(detailEventId, preserveClosureHistory(previous, detail));
        }
        if (!accepted) return [];
      } else {
        if (!acceptNewestGeneration(parts, generation.order)) return [];
        const pending = parts.pending.get(generation.id) ?? {
          order: generation.order, lists: new Map<string, BtiPart>(),
          details: new Map<string, BtiPart>(), listedEventIds: new Set<string>()
        };
        for (const [detailEventId, detail] of detailEntries) {
          const previous = pending.details.get(detailEventId) ?? parts.details.get(detailEventId);
          if (previous === undefined || comparePartClock(detail, previous) > 0) {
            pending.details.set(detailEventId, preserveClosureHistory(previous, detail));
          }
        }
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
          lists: new Map<string, BtiPart>(),
          details: new Map<string, BtiPart>(), listedEventIds: new Set<string>() };
        const previous = pending.lists.get(envelope.request.pathnameClass);
        if (previous !== undefined && comparePartClock(part, previous) <= 0) return [];
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
          if (!currentEventIds.has(eventId)) continue;
          const previous = parts.details.get(eventId);
          if (previous === undefined || comparePartClock(detail, previous) > 0) {
            parts.details.set(eventId, preserveClosureHistory(previous, detail));
          }
        }
        parts.lists = pending.lists;
        parts.listedEventIds = new Set(currentEventIds);
        parts.latestGeneration = pending.order;
        for (const [id, candidate] of parts.pending) {
          if (compareGeneration(candidate.order, pending.order) <= 0) parts.pending.delete(id);
        }
      }
    }
    const rosterEvents = rosterByEvent(parts.lists);
    for (const [eventId, detail] of parts.details) {
      const resolved = resolvePendingDetail(detail, parts.lists);
      if (!detailMatchesRoster(resolved, rosterEvents)) parts.details.delete(eventId);
      else if (resolved !== detail) parts.details.set(eventId, resolved);
    }
    this.#parts.set(envelope.sourceId, parts);
    if (parts.lists.size === 0) return [];
    const all = [...parts.lists.values(), ...[...parts.details.values()].flatMap((detail) =>
      [...(detail.closureHistory?.values() ?? []), detail])];
    const mergedMarkets = mergeMarketParts(all);
    const mergedEvents = new Map<string, (typeof all)[number]["events"][number]>();
    for (const event of [...parts.details.values(), ...parts.lists.values()].flatMap(({ events }) => events)) {
      const existing = mergedEvents.get(event.providerEventId);
      if (existing !== undefined && placeholderParticipants(event) && !placeholderParticipants(existing)) continue;
      mergedEvents.set(event.providerEventId, event);
    }
    const catalog: ObservedProviderCatalog = {
      ...emptyCatalog(Math.max(...all.map((value) => value.observedAtMs))),
      rejectedMarketCount: all.reduce((sum, value) => sum + value.rejectedMarketCount, 0),
      // The public roster normally owns identity, but its hidden rows can expose
      // only generic Home/Away labels. In that case retain the hydrated names
      // from event detail so cross-book event matching remains possible.
      events: [...mergedEvents.values()],
      ...mergedMarkets
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

function parseClock(value: unknown, envelope: ChromeBridgeEnvelope, generation: readonly [number, number]):
  { readonly requestedAtMs: number; readonly observedAtMs: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const originalGeneration = typeof metadata.generation === "string" ? parseGeneration(metadata.generation) : null;
  if (originalGeneration === null || compareGeneration(originalGeneration.order, generation) > 0 ||
    typeof metadata.observedAtMs !== "number" || !Number.isSafeInteger(metadata.observedAtMs) ||
    typeof metadata.requestedAtMs !== "number" || !Number.isSafeInteger(metadata.requestedAtMs) ||
    metadata.requestedAtMs < 0 || metadata.observedAtMs < metadata.requestedAtMs ||
    metadata.observedAtMs > envelope.observedAtMs) return null;
  return { observedAtMs: metadata.observedAtMs, requestedAtMs: metadata.requestedAtMs };
}

function withClock(part: BtiPart, clock: { readonly requestedAtMs: number; readonly observedAtMs: number },
  envelope: ChromeBridgeEnvelope): BtiPart {
  // These are collector receipt times, not provider-origin timestamps. Preserve
  // null sourceTimestampMs and translate cache age onto the receiver's clock.
  const receivedMonotonicMs = envelope.receivedMonotonicMs - (envelope.observedAtMs - clock.observedAtMs);
  return { ...part, ...clock,
    quotes: part.quotes.map((quote) => ({ ...quote, receivedMonotonicMs })),
    ...(part.unresolvedDetail === undefined ? {} : { unresolvedDetail: { ...part.unresolvedDetail, receivedMonotonicMs } }),
    ...(part.nativeMarketObservations === undefined ? {} : {
      nativeMarketObservations: part.nativeMarketObservations.map((observation) =>
        ({ ...observation, observedAtMs: clock.observedAtMs }))
    }) };
}

function comparePartClock(left: Pick<BtiPart, "requestedAtMs" | "observedAtMs">,
  right: Pick<BtiPart, "requestedAtMs" | "observedAtMs">): number {
  return left.requestedAtMs - right.requestedAtMs || left.observedAtMs - right.observedAtMs;
}

function retainedDetailReplay(payload: unknown, envelope: ChromeBridgeEnvelope,
  generation: readonly [number, number], parts: SourceParts): boolean {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const metadata = (payload as Record<string, unknown>).fieldlineBtiDetails;
  if (!Array.isArray(metadata) || metadata.length === 0) return false;
  // Restrict this shortcut to the current committed generation. Future
  // generations must still stage their roster ownership, even for old prices.
  return metadata.every((value) => {
    const clock = parseClock(value, envelope, generation);
    const id = typeof value === "object" && value !== null ? (value as Record<string, unknown>).eventId : null;
    const previous = typeof id === "string" ? parts.details.get(id) : undefined;
    return clock !== null && previous !== undefined && comparePartClock(clock, previous) <= 0;
  });
}

function hydrateDetailIdentity(payload: unknown, lists: ReadonlyMap<string, BtiPart> | undefined): unknown {
  if (lists === undefined || typeof payload !== "object" || payload === null || Array.isArray(payload)) return payload;
  const root = payload as Record<string, unknown>;
  if (!Array.isArray(root.data)) return payload;
  const roster = rosterByEvent(lists);
  const missing = (value: unknown): boolean => value === null || value === undefined || value === "";
  const nameText = (value: unknown): string => typeof value === "string" ? value.trim() :
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.values(value).find((name): name is string => typeof name === "string" && name.trim() !== "")?.trim() ?? "" : "";
  const sameName = (left: string, right: string): boolean => left.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en").trim() === right.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("en").trim();
  return { ...root, data: root.data.map((value) => {
    if (!Array.isArray(value)) return value;
    const eventId = nativeEventId(value[0]);
    const identity = roster.get(eventId);
    if (identity === undefined) return value;
    const event = [...value];
    if (missing(event[2])) event[2] = identity.competition;
    if (missing(event[11])) event[11] = new Date(identity.startAtUtcMs).toISOString();
    if (missing(event[13])) event[13] = identity.isLive;
    if (missing(event[8]) || Array.isArray(event[8])) {
      const participants = Array.isArray(event[8]) ? [...event[8]] : [];
      const expected = [identity.participantA, identity.participantB];
      const compatible = !placeholderParticipants(identity) && participants.slice(0, 2).every((participant, index) => {
        if (!Array.isArray(participant)) return missing(participant);
        const supplied = nameText(participant[1]) || nameText(participant[2]);
        return supplied === "" || sameName(supplied, expected[index]!);
      });
      for (const [index, name] of expected.entries()) {
        const participant = participants[index];
        if (compatible && (missing(participant) || (Array.isArray(participant) &&
          nameText(participant[1]) === "" && nameText(participant[2]) === ""))) {
          participants[index] = [Array.isArray(participant) ? participant[0] : null, { EN: name }];
        }
      }
      event[8] = participants;
    }
    return event;
  }) };
}

function resolvePendingDetail(part: BtiPart, lists: ReadonlyMap<string, BtiPart>): BtiPart {
  const unresolved = part.unresolvedDetail;
  if (unresolved === undefined) return part;
  const payload = hydrateDetailIdentity({ data: unresolved.rows }, lists);
  const records = extractBtiCatalogRecords(payload);
  if (records.length === 0) return part;
  const normalized = normalizeSbobetCatalog(records, { observedAtMs: part.observedAtMs,
    receivedMonotonicMs: unresolved.receivedMonotonicMs, sequence: unresolved.sequence, provider: "BTI",
    settlementProfile: "football-regulation-including-added-time" });
  if (normalized.events.length === 0) return part;
  const { unresolvedDetail: _unresolved, ...resolved } = part;
  return { ...resolved, events: normalized.events, markets: normalized.markets, quotes: normalized.quotes,
    rejectedMarketCount: normalized.diagnostics.length,
    nativeMarketObservations: extractBtiNativeMarketObservations(payload, part.observedAtMs) };
}

function preserveClosureHistory(previous: BtiPart | undefined, incoming: BtiPart): BtiPart {
  // The next full detail partition may omit a closed family. Keep its last
  // explicit closure separately, otherwise an older retained roster resurrects
  // that family. One snapshot per native identity bounds history to this event;
  // dropping the event partition or resetting the source drops its history too.
  const history = new Map(previous?.closureHistory);
  const retain = (key: string, closure: BtiPart): void => {
    const existing = history.get(key);
    if (existing === undefined || comparePartClock(closure, existing) > 0) history.set(key, closure);
  };
  for (const [key, closure] of incoming.closureHistory ?? []) retain(key, closure);
  const { closureHistory: _history, unresolvedDetail: _unresolved, ...current } = incoming;
  const empty = { ...current, events: [], markets: [], quotes: [], rejectedMarketCount: 0 };
  const incomingIds = new Set(incoming.nativeMarketIds.map(({ eventId, marketId }) => JSON.stringify([eventId, marketId])));
  for (const identity of previous?.nativeMarketIds ?? []) {
    const key = JSON.stringify([identity.eventId, identity.marketId]);
    if (incomingIds.has(key)) continue;
    // The completed detail no longer contains a family it previously owned.
    // This is removal evidence even when the provider sends no closed row.
    retain(key, { ...empty, closedEventIds: new Set(), nativeMarketIds: [identity],
      nativeMarketObservations: history.get(key)?.nativeMarketObservations ?? [] });
  }
  for (const eventId of incoming.closedEventIds) {
    retain(JSON.stringify([eventId, null]), { ...empty, closedEventIds: new Set([eventId]),
      nativeMarketIds: incoming.nativeMarketIds.filter((item) => item.eventId === eventId),
      nativeMarketObservations: (incoming.nativeMarketObservations ?? []).filter((item) => item.providerEventId === eventId) });
  }
  for (const observation of incoming.nativeMarketObservations ?? []) {
    if (observation.reason !== "MARKET_CLOSED" || incoming.closedEventIds.has(observation.providerEventId)) continue;
    retain(JSON.stringify([observation.providerEventId, observation.providerMarketId]), {
      ...empty, closedEventIds: new Set(), nativeMarketIds: [{ eventId: observation.providerEventId,
        marketId: observation.providerMarketId }], nativeMarketObservations: [observation]
    });
  }
  return { ...incoming, closureHistory: history };
}

function mergeMarketParts(parts: readonly BtiPart[]): Pick<ObservedProviderCatalog,
  "markets" | "quotes" | "nativeMarketObservations"> {
  const families = new Map<string, Pick<ObservedProviderCatalog, "markets" | "quotes" | "nativeMarketObservations">>();
  // Each detail response already replaced its event's previous detail partition.
  // A shallow roster only replaces native families it actually advertises.
  for (const part of [...parts].sort(comparePartClock)) {
    if (part.closedEventIds.size > 0) {
      for (const key of families.keys()) {
        if (part.closedEventIds.has(key.slice(0, key.indexOf("\u0000")))) families.delete(key);
      }
    }
    const nativeKeys = new Set(part.nativeMarketIds.filter((item) => item.marketId !== "")
      .map(({ eventId, marketId }) => `${eventId}\u0000${marketId}`));
    const familyFor = (item: { readonly providerEventId: string; readonly providerMarketId: string;
      readonly marketType?: MarketType; readonly scope?: Scope; readonly line?: string | null;
      readonly nativeScope?: string | null; readonly player?: unknown }): string | null => {
      const key = `${item.providerEventId}\u0000${item.providerMarketId}`;
      if (nativeKeys.has(key)) return key;
      // A categorical family can expose several independent canonical terms.
      // All remain owned by the exact native family for closure and replacement.
      const derived = /^(.+):([A-Z][A-Z0-9_]+):(none|-?\d+(?:\.\d+)?)(?::player:([1-9]\d*))?$/u.exec(item.providerMarketId);
      if (derived !== null) {
        const type = derived[2] as MarketType;
        const binary = footballBinaryMarketSpec(type), categorical = footballCategoricalMarketSpec(type);
        const spec = binary ?? categorical ?? footballResultMarketSpec(type);
        const linePolicy = binary?.linePolicy ?? categorical?.linePolicy ?? "NONE";
        const encodedLine = derived[3] === "none" ? null : derived[3]!;
        const family = `${item.providerEventId}\u0000${derived[1]}`;
        if (spec !== null && nativeKeys.has(family) && type.startsWith("PLAYER_") === (derived[4] !== undefined) &&
          (item.marketType === undefined || (type.startsWith("PLAYER_")
            ? isValidProviderPlayerIdentity(item.player) && item.player.providerPlayerId === derived[4]
            : item.player === undefined)) &&
          (item.marketType === undefined || item.marketType === type) &&
          (item.scope === undefined || item.scope === spec.scope) &&
          (item.nativeScope == null || item.nativeScope === spec.scope) &&
          (item.line === undefined || item.line === encodedLine) &&
          (linePolicy === "NONE" ? encodedLine === null : encodedLine !== null &&
            (linePolicy === "POSITIVE_INTEGER" ? /^[1-9]\d*$/u.test(encodedLine) && Number.isSafeInteger(Number(encodedLine))
              : linePolicy === "INTEGER" ? /^-?(?:0|[1-9]\d*)$/u.test(encodedLine) && Number.isSafeInteger(Number(encodedLine))
                : isSupportedFootballTwoWayLine(encodedLine)))) return family;
        // A malformed canonical variant cannot become an orphan that outlives
        // native family closure. Its native observation is retained below.
        return null;
      }
      if (item.marketType?.startsWith("PLAYER_") || item.player !== undefined) return null;
      const separator = item.providerMarketId.lastIndexOf(":");
      const parent = `${item.providerEventId}\u0000${item.providerMarketId.slice(0, separator)}`;
      return separator >= 0 && nativeKeys.has(parent) &&
        /^-?\d+(?:\.\d+)?$/u.test(item.providerMarketId.slice(separator + 1)) ? parent : key;
    };
    type Group = { markets: ObservedProviderCatalog["markets"][number][];
      quotes: ObservedProviderCatalog["quotes"][number][];
      nativeMarketObservations: NonNullable<ObservedProviderCatalog["nativeMarketObservations"]>[number][] };
    const groups = new Map<string, Group>([...nativeKeys].map((key) =>
      [key, { markets: [], quotes: [], nativeMarketObservations: [] }]));
    const invalidBindings = new Set<string>();
    const identityFor = (item: { readonly providerEventId: string; readonly providerMarketId: string }): string =>
      `${item.providerEventId}\u0000${item.providerMarketId}`;
    const normalizedMarketIds = new Set(part.markets.map(identityFor));
    const groupFor = (item: { readonly providerEventId: string; readonly providerMarketId: string }, retainInvalid = false): Group | null => {
      const family = familyFor(item);
      if (family === null && !retainInvalid) { invalidBindings.add(identityFor(item)); return null; }
      const key = family ?? identityFor(item);
      const group = groups.get(key) ?? { markets: [], quotes: [], nativeMarketObservations: [] };
      groups.set(key, group);
      return group;
    };
    for (const item of part.markets) groupFor(item)?.markets.push(item);
    for (const item of part.quotes) groupFor(item)?.quotes.push(item);
    for (const item of part.nativeMarketObservations ?? []) {
      const invalid = invalidBindings.has(identityFor(item)) || familyFor(item) === null ||
        (item.providerMarketId.includes(":player:") && item.disposition === "NORMALIZED" && !normalizedMarketIds.has(identityFor(item)));
      groupFor(item, true)!.nativeMarketObservations.push(invalid
        ? { ...item, disposition: "UNMAPPED", reason: "INVALID_DERIVED_MARKET_BINDING" } : item);
    }
    for (const [key, group] of groups) {
      const previous = families.get(key);
      if (!part.isDetail && previous !== undefined && group.markets.length > 0) {
        // A roster can show only one of a detail family's alternate lines.
        // Selection reuse proves a moved line; disjoint selections do not.
        const replacedMarkets = new Set(group.markets.map((item) => item.providerMarketId));
        const incomingSelections = new Set(group.quotes.map((item) => item.providerSelectionId));
        for (const quote of previous.quotes) {
          if (incomingSelections.has(quote.providerSelectionId)) replacedMarkets.add(quote.providerMarketId);
        }
        group.markets.unshift(...previous.markets.filter((item) => !replacedMarkets.has(item.providerMarketId)));
        group.quotes.unshift(...previous.quotes.filter((item) => !replacedMarkets.has(item.providerMarketId)));
        group.nativeMarketObservations.unshift(...(previous.nativeMarketObservations ?? [])
          .filter((item) => !replacedMarkets.has(item.providerMarketId) && (item.disposition === "NORMALIZED" ||
            (item.reason === "UNPAIRED_OR_INVALID_NATIVE_SELECTIONS" && !group.nativeMarketObservations.some((current) =>
              current.providerMarketId === item.providerMarketId && current.reason === item.reason)))));
      }
      families.set(key, group);
    }
  }
  const values = [...families.values()];
  return { markets: values.flatMap((value) => value.markets), quotes: values.flatMap((value) => value.quotes),
    nativeMarketObservations: values.flatMap((value) => value.nativeMarketObservations ?? []) };
}

function rosterByEvent(lists: ReadonlyMap<string, BtiPart>): Map<string, ObservedProviderCatalog["events"][number]> {
  return new Map([...lists.values()].sort(comparePartClock)
    .flatMap((part) => part.events).map((event) => [event.providerEventId, event]));
}

function detailMatchesRoster(detail: BtiPart,
  rosterEvents: ReadonlyMap<string, ObservedProviderCatalog["events"][number]>): boolean {
  return detail.events.every((event) => {
    const rosterEvent = rosterEvents.get(event.providerEventId);
    return rosterEvent === undefined || rosterEvent.isLive === event.isLive;
  });
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
      const id = nativeEventId(event[0]);
      if (id !== "") ids.add(id);
    }
  }
  return ids;
}

function nativeEventId(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" &&
    Number.isSafeInteger(value) && value >= 0 ? String(value) : "";
}

function catalogForEvent(part: BtiPart, eventId: string, explicitlyClosed = false): BtiPart | null {
  if (!explicitlyClosed && !part.events.some((event) => event.providerEventId === eventId) &&
    !(part.nativeMarketObservations ?? []).some((observation) => observation.providerEventId === eventId)) return null;
  const { unresolvedDetail, ...resolved } = part;
  const rows = unresolvedDetail?.rows.filter((row) => nativeEventId(row[0]) === eventId) ?? [];
  return {
    ...resolved,
    ...(unresolvedDetail === undefined || rows.length === 0 ? {} : { unresolvedDetail: { ...unresolvedDetail, rows } }),
    closedEventIds: new Set(part.closedEventIds.has(eventId) ? [eventId] : []),
    nativeMarketIds: part.nativeMarketIds.filter((item) => item.eventId === eventId),
    events: part.events.filter((event) => event.providerEventId === eventId),
    markets: part.markets.filter((market) => market.providerEventId === eventId),
    quotes: part.quotes.filter((quote) => quote.providerEventId === eventId),
    ...(part.nativeMarketObservations === undefined ? {} : {
      nativeMarketObservations: part.nativeMarketObservations.filter((observation) =>
        observation.providerEventId === eventId)
    })
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
