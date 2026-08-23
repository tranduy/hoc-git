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
}

type CatalogPartition = "live" | "today";

interface PartitionSnapshot {
  readonly records: ReadonlyMap<string, RetainedRecord>;
  readonly receiptSequence: number;
}

interface SocketEpoch {
  readonly streamId: string;
  readonly partitions: Map<CatalogPartition, PartitionSnapshot>;
  generation: string;
  generationOrdinal: number;
  complete: boolean;
}

interface HttpEpoch {
  readonly partitions: Map<CatalogPartition, PartitionSnapshot>;
  generation: string;
  generationOrdinal: number;
}

function sourceEpoch(envelope: ChromeBridgeEnvelope): string {
  return envelope.sourceEpoch ?? "legacy";
}

function sourceEpochKey(envelope: ChromeBridgeEnvelope): string {
  return `${envelope.sourceId}|${sourceEpoch(envelope)}`;
}

function receiptPartition(receipt: SbobetStompProviderReceipt): CatalogPartition | null {
  if (receipt.subscription === "subSportBookLive" || /\/1_1\/live\//u.test(receipt.destination)) return "live";
  if (receipt.subscription === "subSportBookToday" || receipt.subscription === "subSportHotMatch" ||
    /\/sports\/1_\d+\/today\//u.test(receipt.destination)) return "today";
  return null;
}

function httpPartition(streamId: string | undefined): CatalogPartition | null {
  if (streamId === "ksport-http:live") return "live";
  if (streamId === "ksport-http:today") return "today";
  return null;
}

function isFullPartitionSnapshot(body: unknown): boolean {
  return Array.isArray(body) && body.every((value) => {
    const league = record(value);
    return league !== null && typeof league["1"] === "string" && Array.isArray(league["2"]);
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
  readonly #decoders = new Map<string, SbobetStompReceiptDecoder>();
  readonly #epochs = new Map<string, SocketEpoch>();
  readonly #httpPartitions = new Map<string, HttpEpoch>();
  readonly #retiredStreams = new Map<string, Set<string>>();

  resetSource(sourceId: string): void {
    for (const key of this.#epochs.keys()) if (key.startsWith(`${sourceId}|`)) this.#epochs.delete(key);
    for (const key of this.#httpPartitions.keys()) if (key.startsWith(`${sourceId}|`)) this.#httpPartitions.delete(key);
    for (const key of this.#retiredStreams.keys()) if (key.startsWith(`${sourceId}|`)) this.#retiredStreams.delete(key);
    for (const key of this.#decoders.keys()) if (key.startsWith(`${sourceId}|`)) this.#decoders.delete(key);
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "KSPORT" || envelope.payload.encoding !== "UTF8") return false;
    if (envelope.transport === "HTTP_RESPONSE") {
      return envelope.request.pathnameClass === "/api/v2/getEvent" &&
        httpPartition(envelope.request.streamId) !== null;
    }
    const providerSocket = envelope.request.pathnameClass.startsWith("/sport/");
    if (!providerSocket || envelope.request.streamId === undefined) return false;
    if (envelope.transport === "WS_STATE") return websocketLifecycleState(envelope) !== null;
    if (envelope.transport !== "WS_FRAME" || envelope.payload.body.includes("destination:/topic/jackpot/")) return false;
    return envelope.payload.body.includes("destination:/topic/sports/") || !envelope.payload.body.includes("destination:");
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const epochKey = sourceEpochKey(envelope);
    if (envelope.transport === "HTTP_RESPONSE") {
      const partition = httpPartition(envelope.request.streamId);
      if (partition === null) return [];
      let body: unknown;
      try { body = JSON.parse(envelope.payload.body) as unknown; } catch { return []; }
      if (!isFullPartitionSnapshot(body)) return [];
      const bootstrap = bootstrapRecords(body, partition === "live");
      const changed = extractSbobetDirectCatalogRecords(body, bootstrap);
      const epoch = this.#httpPartitions.get(epochKey) ?? {
        partitions: new Map<CatalogPartition, PartitionSnapshot>(),
        generation: `${sourceEpoch(envelope)}:ksport-http:0`, generationOrdinal: 0
      };
      const prior = epoch.partitions.get(partition);
      if (prior !== undefined && envelope.sequence <= prior.receiptSequence) return [];
      const records = new Map<string, RetainedRecord>();
      for (const record of changed) records.set(record.eventId, { record,
        seenAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
        sequence: envelope.sequence });
      epoch.partitions.set(partition, { records, receiptSequence: envelope.sequence });
      this.#httpPartitions.set(epochKey, epoch);
      if (!epoch.partitions.has("live") || !epoch.partitions.has("today")) return [];
      const retained = new Map<string, RetainedRecord>();
      for (const current of epoch.partitions.values()) {
        for (const [eventId, entry] of current.records) retained.set(eventId, entry);
      }
      const parts: NormalizedCatalogPart[] = [];
      for (const entry of retained.values()) parts.push(normalizeSbobetCatalog([entry.record], {
        observedAtMs: entry.seenAtMs, receivedMonotonicMs: entry.receivedMonotonicMs,
        sequence: entry.sequence, provider: "SBOBET",
        settlementProfile: "football-regulation-including-added-time"
      }));
      const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SBOBET",
        observedAtMs: envelope.observedAtMs, parts });
      if (catalog.events.length === 0 || catalog.markets.length === 0 || catalog.quotes.length === 0) return [];
      epoch.generationOrdinal += 1;
      epoch.generation = `${sourceEpoch(envelope)}:ksport-http:${epoch.generationOrdinal}`;
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, value: catalog,
        authoritativeBaseline: true, evidenceMode: "BASELINE",
        generation: epoch.generation, provenance: "AUTHENTICATED_HTTP" }];
    }
    const streamKey = `${epochKey}|${envelope.request.streamId ?? "legacy"}`;
    if (envelope.transport === "WS_STATE") {
      const state = websocketLifecycleState(envelope);
      if (state === null) return [];
      if (state === "OPEN") {
        const streamId = envelope.request.streamId ?? "legacy";
        const current = this.#epochs.get(epochKey);
        if (current !== undefined && current.streamId !== streamId) {
          const retired = this.#retiredStreams.get(epochKey) ?? new Set<string>();
          retired.add(current.streamId);
          this.#retiredStreams.set(epochKey, retired);
        }
        this.#epochs.set(epochKey, { streamId, partitions: new Map(),
          generation: `${sourceEpoch(envelope)}:ksport-ws:${streamId}:0`,
          generationOrdinal: 0, complete: false });
        this.#decoders.set(streamKey, new SbobetStompReceiptDecoder());
        return [];
      }
      this.#decoders.delete(streamKey);
      if (this.#epochs.get(epochKey)?.streamId !== envelope.request.streamId) return [];
      const retired = this.#retiredStreams.get(epochKey) ?? new Set<string>();
      retired.add(envelope.request.streamId ?? "legacy");
      this.#retiredStreams.set(epochKey, retired);
      this.#epochs.delete(epochKey);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_CLOSED" }];
    }
    const decoder = this.#decoders.get(streamKey) ?? new SbobetStompReceiptDecoder();
    this.#decoders.set(streamKey, decoder);
    const streamId = envelope.request.streamId ?? "legacy";
    const epochBeforeDecode = this.#epochs.get(epochKey);
    if (isSportsbookHeartbeat(envelope.payload.body)) {
      if (this.#retiredStreams.get(epochKey)?.has(streamId) === true ||
        epochBeforeDecode?.streamId !== streamId || !epochBeforeDecode.partitions.has("live") ||
        !epochBeforeDecode.partitions.has("today")) return [];
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, transportAlive: true }];
    }
    const receipts = decoder.push(envelope.payload.body);
    if (receipts.length === 0) return [];
    let epoch = this.#epochs.get(epochKey);
    if (this.#retiredStreams.get(epochKey)?.has(streamId) === true) return [];
    if (epoch === undefined) {
      epoch = { streamId: envelope.request.streamId ?? "legacy", partitions: new Map(),
        generation: `${sourceEpoch(envelope)}:ksport-ws:${streamId}:0`,
        generationOrdinal: 0, complete: false };
      this.#epochs.set(epochKey, epoch);
    }
    if (epoch.streamId !== streamId) return [];
    let accepted = false;
    let acceptedFullSnapshot = false;
    for (const receipt of receipts) {
      const partition = receiptPartition(receipt);
      if (partition === null) continue;
      const order = receipt.receiptSequence ?? envelope.sequence;
      const prior = epoch.partitions.get(partition);
      if (prior !== undefined && order <= prior.receiptSequence) continue;
      const fullSnapshot = isFullPartitionSnapshot(receipt.body);
      if (!fullSnapshot && prior === undefined) continue;
      const bootstrap = bootstrapRecords(receipt.body, partition === "live");
      const changed = extractSbobetDirectCatalogRecords(receipt.body, bootstrap);
      const records = fullSnapshot ? new Map<string, RetainedRecord>()
        : new Map(prior?.records ?? []);
      for (const incoming of changed) {
        const existing = records.get(incoming.eventId)?.record;
        const mergedRecord = fullSnapshot || existing === undefined ? incoming : {
          ...existing, ...incoming,
          markets: [...new Map([...existing.markets, ...incoming.markets]
            .map((market) => [market.marketId, market])).values()]
        };
        records.set(incoming.eventId, { record: mergedRecord,
          seenAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
          sequence: envelope.sequence });
      }
      epoch.partitions.set(partition, { records, receiptSequence: order });
      accepted = true;
      acceptedFullSnapshot = acceptedFullSnapshot || fullSnapshot;
    }
    if (!accepted || !epoch.partitions.has("live") || !epoch.partitions.has("today")) return [];
    const retained = new Map<string, RetainedRecord>();
    for (const partition of ["today", "live"] as const) {
      for (const [eventId, entry] of epoch.partitions.get(partition)!.records) retained.set(eventId, entry);
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
    if (catalog.events.length === 0 || catalog.markets.length === 0 || catalog.quotes.length === 0) return [];
    const baseline = !epoch.complete || acceptedFullSnapshot;
    if (baseline) {
      epoch.generationOrdinal += 1;
      epoch.generation = `${sourceEpoch(envelope)}:ksport-ws:${streamId}:${epoch.generationOrdinal}`;
    }
    epoch.complete = true;
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog,
      ...(baseline ? { authoritativeBaseline: true as const, evidenceMode: "BASELINE" as const }
        : { evidenceMode: "DELTA" as const }),
      generation: epoch.generation, provenance: "WS" }];
  }
}
