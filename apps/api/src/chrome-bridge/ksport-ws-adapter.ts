import { normalizeSbobetCatalog, type SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { extractSbobetDirectCatalogRecords } from "../providers/sbobet/sbobet-direct-catalog.js";
import { SbobetStompReceiptDecoder,
  type SbobetStompProviderReceipt } from "../providers/sbobet/sbobet-stomp.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";
import { websocketLifecycleState } from "./websocket-lifecycle.js";

const ACCOUNT_ID = "catalog-source:SBOBET:FOOTBALL";
const MAX_PENDING_DELTA_RECORDS = 256;
const MAX_PENDING_DELTA_MARKETS = 2_048;

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

interface PendingBaseline {
  readonly generation: string;
  readonly ordinal: number;
  readonly receiptFloors: ReadonlyMap<CatalogPartition, number>;
  readonly partitions: Map<CatalogPartition, PartitionSnapshot>;
  readonly deltas: Map<CatalogPartition, Map<string, Map<string, RetainedRecord>>>;
  deltaRecordCount: number;
  deltaMarketCount: number;
  fenced: boolean;
}

interface SocketEpoch {
  activeStreamId: string | null;
  activeStreamOrdinal: number | null;
  streamHighWatermark: number;
  decoder: SbobetStompReceiptDecoder | null;
  committedPartitions: Map<CatalogPartition, PartitionSnapshot>;
  pendingBaseline: PendingBaseline | null;
  generation: string;
  committedGeneration: number;
  receiptHighWatermarks: Map<CatalogPartition, number>;
  authorityLost: boolean;
}

interface HttpEpoch {
  committedPartitions: Map<CatalogPartition, PartitionSnapshot>;
  pendingBaseline: PendingBaseline | null;
  committedOrdinal: number;
  generation: string;
}

function sourceEpoch(envelope: ChromeBridgeEnvelope): string {
  return envelope.sourceEpoch ?? "legacy";
}

function sourceEpochKey(envelope: ChromeBridgeEnvelope): string {
  return `${envelope.sourceId}|${sourceEpoch(envelope)}`;
}

function wsRecoveryGeneration(envelope: ChromeBridgeEnvelope): number | null {
  const generation = (envelope.request as ChromeBridgeEnvelope["request"] & {
    readonly recoveryGeneration?: unknown
  }).recoveryGeneration;
  return typeof generation === "number" && Number.isSafeInteger(generation) && generation > 0
    ? generation : null;
}

function receiptPartition(receipt: SbobetStompProviderReceipt): CatalogPartition | null {
  if (receipt.subscription === "subSportBookLive" || /\/1_1\/live\//u.test(receipt.destination)) return "live";
  if (receipt.subscription === "subSportBookToday" || receipt.subscription === "subSportHotMatch" ||
    /\/sports\/1_\d+\/today\//u.test(receipt.destination)) return "today";
  return null;
}

function httpGeneration(envelope: ChromeBridgeEnvelope): {
  readonly generation: string; readonly ordinal: number; readonly partition: CatalogPartition
} | null {
  const streamId = envelope.request.streamId ?? "";
  const match = /^ksport-http:(0|[1-9]\d*):([1-9]\d*):(live|today)$/u.exec(streamId);
  const tabId = match === null ? Number.NaN : Number(match[1]);
  if (match === null || !Number.isSafeInteger(tabId) || tabId !== envelope.tabId ||
    streamId !== `ksport-http:${match[1]}:${match[2]}:${match[3]}`) return null;
  const ordinal = Number(match[2]);
  if (!Number.isSafeInteger(ordinal)) return null;
  return { generation: `${sourceEpoch(envelope)}:ksport-http:${match[1]}:${match[2]}`,
    ordinal, partition: match[3] as CatalogPartition };
}

function isFullPartitionSnapshot(body: unknown): boolean {
  return Array.isArray(body) && body.every((value) => {
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
  readonly #epochs = new Map<string, SocketEpoch>();
  readonly #httpPartitions = new Map<string, HttpEpoch>();

  resetSource(sourceId: string): void {
    for (const key of this.#epochs.keys()) if (key.startsWith(`${sourceId}|`)) this.#epochs.delete(key);
    for (const key of this.#httpPartitions.keys()) if (key.startsWith(`${sourceId}|`)) this.#httpPartitions.delete(key);
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "KSPORT" || envelope.payload.encoding !== "UTF8") return false;
    if (envelope.transport === "HTTP_RESPONSE") {
      return envelope.request.pathnameClass === "/api/v2/getEvent" &&
        httpGeneration(envelope) !== null;
    }
    const providerSocket = envelope.request.pathnameClass.startsWith("/sport/");
    if (!providerSocket || envelope.request.streamId === undefined ||
      wsStreamOrdinal(envelope.request.streamId) === null) return false;
    if (envelope.transport === "WS_STATE") return websocketLifecycleState(envelope) !== null;
    if (envelope.transport !== "WS_FRAME" || envelope.payload.body.includes("destination:/topic/jackpot/")) return false;
    return envelope.payload.body.includes("destination:/topic/sports/") || !envelope.payload.body.includes("destination:");
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    // Retained extension snapshots are recovery hints, not provider-current
    // evidence. In particular, do not advance the stream fence or baseline
    // cursor: a fresh copy of the same provider generation must still be able
    // to establish authority after an API/bridge reconnect.
    if (envelope.request.replayed === true) return [];
    const epochKey = sourceEpochKey(envelope);
    if (envelope.transport === "HTTP_RESPONSE") {
      const requestGeneration = httpGeneration(envelope);
      if (requestGeneration === null) return [];
      let body: unknown;
      try { body = JSON.parse(envelope.payload.body) as unknown; } catch { return []; }
      if (!isFullPartitionSnapshot(body)) return [];
      const bootstrap = bootstrapRecords(body, requestGeneration.partition === "live");
      const changed = extractSbobetDirectCatalogRecords(body, bootstrap);
      if (bootstrap.length > 0 && changed.length === 0) return [];
      const epoch = this.#httpPartitions.get(epochKey) ?? {
        committedPartitions: new Map<CatalogPartition, PartitionSnapshot>(), pendingBaseline: null,
        committedOrdinal: 0, generation: `${sourceEpoch(envelope)}:ksport-http:${envelope.tabId}:0`
      };
      if (requestGeneration.ordinal <= epoch.committedOrdinal ||
        (epoch.pendingBaseline !== null && requestGeneration.ordinal < epoch.pendingBaseline.ordinal)) return [];
      if (epoch.pendingBaseline === null || requestGeneration.ordinal > epoch.pendingBaseline.ordinal) {
        epoch.pendingBaseline = pendingBaseline(requestGeneration.generation, requestGeneration.ordinal);
      }
      if (epoch.pendingBaseline.generation !== requestGeneration.generation) return [];
      const prior = epoch.pendingBaseline.partitions.get(requestGeneration.partition);
      if (prior !== undefined && envelope.sequence <= prior.receiptSequence) return [];
      const records = new Map<string, RetainedRecord>();
      for (const record of changed) records.set(record.eventId, { record,
        seenAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
        sequence: envelope.sequence, receiptSequence: envelope.sequence });
      epoch.pendingBaseline.partitions.set(requestGeneration.partition,
        { records, receiptSequence: envelope.sequence });
      this.#httpPartitions.set(epochKey, epoch);
      if (!epoch.pendingBaseline.partitions.has("live") || !epoch.pendingBaseline.partitions.has("today")) return [];
      epoch.committedPartitions = epoch.pendingBaseline.partitions;
      epoch.committedOrdinal = epoch.pendingBaseline.ordinal;
      epoch.generation = epoch.pendingBaseline.generation;
      epoch.pendingBaseline = null;
      const retained = new Map<string, RetainedRecord>();
      for (const partition of ["today", "live"] as const) {
        for (const [eventId, entry] of epoch.committedPartitions.get(partition)!.records) {
          retainNewest(retained, eventId, entry);
        }
      }
      const parts: NormalizedCatalogPart[] = [];
      for (const entry of retained.values()) parts.push(normalizeSbobetCatalog([entry.record], {
        observedAtMs: entry.seenAtMs, receivedMonotonicMs: entry.receivedMonotonicMs,
        sequence: entry.sequence, provider: "SBOBET",
        settlementProfile: "football-regulation-including-added-time"
      }));
      const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SBOBET",
        observedAtMs: envelope.observedAtMs, parts });
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, value: catalog,
        authoritativeBaseline: true, evidenceMode: "BASELINE",
        generation: epoch.generation, provenance: "AUTHENTICATED_HTTP" }];
    }
    const streamId = envelope.request.streamId!;
    const streamOrdinal = wsStreamOrdinal(streamId)!;
    if (envelope.transport === "WS_STATE") {
      const state = websocketLifecycleState(envelope);
      if (state === null) return [];
      if (state === "OPEN") {
        const current = this.#epochs.get(epochKey);
        if (current?.activeStreamId === streamId) return [];
        if (current !== undefined && streamOrdinal <= current.streamHighWatermark) return [];
        const retiresAuthority = current !== undefined && hasCommittedSocketAuthority(current);
        this.#epochs.set(epochKey, socketEpoch(sourceEpoch(envelope), streamId, streamOrdinal,
          current?.receiptHighWatermarks));
        return retiresAuthority ? [streamGap(envelope)] : [];
      }
      const current = this.#epochs.get(epochKey);
      if (current?.activeStreamId !== streamId || current.activeStreamOrdinal !== streamOrdinal) return [];
      current.activeStreamId = null;
      current.activeStreamOrdinal = null;
      current.decoder = null;
      current.committedPartitions = new Map();
      current.pendingBaseline = null;
      current.generation = `${sourceEpoch(envelope)}:ksport-ws:${streamId}:closed`;
      current.committedGeneration = 0;
      current.authorityLost = true;
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_CLOSED" }];
    }
    let epoch = this.#epochs.get(epochKey);
    let retiresAuthority = false;
    if (epoch === undefined || streamOrdinal > epoch.streamHighWatermark) {
      retiresAuthority = epoch !== undefined && hasCommittedSocketAuthority(epoch);
      epoch = socketEpoch(sourceEpoch(envelope), streamId, streamOrdinal,
        epoch?.receiptHighWatermarks);
      this.#epochs.set(epochKey, epoch);
    }
    if (epoch.activeStreamId !== streamId || epoch.activeStreamOrdinal !== streamOrdinal ||
      epoch.decoder === null) return [];
    const recoveryGeneration = wsRecoveryGeneration(envelope);
    if (recoveryGeneration === null) return retiresAuthority ? [streamGap(envelope)] : [];
    if (isSportsbookHeartbeat(envelope.payload.body)) {
      if (epoch.authorityLost || epoch.pendingBaseline !== null ||
        recoveryGeneration !== epoch.committedGeneration ||
        !epoch.committedPartitions.has("live") || !epoch.committedPartitions.has("today")) {
        return retiresAuthority ? [streamGap(envelope)] : [];
      }
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, transportAlive: true }];
    }
    const receipts = epoch.decoder.push(envelope.payload.body);
    if (receipts.length === 0) return retiresAuthority ? [streamGap(envelope)] : [];
    let acceptedDelta = false;
    let completedBaseline = false;
    let invalidated = false;
    for (const receipt of receipts) {
      const partition = receiptPartition(receipt);
      if (partition === null) continue;
      const fullSnapshot = isFullPartitionSnapshot(receipt.body);
      const order = receipt.receiptSequence;
      if (order === null || !Number.isSafeInteger(order) || order <= 0) continue;
      const bootstrap = bootstrapRecords(receipt.body, partition === "live");
      const changed = extractSbobetDirectCatalogRecords(receipt.body, bootstrap);
      if (fullSnapshot && bootstrap.length > 0 && changed.length === 0) continue;
      if (!fullSnapshot && changed.length === 0) continue;
      if (fullSnapshot) {
        if (recoveryGeneration <= epoch.committedGeneration) continue;
        if (epoch.pendingBaseline === null || recoveryGeneration > epoch.pendingBaseline.ordinal) {
          // A full replacement part must be newer than valid evidence for
          // that partition, including applied deltas retained across a socket
          // handoff. The other partition has its own independent order.
          if (order <= (epoch.receiptHighWatermarks.get(partition) ?? 0)) continue;
          epoch.pendingBaseline = pendingBaseline(
            `${sourceEpoch(envelope)}:ksport-ws:${streamId}:${recoveryGeneration}`, recoveryGeneration,
            epoch.receiptHighWatermarks);
        }
        if (recoveryGeneration !== epoch.pendingBaseline.ordinal) continue;
        if (epoch.pendingBaseline.fenced) continue;
        const prior = epoch.pendingBaseline.partitions.get(partition);
        if (order <= (epoch.pendingBaseline.receiptFloors.get(partition) ?? 0) ||
          (prior !== undefined && order <= prior.receiptSequence)) continue;
        const records = new Map<string, RetainedRecord>();
        for (const incoming of changed) records.set(incoming.eventId, retainedRecord(incoming, envelope, order));
        epoch.pendingBaseline.partitions.set(partition, { records, receiptSequence: order });
        epoch.receiptHighWatermarks.set(partition,
          Math.max(epoch.receiptHighWatermarks.get(partition) ?? 0, order));
        if (epoch.pendingBaseline.partitions.has("live") && epoch.pendingBaseline.partitions.has("today") &&
          !epoch.pendingBaseline.fenced) {
          applyPendingDeltas(epoch.pendingBaseline);
          epoch.committedPartitions = epoch.pendingBaseline.partitions;
          epoch.generation = epoch.pendingBaseline.generation;
          epoch.committedGeneration = epoch.pendingBaseline.ordinal;
          epoch.pendingBaseline = null;
          epoch.authorityLost = false;
          completedBaseline = true;
        }
        continue;
      }
      if (recoveryGeneration > epoch.committedGeneration &&
        (epoch.pendingBaseline === null || recoveryGeneration > epoch.pendingBaseline.ordinal)) {
        if (order <= (epoch.receiptHighWatermarks.get(partition) ?? 0)) continue;
        epoch.pendingBaseline = pendingBaseline(
          `${sourceEpoch(envelope)}:ksport-ws:${streamId}:${recoveryGeneration}`, recoveryGeneration,
          epoch.receiptHighWatermarks);
      }
      if (epoch.pendingBaseline !== null) {
        const pendingPartition = epoch.pendingBaseline.partitions.get(partition);
        const partitionEvidence = pendingPartition?.receiptSequence ??
          epoch.pendingBaseline.receiptFloors.get(partition) ?? 0;
        if (recoveryGeneration !== epoch.pendingBaseline.ordinal || order <= partitionEvidence) continue;
        if (epoch.pendingBaseline.fenced) continue;
        epoch.receiptHighWatermarks.set(partition,
          Math.max(epoch.receiptHighWatermarks.get(partition) ?? 0, order));
        if (bufferPendingDeltas(epoch.pendingBaseline, partition, changed, envelope, order) === "OVERFLOW") {
          if (!epoch.authorityLost) invalidated = true;
          epoch.authorityLost = true;
          // Loss dominates every later receipt coalesced into this transport
          // frame. Do not let a same-frame baseline hide the mandatory gap;
          // recovery starts with a subsequent strictly newer complete pair.
          break;
        }
        continue;
      }
      if (recoveryGeneration !== epoch.committedGeneration) continue;
      const committed = epoch.committedPartitions.get(partition);
      if (committed === undefined || order <= committed.receiptSequence) continue;
      epoch.receiptHighWatermarks.set(partition,
        Math.max(epoch.receiptHighWatermarks.get(partition) ?? 0, order));
      const records = new Map(committed.records);
      for (const incoming of changed) {
        const existing = records.get(incoming.eventId)?.record;
        records.set(incoming.eventId, retainedRecord(mergeDeltaRecord(existing, incoming), envelope, order));
      }
      epoch.committedPartitions.set(partition, { records, receiptSequence: order });
      acceptedDelta = changed.length > 0 || acceptedDelta;
    }
    if (invalidated) return [streamGap(envelope)];
    if ((!acceptedDelta && !completedBaseline) || !epoch.committedPartitions.has("live") ||
      !epoch.committedPartitions.has("today")) return retiresAuthority ? [streamGap(envelope)] : [];
    const retained = new Map<string, RetainedRecord>();
    for (const partition of ["today", "live"] as const) {
      for (const [eventId, entry] of epoch.committedPartitions.get(partition)!.records) {
        retainNewest(retained, eventId, entry);
      }
    }
    const parts: NormalizedCatalogPart[] = [];
    for (const entry of retained.values()) {
      parts.push(normalizeSbobetCatalog([entry.record], {
        observedAtMs: entry.seenAtMs, receivedMonotonicMs: entry.receivedMonotonicMs,
        sequence: entry.sequence, provider: "SBOBET",
        settlementProfile: "football-regulation-including-added-time"
      }));
    }
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SBOBET",
      observedAtMs: envelope.observedAtMs, parts });
    if (!completedBaseline && (catalog.events.length === 0 || catalog.markets.length === 0 ||
      catalog.quotes.length === 0)) return [];
    const update: DecodedCatalogUpdate = { sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog,
      ...(completedBaseline ? { authoritativeBaseline: true as const, evidenceMode: "BASELINE" as const }
        : { evidenceMode: "DELTA" as const }),
      generation: epoch.generation, provenance: "WS" };
    return [update];
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
    committedPartitions: new Map<CatalogPartition, PartitionSnapshot>(), pendingBaseline: null,
    generation: `${epoch}:ksport-ws:${streamId}:0`, committedGeneration: 0,
    receiptHighWatermarks: new Map(receiptHighWatermarks),
    authorityLost: false };
}

function pendingBaseline(generation: string, ordinal: number,
  receiptFloors: ReadonlyMap<CatalogPartition, number> = new Map()): PendingBaseline {
  return { generation, ordinal, receiptFloors: new Map(receiptFloors),
    partitions: new Map<CatalogPartition, PartitionSnapshot>(),
    deltas: new Map<CatalogPartition, Map<string, Map<string, RetainedRecord>>>(),
    deltaRecordCount: 0, deltaMarketCount: 0, fenced: false };
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

function bufferPendingDeltas(pending: PendingBaseline, partition: CatalogPartition,
  changed: readonly SbobetCatalogInputRecord[], envelope: ChromeBridgeEnvelope,
  order: number): "BUFFERED" | "OVERFLOW" {
  const records = pending.deltas.get(partition) ?? new Map<string, Map<string, RetainedRecord>>();
  pending.deltas.set(partition, records);
  for (const incoming of changed) {
    const previous = records.get(incoming.eventId);
    const acceptedMarkets = incoming.markets.filter((market) => {
      const prior = previous?.get(market.marketId);
      return prior === undefined || order > prior.receiptSequence;
    });
    if (acceptedMarkets.length === 0) continue;
    const nextRecordCount = pending.deltaRecordCount + (previous === undefined ? 1 : 0);
    const nextMarketCount = pending.deltaMarketCount +
      acceptedMarkets.filter((market) => !previous?.has(market.marketId)).length;
    if (nextRecordCount > MAX_PENDING_DELTA_RECORDS || nextMarketCount > MAX_PENDING_DELTA_MARKETS) {
      pending.deltas.clear();
      pending.deltaRecordCount = 0;
      pending.deltaMarketCount = 0;
      pending.fenced = true;
      return "OVERFLOW";
    }
    const markets = previous ?? new Map<string, RetainedRecord>();
    for (const market of acceptedMarkets) {
      markets.set(market.marketId, retainedRecord({ ...incoming, markets: [market] }, envelope, order));
    }
    records.set(incoming.eventId, markets);
    pending.deltaRecordCount = nextRecordCount;
    pending.deltaMarketCount = nextMarketCount;
  }
  return "BUFFERED";
}

function applyPendingDeltas(pending: PendingBaseline): void {
  for (const [partition, deltas] of pending.deltas) {
    const baseline = pending.partitions.get(partition);
    if (baseline === undefined) continue;
    const records = new Map(baseline.records);
    let receiptSequence = baseline.receiptSequence;
    for (const [eventId, markets] of deltas) {
      const accepted = [...markets.values()]
        .filter((delta) => delta.receiptSequence > baseline.receiptSequence)
        .sort((left, right) => left.receiptSequence - right.receiptSequence || left.sequence - right.sequence);
      if (accepted.length === 0) continue;
      let record = records.get(eventId)?.record;
      for (const delta of accepted) record = mergeDeltaRecord(record, delta.record);
      const latest = accepted.at(-1)!;
      records.set(eventId, { ...latest, record: record! });
      receiptSequence = Math.max(receiptSequence, latest.receiptSequence);
    }
    pending.partitions.set(partition, { records, receiptSequence });
  }
}

function retainNewest(retained: Map<string, RetainedRecord>, eventId: string, incoming: RetainedRecord): void {
  const current = retained.get(eventId);
  // Iteration is today then live, so an exact receipt tie remains
  // deterministically live-preferring while any newer evidence wins.
  if (current === undefined || incoming.receiptSequence >= current.receiptSequence) {
    retained.set(eventId, incoming);
  }
}
