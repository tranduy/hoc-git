import { normalizeObservedFootballCatalog, normalizeSabaFootballRecords } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { markSabaLiveContextRecords } from "../providers/saba/saba-football-push-browser-manager.js";
import { SabaPushDecoder } from "../providers/saba/saba-push-decoder.js";
import { parseSabaSocketFrame } from "../providers/saba/saba-socket-frame.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { CmdSnapshotAssembler } from "./cmd-snapshot-assembler.js";
import { decodePublicDomRecords } from "./cmd-dom-adapter.js";

interface NormalizedCatalogPart {
  readonly diagnostics: readonly unknown[];
  readonly events: ObservedProviderCatalog["events"];
  readonly markets: ObservedProviderCatalog["markets"];
  readonly quotes: ObservedProviderCatalog["quotes"];
}

export class SabaWsCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "saba-ws-catalog-v1";
  readonly lobby = "SABA" as const;
  readonly providerFamily = "SABA";
  readonly #decoders = new Map<string, SabaPushDecoder>();
  readonly #assembler = new CmdSnapshotAssembler();
  readonly #parts = new Map<string, NormalizedCatalogPart>();

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "SABA" || envelope.payload.encoding !== "UTF8") return false;
    if (envelope.transport === "DOM_SNAPSHOT" && envelope.request.resourceType === "DOM" &&
      envelope.request.pathnameClass === "/__fieldline_dom_snapshot__") return true;
    if (envelope.transport !== "WS_FRAME" || envelope.request.pathnameClass !== "/socket.io/") return false;
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
    try {
      const frame = parseSabaSocketFrame(envelope.payload.body);
      if (frame === null) return [];
      let decoder = this.#decoders.get(envelope.sourceId);
      if (decoder === undefined) {
        decoder = new SabaPushDecoder();
        this.#decoders.set(envelope.sourceId, decoder);
      }
      const applied = decoder.apply(frame);
      if (applied.duplicate || applied.records.length === 0) return [];
      const normalized = normalizeSabaFootballRecords(markSabaLiveContextRecords(applied.records), {
        observedAtMs: envelope.observedAtMs,
        receivedMonotonicMs: envelope.receivedMonotonicMs,
        sequence: envelope.sequence
      });
      return this.#update(envelope, `WS:${frame.bridgeId}`, normalized);
    } catch {
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
    const events = new Map<string, ObservedProviderCatalog["events"][number]>();
    const markets = new Map<string, ObservedProviderCatalog["markets"][number]>();
    const quotes = new Map<string, ObservedProviderCatalog["quotes"][number]>();
    for (const part of sourceParts) {
      for (const event of part.events) events.set(event.providerEventId, event);
      for (const market of part.markets) markets.set(`${market.providerEventId}|${market.providerMarketId}`, market);
      for (const quote of part.quotes) {
        quotes.set(`${quote.providerEventId}|${quote.providerMarketId}|${quote.providerSelectionId}`, quote);
      }
    }
    const catalog: ObservedProviderCatalog = {
      dataMode: "LIVE", accountId: "catalog-source:SABA:FOOTBALL", provider: "SABA", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: envelope.observedAtMs,
      rejectedMarketCount: sourceParts.reduce((total, part) => total + part.diagnostics.length, 0),
      events: [...events.values()], markets: [...markets.values()], quotes: [...quotes.values()]
    };
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog }];
  }
}
