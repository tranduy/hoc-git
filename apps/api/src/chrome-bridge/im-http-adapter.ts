import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { extractImFootballCatalog, mergeImFootballDelta, mergeImFootballSnapshots } from
  "../providers/im/im-football-catalog-source.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";

const ACCOUNT_ID = "catalog-source:IM:FOOTBALL";
const HOST = "imsports.directsb.net";
const SNAPSHOT_PATH = "/api/EventV6/GetSE";
const DELTA_PATH = "/api/EventV6/GetSEDelta";

export class ImHttpCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "im-http-catalog-v1";
  readonly lobby = "IM" as const;
  readonly providerFamily = "IM";
  readonly #records = new Map<string, ReturnType<typeof extractImFootballCatalog>>();
  readonly #parsedBodies = new WeakMap<ChromeBridgeEnvelope, Record<string, unknown> | null>();

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "IM" || envelope.transport !== "HTTP_RESPONSE" ||
      envelope.request.hostname !== HOST || envelope.payload.encoding !== "UTF8" ||
      (envelope.request.pathnameClass !== SNAPSHOT_PATH && envelope.request.pathnameClass !== DELTA_PATH)) return false;
    const root = parseRecord(envelope.payload.body);
    this.#parsedBodies.set(envelope, root);
    return root?.StatusCode === 100 && (envelope.request.pathnameClass === SNAPSHOT_PATH
      ? Array.isArray(root.sel) : Array.isArray(root.dc));
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const root = this.#parsedBodies.get(envelope) ?? parseRecord(envelope.payload.body);
    if (root === null) return [];
    const previous = this.#records.get(envelope.sourceId) ?? [];
    if (envelope.request.pathnameClass === DELTA_PATH && previous.length === 0) return [];
    const records = envelope.request.pathnameClass === SNAPSHOT_PATH
      ? mergeImFootballSnapshots([previous, extractImFootballCatalog(root)])
      : mergeImFootballDelta(previous, root);
    if (records.length === 0) return [];
    const normalized = normalizeSbobetCatalog(records, {
      observedAtMs: envelope.observedAtMs,
      receivedMonotonicMs: envelope.receivedMonotonicMs,
      sequence: envelope.sequence,
      provider: "IM",
      settlementProfile: "football-regulation-including-added-time"
    });
    if (normalized.events.length === 0) return [];
    this.#records.set(envelope.sourceId, records);
    const catalog: ObservedProviderCatalog = {
      dataMode: "LIVE",
      accountId: ACCOUNT_ID,
      provider: "IM",
      category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER",
      observedAtMs: envelope.observedAtMs,
      rejectedMarketCount: normalized.diagnostics.length,
      events: normalized.events,
      markets: normalized.markets,
      quotes: normalized.quotes
    };
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
