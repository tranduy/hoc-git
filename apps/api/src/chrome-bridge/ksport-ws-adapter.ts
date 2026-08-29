import { normalizeSbobetCatalog, type SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { extractSbobetDirectCatalogRecords } from "../providers/sbobet/sbobet-direct-catalog.js";
import { SbobetStompReceiptDecoder,
  type SbobetStompProviderReceipt } from "../providers/sbobet/sbobet-stomp.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";
import { websocketLifecycleState } from "./websocket-lifecycle.js";

const ACCOUNT_ID = "catalog-source:SBOBET:FOOTBALL";

interface RetainedRecord {
  readonly record: SbobetCatalogInputRecord;
  readonly seenAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
  readonly receiptSequence: number;
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
  receiptHighWatermarks: Map<CatalogPartition, number>;
  authorityLost: boolean;
}

interface HttpEpoch {
  committedPartitions: Map<CatalogPartition, PartitionSnapshot>;
  pendingBaseline: HttpPendingBaseline | null;
  committedOrdinal: number;
  generation: string;
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
        markets !== null && typeof markets === "object" && !Array.isArray(markets);
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
        pendingBaseline: null, committedOrdinal: 0,
        generation: `${sourceEpoch(envelope)}:ksport-http:${envelope.tabId}:0` },
      wsSequenceHighWatermark: 0,
      authority: "NONE",
      httpAuthorityCutoff: null
    };
    this.#states.set(key, created);
    return created;
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "KSPORT" || envelope.payload.encoding !== "UTF8") return false;
    if (envelope.transport === "HTTP_RESPONSE") {
      return envelope.request.pathnameClass === "/api/v2/getEvent" &&
        httpGeneration(envelope) !== null;
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
    if (envelope.transport === "HTTP_RESPONSE") {
      const requestGeneration = httpGeneration(envelope);
      if (requestGeneration === null) return [];
      if (source.wsSequenceHighWatermark > requestGeneration.requestStartSequence) return [];
      let body: unknown;
      try { body = JSON.parse(envelope.payload.body) as unknown; } catch { return []; }
      if (!isFullPartitionSnapshot(body)) return [];
      const bootstrap = bootstrapRecords(body, requestGeneration.partition === "live");
      const changed = extractSbobetDirectCatalogRecords(body, bootstrap);
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
      for (const record of changed) records.set(record.eventId, { record,
        seenAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
        sequence: envelope.sequence, receiptSequence: envelope.sequence });
      epoch.pendingBaseline.partitions.set(requestGeneration.partition,
        { records, receiptSequence: envelope.sequence });
      if (!epoch.pendingBaseline.partitions.has("live") || !epoch.pendingBaseline.partitions.has("today")) return [];
      if (source.wsSequenceHighWatermark > epoch.pendingBaseline.requestStartSequence) {
        epoch.pendingBaseline = null;
        return [];
      }
      const committedCutoff = epoch.pendingBaseline.requestStartSequence;
      epoch.committedPartitions = epoch.pendingBaseline.partitions;
      epoch.committedOrdinal = epoch.pendingBaseline.ordinal;
      epoch.generation = epoch.pendingBaseline.generation;
      epoch.pendingBaseline = null;
      source.authority = "HTTP";
      source.httpAuthorityCutoff = committedCutoff;
      const catalog = catalogFromPartitions(epoch.committedPartitions, envelope.observedAtMs);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, value: catalog,
        authoritativeBaseline: true, evidenceMode: "BASELINE",
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
        source.socket = socketEpoch(sourceEpoch(envelope), streamId, streamOrdinal,
          current?.receiptHighWatermarks);
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
      epoch = socketEpoch(sourceEpoch(envelope), streamId, streamOrdinal,
        epoch?.receiptHighWatermarks);
      source.socket = epoch;
    }
    if (epoch.activeStreamId !== streamId || epoch.activeStreamOrdinal !== streamOrdinal ||
      epoch.decoder === null) return [];
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
      appliedHttpLaneDelta = applyHttpLaneDelta(source, receipt, partition, envelope) ||
        appliedHttpLaneDelta;
    }
    if (!appliedHttpLaneDelta) return [];
    const catalog = catalogFromPartitions(source.http.committedPartitions, envelope.observedAtMs);
    if (catalog.events.length === 0 || catalog.markets.length === 0 ||
      catalog.quotes.length === 0) return [];
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog, evidenceMode: "DELTA",
      generation: source.http.generation, provenance: "WS" }];
  }
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

function socketEpoch(epoch: string, streamId: string, streamOrdinal: number,
  receiptHighWatermarks: ReadonlyMap<CatalogPartition, number> = new Map()): SocketEpoch {
  return { activeStreamId: streamId, activeStreamOrdinal: streamOrdinal,
    streamHighWatermark: streamOrdinal, decoder: new SbobetStompReceiptDecoder(),
    committedPartitions: new Map<CatalogPartition, PartitionSnapshot>(),
    generation: `${epoch}:ksport-ws:${streamId}:0`, committedGeneration: 0,
    receiptHighWatermarks: new Map(receiptHighWatermarks),
    authorityLost: false };
}

function catalogFromPartitions(partitions: ReadonlyMap<CatalogPartition, PartitionSnapshot>,
  observedAtMs: number): ReturnType<typeof mergeObservedCatalogParts> {
  const retained = new Map<string, RetainedRecord>();
  for (const partition of ["today", "live"] as const) {
    const snapshot = partitions.get(partition);
    if (snapshot === undefined) continue;
    for (const [eventId, entry] of snapshot.records) retainNewest(retained, eventId, entry);
  }
  const parts: NormalizedCatalogPart[] = [];
  for (const entry of retained.values()) {
    parts.push(normalizeSbobetCatalog([entry.record], {
      observedAtMs: entry.seenAtMs, receivedMonotonicMs: entry.receivedMonotonicMs,
      sequence: entry.sequence, provider: "SBOBET",
      settlementProfile: "football-regulation-including-added-time"
    }));
  }
  return mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SBOBET", observedAtMs, parts });
}

/**
 * Folds one non-full WS receipt into the committed HTTP baseline. The record
 * fence is the envelope sequence: it is monotonic per source, and the caller
 * has already required it to be past the baseline's request-start cutoff, so
 * a delta can never drag the catalog behind the baseline it lands on.
 */
function applyHttpLaneDelta(source: SourceEpochState, receipt: SbobetStompProviderReceipt,
  partition: CatalogPartition, envelope: ChromeBridgeEnvelope): boolean {
  const bootstrap = bootstrapRecords(receipt.body, partition === "live");
  const changed = extractSbobetDirectCatalogRecords(receipt.body, bootstrap);
  if (changed.length === 0) return false;
  const committed = source.http.committedPartitions.get(partition);
  if (committed === undefined) return false;
  const records = new Map(committed.records);
  for (const incoming of changed) {
    const existing = records.get(incoming.eventId)?.record;
    records.set(incoming.eventId,
      retainedRecord(mergeDeltaRecord(existing, incoming), envelope, envelope.sequence));
  }
  source.http.committedPartitions.set(partition,
    { records, receiptSequence: Math.max(committed.receiptSequence, envelope.sequence) });
  return true;
}

function retainedRecord(record: SbobetCatalogInputRecord, envelope: ChromeBridgeEnvelope,
  receiptSequence: number): RetainedRecord {
  return { record, seenAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
    sequence: envelope.sequence, receiptSequence };
}

function mergeDeltaRecord(existing: SbobetCatalogInputRecord | undefined,
  incoming: SbobetCatalogInputRecord): SbobetCatalogInputRecord {
  if (existing === undefined) return incoming;
  return { ...existing, ...incoming,
    markets: [...new Map([...existing.markets, ...incoming.markets]
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
