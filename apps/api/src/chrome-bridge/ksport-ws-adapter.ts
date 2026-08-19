import { normalizeSbobetCatalog, type SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { extractSbobetDirectCatalogRecords } from "../providers/sbobet/sbobet-direct-catalog.js";
import { decodeSbobetStompBodies } from "../providers/sbobet/sbobet-stomp.js";
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
  readonly #records = new Map<string, Map<string, RetainedRecord>>();

  resetSource(sourceId: string): void {
    for (const key of this.#records.keys()) if (key.startsWith(`${sourceId}|`)) this.#records.delete(key);
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "KSPORT" || envelope.payload.encoding !== "UTF8" ||
      !envelope.request.pathnameClass.startsWith("/sport/") || envelope.request.streamId === undefined) return false;
    if (envelope.transport === "WS_STATE") return websocketLifecycleState(envelope) !== null;
    return envelope.transport === "WS_FRAME" &&
      envelope.payload.body.includes("destination:/topic/sports/") &&
      decodeSbobetStompBodies(envelope.payload.body).length > 0;
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const streamKey = `${envelope.sourceId}|${envelope.request.streamId ?? "legacy"}`;
    if (envelope.transport === "WS_STATE") {
      const state = websocketLifecycleState(envelope);
      if (state === null) return [];
      this.#records.delete(streamKey);
      if (state === "OPEN") return [];
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_CLOSED" }];
    }
    const live = envelope.payload.body.includes("/live/");
    const changed: readonly SbobetCatalogInputRecord[] = decodeSbobetStompBodies(envelope.payload.body).flatMap((body) => {
      const bootstrap = bootstrapRecords(body, live);
      return extractSbobetDirectCatalogRecords(body, bootstrap);
    });
    if (changed.length === 0) return [];
    const retained = this.#records.get(streamKey) ?? new Map<string, RetainedRecord>();
    for (const incoming of changed) {
      const previous = retained.get(incoming.eventId)?.record;
      const markets = new Map<string, SbobetCatalogInputRecord["markets"][number]>(
        previous?.markets.map((market) => [market.marketId, market] as const) ?? []);
      incoming.markets.forEach((market) => markets.set(market.marketId, market));
      retained.set(incoming.eventId, { record: { ...incoming, markets: [...markets.values()] },
        seenAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
        sequence: envelope.sequence });
    }
    // K-Sports publishes deltas: silence for one event means "unchanged", not
    // "deleted". Keep its last provider state for this socket generation and
    // clear it only at the WS lifecycle boundary handled above.
    this.#records.set(streamKey, retained);
    const parts: NormalizedCatalogPart[] = [];
    for (const [key, streamRecords] of this.#records) {
      if (!key.startsWith(`${envelope.sourceId}|`)) continue;
      for (const entry of streamRecords.values()) {
        parts.push(normalizeSbobetCatalog([entry.record], {
          observedAtMs: entry.seenAtMs, receivedMonotonicMs: entry.receivedMonotonicMs,
          sequence: entry.sequence, provider: "SBOBET",
          settlementProfile: "football-regulation-including-added-time"
        }));
      }
    }
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SBOBET",
      observedAtMs: envelope.observedAtMs, parts });
    if (catalog.events.length === 0 || catalog.markets.length === 0 || catalog.quotes.length === 0) return [];
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog }];
  }
}
