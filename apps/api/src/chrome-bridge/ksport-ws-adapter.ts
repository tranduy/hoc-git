import { normalizeSbobetCatalog, type SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope, NativeMarketObservation } from "@tool-chenh/contracts";
import { extractSbobetDirectCatalogRecords,
  extractSbobetNativeMarketObservations } from "../providers/sbobet/sbobet-direct-catalog.js";
import { SbobetStompReceiptDecoder,
  type SbobetStompProviderReceipt } from "../providers/sbobet/sbobet-stomp.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";
import { websocketLifecycleState } from "./websocket-lifecycle.js";

const ACCOUNT_ID = "catalog-source:SBOBET:FOOTBALL";

interface RetainedRecord {
  readonly record: SbobetCatalogInputRecord;
  readonly nativeMarketObservations: readonly NativeMarketObservation[];
  readonly seenAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
  readonly receiptSequence: number;
  readonly marketReceipts: ReadonlyMap<string, MarketReceipt>;
}

interface MarketReceipt {
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
  readonly provenance: "HTTP" | "WS" | "DETAIL";
}

type CatalogPartition = "live" | "today";

interface PartitionSnapshot {
  readonly records: ReadonlyMap<string, RetainedRecord>;
  readonly receiptSequence: number;
}

interface SocketEpoch {
  activeStreamId: string | null;
  activeStreamOrdinal: number | null;
  streamHighWatermark: number;
  decoder: SbobetStompReceiptDecoder | null;
  committedPartitions: Map<CatalogPartition, PartitionSnapshot>;
  generation: string;
  committedGeneration: number;
  marketReceiptHighWatermarks: Map<string, number>;
  eventReceiptHighWatermarks: Map<string, number>;
  authorityLost: boolean;
  lastEnvelopeSequence: number;
}

interface HttpEpoch {
  committedPartitions: Map<CatalogPartition, PartitionSnapshot>;
  pendingBaseline: HttpPendingBaseline | null;
  committedOrdinal: number;
  generation: string;
  authorityTabId: number | null;
}

interface HttpPendingBaseline {
  readonly generation: string;
  readonly ordinal: number;
  readonly requestStartSequence: number;
  readonly partitions: Map<CatalogPartition, PartitionSnapshot>;
}

type CatalogAuthority = "NONE" | "WS" | "HTTP";

interface SourceEpochState {
  socket: SocketEpoch | null;
  readonly http: HttpEpoch;
  wsSequenceHighWatermark: number;
  authority: CatalogAuthority;
  httpAuthorityCutoff: number | null;
  readonly details: Map<string, RetainedRecord>;
  readonly detailOrdinals: Map<string, number>;
  readonly moreReceipts: Map<string, { readonly ordinal: number; readonly sequence: number }>;
  readonly prematchAdmissions: Map<string, number>;
}

function detailOrdinal(envelope: ChromeBridgeEnvelope): number | null {
  const match = /^sbobet-detail:(0|[1-9]\d*):([1-9]\d*)$/u.exec(envelope.request.streamId ?? "");
  if (match === null || Number(match[1]) !== envelope.tabId || !Number.isSafeInteger(Number(match[2]))) return null;
  return Number(match[2]);
}

function moreOrdinal(envelope: ChromeBridgeEnvelope): number | null {
  if (envelope.request.hostname !== "be.sb21.net" ||
    envelope.request.pathnameClass !== "/api/v2/getEventBetMore" || envelope.request.method !== "GET" ||
    !envelope.request.observerRequestId) return null;
  const match = /^sbobet-more:(0|[1-9]\d*):([1-9]\d*)$/u.exec(envelope.request.streamId ?? "");
  if (match === null || Number(match[1]) !== envelope.tabId || !Number.isSafeInteger(Number(match[2]))) return null;
  return Number(match[2]);
}

function sourceEpoch(envelope: ChromeBridgeEnvelope): string {
  return envelope.sourceEpoch ?? "legacy";
}

function sourceEpochKey(envelope: ChromeBridgeEnvelope): string {
  return `${envelope.sourceId}|${sourceEpoch(envelope)}`;
}

function isKsportSocketHost(hostname: string): boolean {
  const canonical = hostname.toLowerCase();
  return canonical === "sb21.net" || canonical.endsWith(".sb21.net");
}

function receiptPartition(receipt: SbobetStompProviderReceipt): CatalogPartition | null {
  if (receipt.subscription === "subSportBookLive" || /\/1_1\/live\//u.test(receipt.destination)) return "live";
  if (receipt.subscription === "subSportBookToday" || receipt.subscription === "subSportHotMatch" ||
    /\/sports\/1_\d+\/today\//u.test(receipt.destination)) return "today";
  return null;
}

function httpGeneration(envelope: ChromeBridgeEnvelope): {
  readonly generation: string; readonly ordinal: number; readonly partition: CatalogPartition;
  readonly requestStartSequence: number
} | null {
  const request = envelope.request as ChromeBridgeEnvelope["request"] & {
    readonly providerPartition?: unknown;
    readonly providerContentIntent?: unknown;
    readonly requestStartSequence?: unknown;
  };
  const streamId = request.streamId ?? "";
  const match = /^ksport-http:(0|[1-9]\d*):([1-9]\d*)$/u.exec(streamId);
  const tabId = match === null ? Number.NaN : Number(match[1]);
  if (match === null || !Number.isSafeInteger(tabId) || tabId !== envelope.tabId ||
    streamId !== `ksport-http:${match[1]}:${match[2]}` ||
    request.providerContentIntent !== "FOOTBALL_FULL_CATALOG") return null;
  const ordinal = Number(match[2]);
  const requestStartSequence = request.requestStartSequence;
  if (!Number.isSafeInteger(ordinal) || typeof requestStartSequence !== "number" ||
    !Number.isSafeInteger(requestStartSequence) || requestStartSequence < 0) return null;
  const partition = request.providerPartition === "KSPORT_LIVE" ? "live" :
    request.providerPartition === "KSPORT_TODAY" ? "today" : null;
  if (partition === null) return null;
  return { generation: `${sourceEpoch(envelope)}:ksport-http:${match[1]}:${match[2]}`,
    ordinal, partition, requestStartSequence };
}

function isFullPartitionSnapshot(body: unknown): boolean {
  if (!Array.isArray(body)) return false;
  // getEvent returns either the league array directly or one additional
  // array per provider date group. Accept exactly those two documented wire
  // shapes; mixed/deeper wrappers and error objects remain fail-closed.
  const leagues: readonly unknown[] = body.every((value) => Array.isArray(value))
    ? body.flat(1) : body;
  if (body.some((value) => Array.isArray(value)) &&
    !body.every((value) => Array.isArray(value))) return false;
  return leagues.every((value) => {
    const league = record(value);
    if (league === null || typeof league["1"] !== "string" || league["1"].trim() === "" ||
      !Array.isArray(league["2"])) return false;
    return league["2"].every((candidate) => {
      const event = record(candidate);
      const eventId = event === null ? null : event["8"];
      const home = event === null ? null : event["2"];
      const away = event === null ? null : event["3"];
      const markets = event === null ? null : event["7"];
      return event !== null && (typeof eventId === "string" || typeof eventId === "number") &&
        /^\d+$/u.test(String(eventId)) && typeof home === "string" && home.trim() !== "" &&
        typeof away === "string" && away.trim() !== "" && home.trim() !== away.trim() &&
        markets !== null && typeof markets === "object" && !Array.isArray(markets) &&
        Object.values(markets).every((rows) => Array.isArray(rows));
    });
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isSportsbookHeartbeat(body: string): boolean {
  if (body === "h" || body.trim() === "") return true;
  const candidate = body.startsWith("a[") ? body.slice(1) : body.startsWith("[") ? body : null;
  if (candidate === null) return false;
  try {
    const values = JSON.parse(candidate) as unknown;
    return Array.isArray(values) && values.length > 0 &&
      values.every((value) => typeof value === "string" && value.trim() === "");
  } catch { return false; }
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
  readonly #states = new Map<string, SourceEpochState>();

  resetSource(sourceId: string): void {
    for (const key of this.#states.keys()) if (key.startsWith(`${sourceId}|`)) this.#states.delete(key);
  }

  #stateFor(envelope: ChromeBridgeEnvelope): SourceEpochState {
    const key = sourceEpochKey(envelope);
    const existing = this.#states.get(key);
    if (existing !== undefined) return existing;
    const created: SourceEpochState = {
      socket: null,
      http: { committedPartitions: new Map<CatalogPartition, PartitionSnapshot>(),
        pendingBaseline: null, committedOrdinal: 0, authorityTabId: null,
        generation: `${sourceEpoch(envelope)}:ksport-http:${envelope.tabId}:0` },
      wsSequenceHighWatermark: 0,
      authority: "NONE",
      httpAuthorityCutoff: null,
      details: new Map(), detailOrdinals: new Map(), moreReceipts: new Map(), prematchAdmissions: new Map()
    };
    this.#states.set(key, created);
    return created;
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "KSPORT" || envelope.payload.encoding !== "UTF8") return false;
    if (envelope.transport === "HTTP_RESPONSE") {
      if (moreOrdinal(envelope) !== null) return true;
      return envelope.request.pathnameClass === "/api/v2/getEvent" &&
        (httpGeneration(envelope) !== null || detailOrdinal(envelope) !== null);
    }
    const providerSocket = isKsportSocketHost(envelope.request.hostname) &&
      envelope.request.pathnameClass.startsWith("/sport/");
    if (!providerSocket || envelope.request.streamId === undefined ||
      wsStreamOrdinal(envelope.request.streamId) === null) return false;
    if (envelope.transport === "WS_STATE") return websocketLifecycleState(envelope) !== null;
    if (envelope.transport !== "WS_FRAME") return false;
    return envelope.payload.body.includes("destination:/topic/sports/") || !envelope.payload.body.includes("destination:");
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    // Retained extension snapshots are recovery hints, not provider-current
    // evidence. In particular, do not advance the stream fence or baseline
    // cursor: a fresh copy of the same provider generation must still be able
    // to establish authority after an API/bridge reconnect.
    if (envelope.request.replayed === true) return [];
    const source = this.#stateFor(envelope);
    if (envelope.transport === "HTTP_RESPONSE" && moreOrdinal(envelope) !== null) {
      if (!applyEventMore(source, envelope)) return [];
      const catalog = catalogFromPartitions(source.http.committedPartitions, envelope.observedAtMs, source.details);
      // The retained HTTP roster still owns this materialized catalog. An
      // explicit row invalidation can withdraw its last quote; More omission
      // and empty responses never reach this branch or prove completeness.
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        value: catalog, ...emptyMarketProof(source, catalog), evidenceMode: "DELTA",
        generation: source.http.generation, provenance: "AUTHENTICATED_HTTP" }];
    }
    if (envelope.transport === "HTTP_RESPONSE" && detailOrdinal(envelope) !== null) {
      if (!applyEventDetail(source, envelope)) return [];
      const catalog = catalogFromPartitions(source.http.committedPartitions, envelope.observedAtMs, source.details);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        value: catalog, ...emptyMarketProof(source, catalog),
        evidenceMode: "DELTA", generation: source.http.generation, provenance: "AUTHENTICATED_HTTP" }];
    }
    if (envelope.transport === "HTTP_RESPONSE") {
      const requestGeneration = httpGeneration(envelope);
      if (requestGeneration === null) return [];
      if (source.wsSequenceHighWatermark > requestGeneration.requestStartSequence) return [];
      let body: unknown;
      try { body = JSON.parse(envelope.payload.body) as unknown; } catch { return []; }
      if (!isFullPartitionSnapshot(body)) return [];
      const bootstrap = bootstrapRecords(body, requestGeneration.partition === "live");
      const changed = extractSbobetDirectCatalogRecords(body, bootstrap);
      const nativeMarketObservations = extractSbobetNativeMarketObservations(body, bootstrap, envelope.observedAtMs);
      if (bootstrap.length > 0 && changed.length === 0) return [];
      const epoch = source.http;
      if (requestGeneration.ordinal <= epoch.committedOrdinal ||
        (epoch.pendingBaseline !== null && requestGeneration.ordinal < epoch.pendingBaseline.ordinal)) return [];
      if (epoch.pendingBaseline === null || requestGeneration.ordinal > epoch.pendingBaseline.ordinal) {
        epoch.pendingBaseline = { generation: requestGeneration.generation,
          ordinal: requestGeneration.ordinal,
          requestStartSequence: requestGeneration.requestStartSequence,
          partitions: new Map<CatalogPartition, PartitionSnapshot>() };
      }
      if (epoch.pendingBaseline.generation !== requestGeneration.generation ||
        epoch.pendingBaseline.requestStartSequence !== requestGeneration.requestStartSequence) return [];
      const prior = epoch.pendingBaseline.partitions.get(requestGeneration.partition);
      if (prior !== undefined && envelope.sequence <= prior.receiptSequence) return [];
      const records = new Map<string, RetainedRecord>();
      for (const record of changed) records.set(record.eventId,
        retainedRecord(record, envelope, envelope.sequence,
          nativeMarketObservations.filter((observation) => observation.providerEventId === record.eventId), "HTTP"));
      epoch.pendingBaseline.partitions.set(requestGeneration.partition,
        { records, receiptSequence: envelope.sequence });
      if (!epoch.pendingBaseline.partitions.has("live") || !epoch.pendingBaseline.partitions.has("today")) return [];
      if (source.wsSequenceHighWatermark > epoch.pendingBaseline.requestStartSequence) {
        epoch.pendingBaseline = null;
        return [];
      }
      const committedCutoff = epoch.pendingBaseline.requestStartSequence;
      const priorPartitions = new Map([...epoch.committedPartitions].map(([partition, snapshot]) =>
        [partition, { ...snapshot, records: new Map([...snapshot.records].map(([id, entry]) =>
          [id, combineDetail(entry, source.details.get(id))])) }] as const));
      epoch.committedPartitions = reconcileHttpSnapshot(epoch.pendingBaseline, priorPartitions);
      epoch.committedOrdinal = epoch.pendingBaseline.ordinal;
      epoch.generation = epoch.pendingBaseline.generation;
      epoch.authorityTabId = envelope.tabId;
      epoch.pendingBaseline = null;
      source.authority = "HTTP";
      source.httpAuthorityCutoff = committedCutoff;
      for (const eventId of new Set([...source.prematchAdmissions.keys(),
        ...epoch.committedPartitions.get("today")!.records.keys()])) {
        syncPrematchAdmission(source, eventId, envelope.sequence);
      }
      const catalog = catalogFromPartitions(epoch.committedPartitions, envelope.observedAtMs, source.details);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, value: catalog,
        authoritativeBaseline: true, evidenceMode: "BASELINE",
        ...emptyMarketProof(source, catalog),
        generation: epoch.generation, provenance: "AUTHENTICATED_HTTP" }];
    }
    const streamId = envelope.request.streamId!;
    const streamOrdinal = wsStreamOrdinal(streamId)!;
    if (envelope.transport === "WS_STATE") {
      const lifecycle = websocketLifecycleState(envelope);
      if (lifecycle === null) return [];
      if (lifecycle === "OPEN") {
        const current = source.socket;
        if (current?.activeStreamId === streamId) return [];
        if (current !== null && streamOrdinal <= current.streamHighWatermark) return [];
        const retiresAuthority = source.authority === "WS" && current !== null &&
          hasCommittedSocketAuthority(current);
        source.socket = socketEpoch(sourceEpoch(envelope), streamId, streamOrdinal);
        if (retiresAuthority) source.authority = "NONE";
        return retiresAuthority ? [streamGap(envelope)] : [];
      }
      const current = source.socket;
      if (current?.activeStreamId !== streamId || current.activeStreamOrdinal !== streamOrdinal) return [];
      current.activeStreamId = null;
      current.activeStreamOrdinal = null;
      current.decoder = null;
      current.committedPartitions = new Map();
        current.generation = `${sourceEpoch(envelope)}:ksport-ws:${streamId}:closed`;
      current.committedGeneration = 0;
      current.authorityLost = true;
      if (source.authority === "HTTP") return [];
      source.authority = "NONE";
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_CLOSED" }];
    }
    let epoch = source.socket;
    if (epoch === null || streamOrdinal > epoch.streamHighWatermark) {
      epoch = socketEpoch(sourceEpoch(envelope), streamId, streamOrdinal);
      source.socket = epoch;
    }
    if (epoch.activeStreamId !== streamId || epoch.activeStreamOrdinal !== streamOrdinal ||
      epoch.decoder === null) return [];
    if (envelope.sequence <= epoch.lastEnvelopeSequence) return [];
    epoch.lastEnvelopeSequence = envelope.sequence;
    if (isSportsbookHeartbeat(envelope.payload.body)) return [];
    const receipts = epoch.decoder.push(envelope.payload.body);
    // Measured 2026-08-30 on the live book: per-event updates arrive in the
    // exact league-array wire shape of a full snapshot (1-2 events per frame),
    // and the today topic (subSportHotMatch) never sends a genuine full
    // snapshot at all. A fragment "pair" that completed the old socket
    // handover replaced the 142-event book with a 62-event one and then froze
    // it. No WS receipt is trustworthy as a baseline here: the HTTP getEvent
    // pair is the only catalog authority, and WS receipts only upsert into it
    // once they are past the committed baseline's request fence.
    // wsSequenceHighWatermark is deliberately left untouched - advancing it
    // from socket traffic would discard every future HTTP baseline via the
    // pending-baseline fence.
    let appliedHttpLaneDelta = false;
    for (const receipt of receipts) {
      const partition = receiptPartition(receipt);
      if (partition === null) continue;
      if (source.authority !== "HTTP" || source.httpAuthorityCutoff === null ||
        envelope.sequence <= source.httpAuthorityCutoff) continue;
      appliedHttpLaneDelta = applyHttpLaneDelta(source, epoch, receipt, partition, envelope) ||
        appliedHttpLaneDelta;
    }
    if (!appliedHttpLaneDelta) return [];
    const catalog = catalogFromPartitions(source.http.committedPartitions, envelope.observedAtMs, source.details);
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog, evidenceMode: "DELTA",
      generation: source.http.generation, provenance: "WS", ...emptyMarketProof(source, catalog) }];
  }
}

/** The complete materialized catalog remains owned by the current HTTP pair, including applied deltas. */
function emptyMarketProof(source: SourceEpochState,
  catalog: ReturnType<typeof catalogFromPartitions>): { authoritativeEmptyMarkets?: true } {
  return source.authority === "HTTP" && source.httpAuthorityCutoff !== null &&
    source.http.committedPartitions.has("live") && source.http.committedPartitions.has("today") &&
    catalog.events.length > 0 && catalog.markets.length === 0 && catalog.quotes.length === 0
    ? { authoritativeEmptyMarkets: true } : {};
}

function hasCommittedSocketAuthority(epoch: SocketEpoch): boolean {
  return !epoch.authorityLost && epoch.committedGeneration > 0 &&
    epoch.committedPartitions.has("live") && epoch.committedPartitions.has("today");
}

function streamGap(envelope: ChromeBridgeEnvelope): DecodedCatalogUpdate {
  return { sourceId: envelope.sourceId, sequence: envelope.sequence,
    observedAtMs: envelope.observedAtMs, invalidateAccountId: ACCOUNT_ID,
    reason: "PROVIDER_STREAM_GAP" };
}

function wsStreamOrdinal(streamId: string): number | null {
  // Current extension envelopes use canonical positive decimals. Keep the
  // characterized pre-canonical fixture form as an exact alias while refusing
  // arbitrary opaque IDs, which cannot provide a bounded retirement fence.
  const match = /^(?:ksport-stream-)?([1-9]\d*)$/u.exec(streamId);
  if (match === null) return null;
  const ordinal = Number(match[1]);
  return Number.isSafeInteger(ordinal) ? ordinal : null;
}

function socketEpoch(epoch: string, streamId: string, streamOrdinal: number): SocketEpoch {
  return { activeStreamId: streamId, activeStreamOrdinal: streamOrdinal,
    streamHighWatermark: streamOrdinal, decoder: new SbobetStompReceiptDecoder(),
    committedPartitions: new Map<CatalogPartition, PartitionSnapshot>(),
    generation: `${epoch}:ksport-ws:${streamId}:0`, committedGeneration: 0,
    marketReceiptHighWatermarks: new Map(), eventReceiptHighWatermarks: new Map(),
    authorityLost: false, lastEnvelopeSequence: -1 };
}

function catalogFromPartitions(partitions: ReadonlyMap<CatalogPartition, PartitionSnapshot>,
  observedAtMs: number, details: ReadonlyMap<string, RetainedRecord> = new Map()): ReturnType<typeof mergeObservedCatalogParts> {
  const retained = new Map<string, RetainedRecord>();
  for (const partition of ["today", "live"] as const) {
    const snapshot = partitions.get(partition);
    if (snapshot === undefined) continue;
    for (const [eventId, entry] of snapshot.records) retainNewest(retained, eventId, entry);
  }
  const parts: NormalizedCatalogPart[] = [];
  for (const mainEntry of retained.values()) {
    const entry = combineDetail(mainEntry, details.get(mainEntry.record.eventId));
    const normalized = normalizeSbobetCatalog([entry.record], {
      observedAtMs: entry.seenAtMs, receivedMonotonicMs: entry.receivedMonotonicMs,
      sequence: entry.sequence, provider: "SBOBET",
      settlementProfile: "football-regulation-including-added-time"
    });
    parts.push({ ...normalized, quotes: normalized.quotes.map((quote) => {
      const receipt = entry.marketReceipts.get(quote.providerMarketId);
      return receipt === undefined ? quote : { ...quote,
        receivedMonotonicMs: receipt.receivedMonotonicMs, sequence: receipt.sequence };
    }), nativeMarketObservations: entry.nativeMarketObservations });
  }
  const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SBOBET", observedAtMs, parts });
  const normalizedMarketIds = new Set(catalog.markets.map((market) =>
    `${market.providerEventId}\u0000${market.providerMarketId}`));
  // Native extraction may observe duplicate event containers that were not
  // retained as canonical membership. Account against the final publication.
  return { ...catalog, nativeMarketObservations: (catalog.nativeMarketObservations ?? []).map((observation) =>
    observation.disposition === "NORMALIZED" && !normalizedMarketIds.has(
      `${observation.providerEventId}\u0000${observation.providerMarketId}`)
      ? { ...observation, disposition: "EXCLUDED" as const, reason: "NORMALIZATION_REJECTED" }
      : observation) };
}

/**
 * Folds one non-full WS receipt into the committed HTTP baseline. The record
 * fence is the envelope sequence: it is monotonic per source, and the caller
 * has already required it to be past the baseline's request-start cutoff, so
 * a delta can never drag the catalog behind the baseline it lands on.
 */
function applyHttpLaneDelta(source: SourceEpochState, epoch: SocketEpoch, receipt: SbobetStompProviderReceipt,
  partition: CatalogPartition, envelope: ChromeBridgeEnvelope): boolean {
  const order = receipt.receiptSequence;
  if (order === null) return false;
  const committed = source.http.committedPartitions.get(partition);
  if (committed === undefined) return false;
  // Existing roster metadata is authoritative for a sparse event update. An
  // event-only receipt must not replace the real competition with a default.
  const bootstrap = [...new Map([
    ...bootstrapRecords(receipt.body, partition === "live"),
    ...[...source.http.committedPartitions.values()].flatMap((snapshot) =>
      [...snapshot.records.values()].map((entry) => entry.record)),
    ...[...committed.records.values()].map((entry) => entry.record)
  ].map((entry) => [entry.eventId, { ...entry, timeText: partition === "live" ? "LIVE" : "PREMATCH" }])).values()];
  const changed = extractSbobetDirectCatalogRecords(receipt.body, bootstrap);
  const nativeMarketObservations = extractSbobetNativeMarketObservations(receipt.body, bootstrap,
    envelope.observedAtMs);
  if (changed.length === 0) return false;
  const records = new Map(committed.records);
  const appliedEventIds: string[] = [];
  let applied = false;
  for (const decoded of changed) {
    const existingEntry = records.get(decoded.eventId);
    if (existingEntry !== undefined && envelope.sequence < existingEntry.sequence) continue;
    const live = partition === "live" ? existingEntry :
      source.http.committedPartitions.get("live")?.records.get(decoded.eventId);
    const today = partition === "today" ? existingEntry :
      source.http.committedPartitions.get("today")?.records.get(decoded.eventId);
    const current = live === undefined ? today : today === undefined || live.receiptSequence >= today.receiptSequence
      ? live : today;
    const metadataIsNew = order > (epoch.eventReceiptHighWatermarks.get(decoded.eventId) ?? -1);
    // Different market rows can arrive out of order within one partition. Their
    // prices remain useful, but old identity/phase evidence cannot retire detail.
    if (!metadataIsNew && current !== undefined && current.record.timeText !== decoded.timeText) continue;
    const marketKey = (id: string): string => `${partition}\u0000${decoded.eventId}\u0000${id}`;
    const observations = nativeMarketObservations.filter((observation) => observation.providerEventId === decoded.eventId);
    const acceptedIds = new Set([...decoded.markets.map((market) => market.marketId),
      ...observations.flatMap((observation) => observation.providerMarketId === null ? [] : [observation.providerMarketId])]
      .filter((id) => order > (epoch.marketReceiptHighWatermarks.get(marketKey(id)) ?? -1)));
    if (!metadataIsNew && acceptedIds.size === 0) continue;
    const incoming = { ...(!metadataIsNew && current !== undefined ? current.record : decoded),
      markets: decoded.markets.filter((market) => acceptedIds.has(market.marketId)) };
    const existing = existingEntry?.record;
    const detail = source.details.get(incoming.eventId);
    const incomingObservations = observations.filter((observation) =>
      observation.providerMarketId !== null && acceptedIds.has(observation.providerMarketId));
    if (partition === "live") source.details.delete(incoming.eventId);
    const hiddenOnly = (id: string): boolean => partition === "today" && detail !== undefined &&
      detail.marketReceipts.has(id) && !existingEntry?.marketReceipts.has(id);
    const mainIncoming = { ...incoming, markets: incoming.markets.filter((market) => !hiddenOnly(market.marketId)) };
    const mainObservations = incomingObservations.filter((observation) =>
      observation.providerMarketId === null || !hiddenOnly(observation.providerMarketId));
    const mergedObservations = [...new Map([...(existingEntry?.nativeMarketObservations ?? []),
      ...mainObservations].map((observation) => [
        `${observation.providerMarketId}\u0000${observation.nativeType}`, observation
      ])).values()];
    const next = retainedRecord(mainIncoming, envelope, envelope.sequence, mainObservations, "WS");
    const touchedIds = new Set(mainObservations.flatMap((observation) =>
      observation.providerMarketId === null ? [] : [observation.providerMarketId]));
    records.set(incoming.eventId, { ...next, nativeMarketObservations: mergedObservations,
      record: mergeDeltaRecord(existing, mainIncoming, touchedIds),
      marketReceipts: new Map([...(existingEntry?.marketReceipts ?? []), ...next.marketReceipts]) });
    if (partition === "today" && detail !== undefined && envelope.sequence >= detail.sequence) {
      const detailIncoming = { ...incoming, markets: incoming.markets.filter((market) =>
        detail.marketReceipts.has(market.marketId)) };
      const detailObservations = incomingObservations.filter((observation) =>
        observation.providerMarketId !== null && detail.marketReceipts.has(observation.providerMarketId));
      const detailTouched = new Set(detailObservations.map((observation) => observation.providerMarketId!));
      const nextDetail = retainedRecord(detailIncoming, envelope, envelope.sequence, detailObservations, "WS");
      source.details.set(incoming.eventId, { ...nextDetail,
        record: mergeDeltaRecord(detail.record, detailIncoming, detailTouched),
        marketReceipts: new Map([...detail.marketReceipts, ...nextDetail.marketReceipts]),
        nativeMarketObservations: [...new Map([...detail.nativeMarketObservations, ...detailObservations]
          .map((observation) => [`${observation.providerMarketId}\u0000${observation.nativeType}`, observation])).values()] });
    }
    for (const id of acceptedIds) epoch.marketReceiptHighWatermarks.set(marketKey(id), order);
    if (metadataIsNew) epoch.eventReceiptHighWatermarks.set(incoming.eventId, order);
    appliedEventIds.push(incoming.eventId);
    applied = true;
  }
  if (!applied) return false;
  source.http.committedPartitions.set(partition,
    { records, receiptSequence: Math.max(committed.receiptSequence, envelope.sequence) });
  for (const eventId of appliedEventIds) syncPrematchAdmission(source, eventId, envelope.sequence);
  return true;
}

function retainedRecord(record: SbobetCatalogInputRecord, envelope: ChromeBridgeEnvelope,
  receiptSequence: number, nativeMarketObservations: readonly NativeMarketObservation[] = [],
  provenance: MarketReceipt["provenance"] = "WS"): RetainedRecord {
  return { record, seenAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
    sequence: envelope.sequence, receiptSequence, nativeMarketObservations,
    marketReceipts: new Map([...new Set([...record.markets.map((market) => market.marketId),
      ...nativeMarketObservations.flatMap((observation) =>
        observation.providerMarketId === null ? [] : [observation.providerMarketId])])].map((marketId) => [marketId, {
      receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence, provenance
    }])) };
}

function prematchEntry(source: SourceEpochState, eventId: string): RetainedRecord | undefined {
  const today = source.http.committedPartitions.get("today")?.records.get(eventId);
  const live = source.http.committedPartitions.get("live")?.records.get(eventId);
  // Overlapping HTTP partitions do not prove a transition back to prematch.
  // Only removal from the complete live membership permits event detail again.
  return live === undefined ? today : undefined;
}

function syncPrematchAdmission(source: SourceEpochState, eventId: string, sequence: number): void {
  if (prematchEntry(source, eventId) === undefined) {
    source.prematchAdmissions.delete(eventId);
    source.details.delete(eventId);
    source.detailOrdinals.delete(eventId);
    source.moreReceipts.delete(eventId);
  } else if (!source.prematchAdmissions.has(eventId)) {
    // Ordinary refreshes retain this floor; disappearance or a live phase
    // ends the membership, so a later same-ID admission receives a new floor.
    source.prematchAdmissions.set(eventId, sequence);
  }
}

function combineDetail(main: RetainedRecord, detail: RetainedRecord | undefined): RetainedRecord {
  if (detail === undefined || main.record.timeText !== "PREMATCH") return main;
  const markets = new Map(main.record.markets.map((market) => [market.marketId, market]));
  const detailMarkets = new Map(detail.record.markets.map((market) => [market.marketId, market]));
  const marketReceipts = new Map(main.marketReceipts);
  const observations = new Map(main.nativeMarketObservations.map((observation) =>
    [`${observation.providerMarketId}\u0000${observation.nativeType}`, observation]));
  for (const [id, clock] of detail.marketReceipts) {
    if ((marketReceipts.get(id)?.sequence ?? -1) > clock.sequence) continue;
    marketReceipts.set(id, clock);
    const market = detailMarkets.get(id);
    if (market === undefined) markets.delete(id); else markets.set(id, market);
  }
  for (const observation of detail.nativeMarketObservations) {
    const id = observation.providerMarketId;
    if (id !== null && (main.marketReceipts.get(id)?.sequence ?? -1) >
      (detail.marketReceipts.get(id)?.sequence ?? -1)) continue;
    observations.set(`${id}\u0000${observation.nativeType}`, observation);
  }
  for (const [key, observation] of observations) {
    const id = observation.providerMarketId;
    if (id !== null && !detail.nativeMarketObservations.some((candidate) => candidate.providerMarketId === id) &&
      (detail.marketReceipts.get(id)?.sequence ?? -1) >= (main.marketReceipts.get(id)?.sequence ?? 0)) {
      observations.delete(key);
    }
  }
  return { ...main, record: { ...main.record, markets: [...markets.values()] },
    marketReceipts, nativeMarketObservations: [...observations.values()] };
}

function applyEventMore(source: SourceEpochState, envelope: ChromeBridgeEnvelope): boolean {
  if (source.authority !== "HTTP" || envelope.sourceEpoch === undefined ||
    source.http.authorityTabId !== envelope.tabId) return false;
  let payload: Record<string, unknown> | null;
  try { payload = record(JSON.parse(envelope.payload.body)); } catch { return false; }
  const cutoff = envelope.request.reconcileCutoffSequence;
  if (payload === null || payload.kind !== "SBOBET_EVENT_MORE" ||
    payload.generation !== envelope.sourceEpoch || payload.marketContainerComplete !== false ||
    payload.observedAtMs !== envelope.observedAtMs || typeof cutoff !== "number" ||
    !Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff >= envelope.sequence ||
    payload.requestStartSequence !== cutoff || typeof payload.eventId !== "string" ||
    !/^\d{1,30}$/u.test(payload.eventId) || typeof payload.leagueId !== "string" ||
    !/^\d{1,30}$/u.test(payload.leagueId)) return false;
  const eventId = payload.eventId;
  const admission = source.prematchAdmissions.get(eventId);
  const main = prematchEntry(source, eventId);
  const ordinal = moreOrdinal(envelope)!;
  const previousMore = source.moreReceipts.get(eventId);
  const priorDetail = source.details.get(eventId);
  if (admission === undefined || cutoff < admission || main?.record.timeText !== "PREMATCH" ||
    ordinal <= (previousMore?.ordinal ?? 0) || envelope.sequence <= (previousMore?.sequence ?? -1) ||
    envelope.sequence <= (priorDetail?.sequence ?? -1) ||
    [...source.http.committedPartitions.values()].some((partition) => envelope.sequence <= partition.receiptSequence)) return false;
  const groups = record(payload.groups);
  if (groups === null) return false;
  // getEventBetMore is an observed flat native group map. A successful empty
  // map or omitted group is not evidence of market absence. Key 0 is metadata.
  for (const [key, rows] of Object.entries(groups)) {
    if (!/^\d{1,4}$/u.test(key) || !Array.isArray(rows)) return false;
    for (const row of rows) {
      if (typeof row !== "string") return false;
      for (const token of row.trim().split(/\s+/u)) {
        if (!token.includes("*")) continue;
        const selection = /^[+-]?\d+(?:\.\d+)?\*(\d{1,40}[A-Za-z]?)$/u.exec(token);
        if (selection === null || !selection[1]!.startsWith(eventId)) return false;
      }
    }
  }
  const native = { "8": eventId, "7": Object.fromEntries(Object.entries(groups).filter(([key]) => key !== "0")) };
  const incoming = extractSbobetDirectCatalogRecords(native, [main.record])[0];
  if (incoming === undefined) return false;
  const observations = extractSbobetNativeMarketObservations(native, [main.record], envelope.observedAtMs);
  const next = retainedRecord(incoming, envelope, envelope.sequence, observations, "DETAIL");
  source.moreReceipts.set(eventId, { ordinal, sequence: envelope.sequence });
  if (next.marketReceipts.size === 0) return false;

  const previous = combineDetail(main, priorDetail);
  // Only identities actually observed in More join retained detail membership.
  // Copy a newer current receipt for a touched identity so a later shallow main
  // refresh cannot discard the identity or replace its original price clock.
  const markets = new Map(priorDetail?.record.markets.map((market) => [market.marketId, market]));
  const receipts = new Map(priorDetail?.marketReceipts);
  const inventory = new Map(priorDetail?.nativeMarketObservations.map((observation) =>
    [`${observation.providerMarketId}\u0000${observation.nativeType}`, observation]));
  for (const [id, receipt] of next.marketReceipts) {
    const newerReceipt = previous.marketReceipts.get(id);
    const keepNewer = newerReceipt !== undefined && newerReceipt.sequence > cutoff;
    const record = keepNewer ? previous : next;
    const market = record.record.markets.find((candidate) => candidate.marketId === id);
    if (market === undefined) markets.delete(id); else markets.set(id, market);
    receipts.set(id, keepNewer ? newerReceipt : receipt);
    for (const [key, observation] of inventory) if (observation.providerMarketId === id) inventory.delete(key);
    for (const observation of record.nativeMarketObservations) {
      if (observation.providerMarketId === id) inventory.set(`${id}\u0000${observation.nativeType}`, observation);
    }
  }
  source.details.set(eventId, { ...next, record: { ...main.record, markets: [...markets.values()] },
    marketReceipts: receipts, nativeMarketObservations: [...inventory.values()] });
  return true;
}

function applyEventDetail(source: SourceEpochState, envelope: ChromeBridgeEnvelope): boolean {
  if (source.authority !== "HTTP" || envelope.sourceEpoch === undefined) return false;
  let payload: Record<string, unknown> | null;
  try { payload = record(JSON.parse(envelope.payload.body)); } catch { return false; }
  const cutoff = envelope.request.reconcileCutoffSequence;
  if (payload === null || payload.kind !== "SBOBET_EVENT_DETAIL" ||
    payload.generation !== envelope.sourceEpoch || payload.marketContainerComplete !== true ||
    payload.observedAtMs !== envelope.observedAtMs || typeof cutoff !== "number" ||
    !Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff >= envelope.sequence ||
    payload.requestStartSequence !== cutoff || typeof payload.eventId !== "string" ||
    !/^\d{1,30}$/u.test(payload.eventId)) return false;
  const eventId = payload.eventId;
  const admissionSequence = source.prematchAdmissions.get(eventId);
  if (admissionSequence === undefined || cutoff < admissionSequence) return false;
  const ordinal = detailOrdinal(envelope)!;
  if (ordinal <= (source.detailOrdinals.get(eventId) ?? 0) ||
    envelope.sequence <= (source.details.get(eventId)?.sequence ?? -1)) return false;
  const main = prematchEntry(source, eventId);
  const native = record(payload.event);
  const groups = native === null ? null : record(native["7"]);
  if (main === undefined || native === null || String(native["8"]) !== eventId || groups === null ||
    Object.values(groups).some((rows) => !Array.isArray(rows)) ||
    (native["2"] !== undefined && native["2"] !== main.record.teamNames[0]) ||
    (native["3"] !== undefined && native["3"] !== main.record.teamNames[1])) return false;
  const incoming = extractSbobetDirectCatalogRecords(native, [main.record])[0];
  if (incoming === undefined) return false;
  const observations = extractSbobetNativeMarketObservations(native, [main.record], envelope.observedAtMs);
  const next = retainedRecord(incoming, envelope, envelope.sequence, observations, "DETAIL");
  const previous = combineDetail(main, source.details.get(eventId));
  const reconciled = reconcileHttpSnapshot({ generation: envelope.sourceEpoch, ordinal,
    requestStartSequence: cutoff, partitions: new Map([["today", {
      records: new Map([[eventId, next]]), receiptSequence: envelope.sequence
    }]]) }, new Map([["today", { records: new Map([[eventId, previous]]),
      receiptSequence: previous.receiptSequence }]]), true);
  const detail = reconciled.get("today")!.records.get(eventId)!;
  const marketReceipts = new Map(detail.marketReceipts);
  // A proven complete detail also proves absence. Retain that withdrawal's
  // receipt fence so a main request already in flight cannot resurrect it.
  for (const [id, priorReceipt] of previous.marketReceipts) {
    if (marketReceipts.has(id) || priorReceipt.sequence > cutoff) continue;
    marketReceipts.set(id, { sequence: envelope.sequence,
      receivedMonotonicMs: envelope.receivedMonotonicMs, provenance: "DETAIL" });
  }
  source.details.set(eventId, { ...detail, marketReceipts });
  source.detailOrdinals.set(eventId, ordinal);
  return true;
}

function reconcileHttpSnapshot(pending: HttpPendingBaseline,
  previous: ReadonlyMap<CatalogPartition, PartitionSnapshot>, preserveHttpPrices = false): Map<CatalogPartition, PartitionSnapshot> {
  const partitions = new Map<CatalogPartition, PartitionSnapshot>();
  for (const [partition, snapshot] of pending.partitions) {
    const records = new Map(snapshot.records);
    for (const [eventId, incoming] of records) {
      const prior = previous.get(partition)?.records.get(eventId);
      if (prior === undefined) continue;
      const marketReceipts = new Map(incoming.marketReceipts);
      const newerIds = new Set<string>();
      const priorMarkets = new Map(prior.record.markets.map((market) => [market.marketId, market]));
      // HTTP owns membership. Only identities present in this full snapshot
      // may keep a newer socket price, received after the HTTP request began.
      for (const [id, clock] of prior.marketReceipts) {
        if ((preserveHttpPrices || clock.provenance !== "HTTP") &&
          clock.sequence > pending.requestStartSequence && (preserveHttpPrices || marketReceipts.has(id))) {
          marketReceipts.set(id, clock);
          newerIds.add(id);
        }
      }
      const markets = new Map(incoming.record.markets.map((market) => [market.marketId, market]));
      for (const id of newerIds) {
        const newer = priorMarkets.get(id);
        // Preserve new rows and withdrawals even when the older response
        // omitted them or its invalid native row produced no normalized quote.
        if (newer === undefined) markets.delete(id); else markets.set(id, newer);
      }
      const nativeMarketObservations = incoming.nativeMarketObservations.map((observation) =>
        newerIds.has(observation.providerMarketId ?? "") ? prior.nativeMarketObservations.find((candidate) =>
          candidate.providerMarketId === observation.providerMarketId && candidate.nativeType === observation.nativeType)
          ?? observation : observation);
      for (const observation of prior.nativeMarketObservations) {
        if (newerIds.has(observation.providerMarketId ?? "") && !nativeMarketObservations.some((candidate) =>
          candidate.providerMarketId === observation.providerMarketId && candidate.nativeType === observation.nativeType)) {
          nativeMarketObservations.push(observation);
        }
      }
      records.set(eventId, { ...incoming, record: { ...incoming.record, markets: [...markets.values()] },
        marketReceipts, nativeMarketObservations });
    }
    partitions.set(partition, { ...snapshot, records });
  }
  return partitions;
}

function mergeDeltaRecord(existing: SbobetCatalogInputRecord | undefined,
  incoming: SbobetCatalogInputRecord, touchedIds: ReadonlySet<string>): SbobetCatalogInputRecord {
  if (existing === undefined) return incoming;
  return { ...existing, ...incoming,
    markets: [...new Map([...existing.markets.filter((market) => !touchedIds.has(market.marketId)), ...incoming.markets]
      .map((market) => [market.marketId, market])).values()] };
}

function retainNewest(retained: Map<string, RetainedRecord>, eventId: string, incoming: RetainedRecord): void {
  const current = retained.get(eventId);
  // Iteration is today then live, so an exact receipt tie remains
  // deterministically live-preferring while any newer evidence wins.
  if (current === undefined || incoming.receiptSequence >= current.receiptSequence) {
    retained.set(eventId, incoming);
  }
}
