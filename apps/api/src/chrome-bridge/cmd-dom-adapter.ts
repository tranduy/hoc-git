import { normalizeObservedFootballCatalog, type CmdCatalogInputRecord } from "@tool-chenh/adapters";
import { CmdSnapshotChunkSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { CmdSnapshotAssembler } from "./cmd-snapshot-assembler.js";

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const oddSchema = z.strictObject({
  marketOddsId: text(128),
  priceText: text(32),
  status: nullableText(32),
  greyedOut: nullableText(16),
  lineText: nullableText(32).optional()
});
const groupSchema = z.strictObject({
  betTypeIds: z.array(text(80)).min(1).max(8),
  labels: z.array(z.string().trim().max(80)).max(64),
  odds: z.array(oddSchema).min(1).max(16)
});
const recordSchema = z.strictObject({
  sportId: z.literal("1"),
  leagueId: z.string().trim().max(128),
  leagueName: text(160),
  matchId: text(128),
  timeText: text(80),
  teamNames: z.array(text(160)).min(2).max(4),
  groups: z.array(groupSchema).max(128)
});
export function decodePublicDomRecords(
  assembler: CmdSnapshotAssembler,
  envelope: ChromeBridgeEnvelope
): readonly CmdCatalogInputRecord[] | null {
  let raw: unknown;
  try { raw = JSON.parse(envelope.payload.body); } catch { return null; }
  const parsedChunk = CmdSnapshotChunkSchema.safeParse(raw);
  if (!parsedChunk.success) return null;
  const assembled = assembler.ingest(envelope.sourceId, parsedChunk.data, envelope.observedAtMs);
  if (!assembled) return null;
  if (assembled.length === 0 || assembled.length > 5_000) return null;
  const records = assembled.flatMap((candidate): CmdCatalogInputRecord[] => {
    const parsed = recordSchema.safeParse(candidate);
    return parsed.success ? [parsed.data as CmdCatalogInputRecord] : [];
  });
  return records.length > 0 ? records : null;
}

export class CmdDomCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "cmd-public-dom-v1";
  readonly lobby = "CMD" as const;
  readonly providerFamily = "CMD";
  readonly #assembler = new CmdSnapshotAssembler();
  readonly #recordsBySource = new Map<string, Map<string, {
    readonly record: CmdCatalogInputRecord;
    readonly observedAtMs: number;
  }>>();
  static readonly #viewportRetentionMs = 180_000;

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    return envelope.lobby === "CMD" && envelope.transport === "DOM_SNAPSHOT" &&
      envelope.request.resourceType === "DOM" &&
      envelope.request.pathnameClass === "/__fieldline_dom_snapshot__" &&
      envelope.payload.encoding === "UTF8";
  }

  resetSource(sourceId: string): void {
    this.#assembler.resetSource(sourceId);
    this.#recordsBySource.delete(sourceId);
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const records = decodePublicDomRecords(this.#assembler, envelope);
    if (records === null) return [];
    const usableRecords = records.filter((record) => record.groups.length > 0);
    if (usableRecords.length === 0) return [];
    const cached = this.#recordsBySource.get(envelope.sourceId) ?? new Map();
    const oldestAllowedMs = envelope.observedAtMs - CmdDomCatalogAdapter.#viewportRetentionMs;
    for (const [matchId, entry] of cached) {
      if (entry.observedAtMs < oldestAllowedMs) cached.delete(matchId);
    }
    for (const record of usableRecords) {
      cached.set(record.matchId, { record, observedAtMs: envelope.observedAtMs });
    }
    this.#recordsBySource.set(envelope.sourceId, cached);
    const normalized = normalizeObservedFootballCatalog("CMD", [...cached.values()].map((entry) => entry.record), {
      observedAtMs: envelope.observedAtMs,
      receivedMonotonicMs: envelope.receivedMonotonicMs,
      timezoneOffsetMinutes: 480,
      sequence: envelope.sequence
    });
    const markets = normalized.markets.filter((market) => market.marketType !== "FT_1X2");
    const marketKeys = new Set(markets.map((market) => `${market.providerEventId}|${market.providerMarketId}`));
    const catalog: ObservedProviderCatalog = {
      dataMode: "LIVE",
      accountId: "catalog-source:CMD:FOOTBALL",
      provider: "CMD",
      category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER",
      observedAtMs: envelope.observedAtMs,
      rejectedMarketCount: normalized.diagnostics.length,
      events: normalized.events,
      markets,
      quotes: normalized.quotes.filter((quote) => marketKeys.has(`${quote.providerEventId}|${quote.providerMarketId}`))
    };
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog }];
  }
}
