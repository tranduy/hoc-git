import { normalizeObservedFootballCatalog, normalizeSabaFootballRecords } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { markSabaLiveContextRecords } from "../providers/saba/saba-football-push-browser-manager.js";
import { SabaPushDecoder } from "../providers/saba/saba-push-decoder.js";
import { parseSabaSocketFrame } from "../providers/saba/saba-socket-frame.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";
import { CmdSnapshotAssembler } from "./cmd-snapshot-assembler.js";
import { decodePublicDomRecords } from "./cmd-dom-adapter.js";

const ACCOUNT_ID = "catalog-source:SABA:FOOTBALL";

export class SabaWsCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "saba-ws-catalog-v1";
  readonly lobby = "SABA" as const;
  readonly providerFamily = "SABA";
  readonly #decoders = new Map<string, SabaPushDecoder>();
  readonly #assembler = new CmdSnapshotAssembler();
  readonly #parts = new Map<string, NormalizedCatalogPart>();
  readonly #readyPartitions = new Set<string>();

  resetSource(sourceId: string): void {
    for (const key of this.#decoders.keys()) if (key.startsWith(`${sourceId}|`)) this.#decoders.delete(key);
    this.#assembler.resetSource(sourceId);
    for (const key of this.#parts.keys()) if (key.startsWith(`${sourceId}|`)) this.#parts.delete(key);
    for (const key of this.#readyPartitions) if (key.startsWith(`${sourceId}|`)) this.#readyPartitions.delete(key);
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "SABA" || envelope.payload.encoding !== "UTF8") return false;
    if (envelope.transport === "DOM_SNAPSHOT" && envelope.request.resourceType === "DOM" &&
      envelope.request.pathnameClass === "/__fieldline_dom_snapshot__") return true;
    if ((envelope.transport !== "WS_FRAME" && envelope.transport !== "WS_STATE") ||
      envelope.request.pathnameClass !== "/socket.io/") return false;
    if (envelope.transport === "WS_STATE") return envelope.request.streamId !== undefined &&
      (envelope.payload.body === "OPEN" || envelope.payload.body === "CLOSED");
    try { return parseSabaSocketFrame(envelope.payload.body) !== null; } catch { return false; }
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    if (envelope.transport === "DOM_SNAPSHOT") {
      // Keep accepting the current visible DOM after the socket bootstrap. A
      // quiet SABA socket may not publish another catalog frame for minutes;
      // dropping these snapshots made an otherwise healthy catalog expire.
      // The DOM remains a separate partition, so hidden socket-only markets
      // stay in the union while overlapping visible prices are refreshed.
      const records = decodePublicDomRecords(this.#assembler, envelope);
      if (records === null) return [];
      const normalized = normalizeObservedFootballCatalog("SABA", records, {
        observedAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
        timezoneOffsetMinutes: 480, sequence: envelope.sequence
      });
      return this.#update(envelope, "DOM", normalized);
    }
    const streamId = envelope.request.streamId ?? "legacy";
    const decoderKey = `${envelope.sourceId}|${streamId}`;
    if (envelope.transport === "WS_STATE") {
      this.#dropStream(envelope.sourceId, streamId);
      if (envelope.payload.body === "OPEN") return [];
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_CLOSED" }];
    }
    try {
      const frame = parseSabaSocketFrame(envelope.payload.body);
      if (frame === null) return [];
      let decoder = this.#decoders.get(decoderKey);
      if (decoder === undefined) {
        decoder = new SabaPushDecoder();
        this.#decoders.set(decoderKey, decoder);
      }
      const applied = decoder.apply(frame);
      if (applied.duplicate || applied.records.length === 0) return [];
      const readyKey = `${decoderKey}|${frame.bridgeId}`;
      if (applied.fullSnapshot) this.#readyPartitions.add(readyKey);
      if (!this.#readyPartitions.has(readyKey)) return [];
      const normalized = normalizeSabaFootballRecords(markSabaLiveContextRecords(applied.records), {
        observedAtMs: envelope.observedAtMs,
        receivedMonotonicMs: envelope.receivedMonotonicMs,
        sequence: envelope.sequence
      });
      return this.#update(envelope, `WS:${streamId}:${frame.bridgeId}`, normalized);
    } catch (error) {
      if (error instanceof Error && error.message.includes("SABA_PUSH_SCHEMA_CHANGED:SEQUENCE_GAP")) {
        this.#dropStream(envelope.sourceId, streamId);
        return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
          invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_GAP" }];
      }
      return [];
    }
  }

  #update(envelope: ChromeBridgeEnvelope, partition: string,
    normalized: NormalizedCatalogPart): readonly DecodedCatalogUpdate[] {
    if (normalized.events.length === 0 || normalized.markets.length === 0 || normalized.quotes.length === 0) return [];
    const partitionKey = `${envelope.sourceId}|${partition}`;
    this.#parts.delete(partitionKey);
    this.#parts.set(partitionKey, normalized);
    const sourceParts = [...this.#parts].filter(([key]) => key.startsWith(`${envelope.sourceId}|`))
      .map(([, value]) => value);
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SABA",
      observedAtMs: envelope.observedAtMs, parts: sourceParts });
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog }];
  }

  #dropStream(sourceId: string, streamId: string): void {
    const decoderKey = `${sourceId}|${streamId}`;
    this.#decoders.delete(decoderKey);
    for (const key of this.#parts.keys()) {
      if (key.startsWith(`${sourceId}|WS:${streamId}:`)) this.#parts.delete(key);
    }
    for (const key of this.#readyPartitions) {
      if (key.startsWith(`${decoderKey}|`)) this.#readyPartitions.delete(key);
    }
  }
}
