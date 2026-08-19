import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { extractImFootballCatalog, mergeImFootballDelta } from
  "../providers/im/im-football-catalog-source.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";

const ACCOUNT_ID = "catalog-source:IM:FOOTBALL";
const HOST = "imsports.directsb.net";
const SNAPSHOT_PATH = "/api/EventV6/GetSE";
const DELTA_PATH = "/api/EventV6/GetSEDelta";
const PREMATCH_HORIZON_MS = 48 * 60 * 60 * 1_000;
type ImPartition = "IM_MARKET_1" | "IM_MARKET_2";
type ImRecord = ReturnType<typeof extractImFootballCatalog>[number];

interface RetainedRecord {
  readonly record: ImRecord;
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}

type PartitionRecords = Map<string, RetainedRecord>;

export class ImHttpCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "im-http-catalog-v1";
  readonly lobby = "IM" as const;
  readonly providerFamily = "IM";
  readonly #records = new Map<string, Map<ImPartition, PartitionRecords>>();
  readonly #parsedBodies = new WeakMap<ChromeBridgeEnvelope, Record<string, unknown> | null>();

  resetSource(sourceId: string): void {
    this.#records.delete(sourceId);
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "IM" || envelope.transport !== "HTTP_RESPONSE" ||
      envelope.request.hostname !== HOST || envelope.payload.encoding !== "UTF8" ||
      (envelope.request.pathnameClass !== SNAPSHOT_PATH && envelope.request.pathnameClass !== DELTA_PATH)) return false;
    if (envelope.request.pathnameClass === SNAPSHOT_PATH && envelope.request.providerPartition === undefined) return false;
    const root = parseRecord(envelope.payload.body);
    this.#parsedBodies.set(envelope, root);
    return root?.StatusCode === 100 && (envelope.request.pathnameClass === SNAPSHOT_PATH
      ? Array.isArray(root.sel) : Array.isArray(root.dc));
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const root = this.#parsedBodies.get(envelope) ?? parseRecord(envelope.payload.body);
    if (root === null) return [];
    const sourcePartitions = this.#records.get(envelope.sourceId) ?? new Map<ImPartition, PartitionRecords>();
    if (envelope.request.pathnameClass === SNAPSHOT_PATH) {
      const partition = envelope.request.providerPartition;
      if (partition === undefined) return [];
      const records = new Map<string, RetainedRecord>();
      for (const record of extractImFootballCatalog(root, {
        nowMs: envelope.observedAtMs,
        prematchHorizonMs: PREMATCH_HORIZON_MS
      })) {
        records.set(record.eventId, { record, observedAtMs: envelope.observedAtMs,
          receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence });
      }
      sourcePartitions.set(partition, records);
    } else {
      const target = envelope.request.providerPartition;
      const partitions = target === undefined
        ? sourcePartitions.size === 2 ? [...sourcePartitions.entries()] : []
        : sourcePartitions.has(target) ? [[target, sourcePartitions.get(target)!] as const] : [];
      if (partitions.length === 0) return [];
      let changed = false;
      for (const [, records] of partitions) {
        for (const [eventId, entry] of [...records]) {
          const updated = mergeImFootballDelta([entry.record], root);
          if (updated.length === 0) {
            records.delete(eventId);
            changed = true;
          } else if (updated[0] !== entry.record) {
            records.set(eventId, { record: updated[0]!, observedAtMs: envelope.observedAtMs,
              receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence });
            changed = true;
          }
        }
      }
      if (!changed) return [];
    }
    this.#records.set(envelope.sourceId, sourcePartitions);
    if (!sourcePartitions.has("IM_MARKET_1") || !sourcePartitions.has("IM_MARKET_2")) return [];
    const parts: NormalizedCatalogPart[] = [];
    for (const partition of ["IM_MARKET_1", "IM_MARKET_2"] as const) {
      for (const entry of sourcePartitions.get(partition)!.values()) {
        parts.push(normalizeSbobetCatalog([entry.record], {
          observedAtMs: entry.observedAtMs,
          receivedMonotonicMs: entry.receivedMonotonicMs,
          sequence: entry.sequence,
          provider: "IM",
          settlementProfile: "football-regulation-including-added-time"
        }));
      }
    }
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "IM",
      observedAtMs: envelope.observedAtMs, parts });
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog }];
  }
}

function parseRecord(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
