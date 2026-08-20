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
}

function receiptPartition(receipt: SbobetStompProviderReceipt): CatalogPartition | null {
  if (receipt.subscription === "subSportBookLive" || /\/1_1\/live\//u.test(receipt.destination)) return "live";
  if (receipt.subscription === "subSportBookToday" || /\/1_1\/today\//u.test(receipt.destination)) return "today";
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
  readonly #retiredStreams = new Map<string, Set<string>>();

  resetSource(sourceId: string): void {
    this.#epochs.delete(sourceId);
    this.#retiredStreams.delete(sourceId);
    for (const key of this.#decoders.keys()) if (key.startsWith(`${sourceId}|`)) this.#decoders.delete(key);
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "KSPORT" || envelope.payload.encoding !== "UTF8") return false;
    if (!envelope.request.pathnameClass.startsWith("/sport/") || envelope.request.streamId === undefined) return false;
    if (envelope.transport === "WS_STATE") return websocketLifecycleState(envelope) !== null;
    if (envelope.transport !== "WS_FRAME" || envelope.payload.body.includes("destination:/topic/jackpot/")) return false;
    return envelope.payload.body.includes("destination:/topic/sports/") || !envelope.payload.body.includes("destination:");
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const streamKey = `${envelope.sourceId}|${envelope.request.streamId ?? "legacy"}`;
    if (envelope.transport === "WS_STATE") {
      const state = websocketLifecycleState(envelope);
      if (state === null) return [];
      if (state === "OPEN") {
        const streamId = envelope.request.streamId ?? "legacy";
        const current = this.#epochs.get(envelope.sourceId);
        if (current !== undefined && current.streamId !== streamId) {
          const retired = this.#retiredStreams.get(envelope.sourceId) ?? new Set<string>();
          retired.add(current.streamId);
          this.#retiredStreams.set(envelope.sourceId, retired);
        }
        this.#epochs.set(envelope.sourceId, { streamId, partitions: new Map() });
        this.#decoders.set(streamKey, new SbobetStompReceiptDecoder());
        return [];
      }
      this.#decoders.delete(streamKey);
      if (this.#epochs.get(envelope.sourceId)?.streamId !== envelope.request.streamId) return [];
      const retired = this.#retiredStreams.get(envelope.sourceId) ?? new Set<string>();
      retired.add(envelope.request.streamId ?? "legacy");
      this.#retiredStreams.set(envelope.sourceId, retired);
      this.#epochs.delete(envelope.sourceId);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_CLOSED" }];
    }
    const decoder = this.#decoders.get(streamKey) ?? new SbobetStompReceiptDecoder();
    this.#decoders.set(streamKey, decoder);
    const receipts = decoder.push(envelope.payload.body);
    if (receipts.length === 0) return [];
    let epoch = this.#epochs.get(envelope.sourceId);
    const streamId = envelope.request.streamId ?? "legacy";
    if (this.#retiredStreams.get(envelope.sourceId)?.has(streamId) === true) return [];
    if (epoch === undefined) {
      epoch = { streamId: envelope.request.streamId ?? "legacy", partitions: new Map() };
      this.#epochs.set(envelope.sourceId, epoch);
    }
    if (epoch.streamId !== streamId) return [];
    let accepted = false;
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
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog, authoritativeBaseline: true }];
  }
}
