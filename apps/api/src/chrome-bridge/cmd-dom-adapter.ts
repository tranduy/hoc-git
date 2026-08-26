import { normalizeObservedFootballCatalog, type CmdCatalogInputRecord } from "@tool-chenh/adapters";
import { CmdSnapshotChunkSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";
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
  const assembled = assembler.ingest(envelope.sourceId, parsedChunk.data,
    envelope.receivedMonotonicMs, envelope.observedAtMs);
  if (!assembled) return null;
  if (assembled.length > 5_000) return null;
  if (assembled.length === 0) return [];
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
    readonly sweepOwnerKey: string;
    readonly observedAtMs: number;
    readonly receivedMonotonicMs: number;
    readonly sequence: number;
  }>>();
  readonly #sweepsBySource = new Map<string,
    Map<string, { id: string; readonly visited: Set<string> }>>();

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    return envelope.lobby === "CMD" && envelope.transport === "DOM_SNAPSHOT" &&
      envelope.request.resourceType === "DOM" &&
      envelope.request.pathnameClass === "/__fieldline_dom_snapshot__" &&
      envelope.payload.encoding === "UTF8";
  }

  resetSource(sourceId: string): void {
    this.#assembler.resetSource(sourceId);
    this.#recordsBySource.delete(sourceId);
    this.#sweepsBySource.delete(sourceId);
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const records = decodePublicDomRecords(this.#assembler, envelope);
    if (records === null) return [];
    let raw: unknown;
    try { raw = JSON.parse(envelope.payload.body); } catch { return []; }
    const chunk = CmdSnapshotChunkSchema.parse(raw);
    const usableRecords = records.filter((record) => record.groups.length > 0);
    if (usableRecords.length === 0 && !(records.length === 0 && chunk.sweepComplete === true)) return [];
    const cached = this.#recordsBySource.get(envelope.sourceId) ?? new Map();
    let changed = false;
    const sweepOwnerKey = chunk.sweepId === undefined ? "legacy" :
      `${chunk.sweepFrameKey}\u0000${chunk.sweepDocumentKey}`;
    const sourceSweeps = this.#sweepsBySource.get(envelope.sourceId) ?? new Map();
    let sweep = sourceSweeps.get(sweepOwnerKey);
    if (chunk.sweepId !== undefined && (sweep === undefined || sweep.id !== chunk.sweepId)) {
      sweep = { id: chunk.sweepId, visited: new Set<string>() };
      sourceSweeps.set(sweepOwnerKey, sweep);
      this.#sweepsBySource.set(envelope.sourceId, sourceSweeps);
    }
    for (const record of usableRecords) {
      if (chunk.sweepId !== undefined && sweep?.id === chunk.sweepId) sweep.visited.add(record.matchId);
      const prior = cached.get(record.matchId);
      if (prior !== undefined && JSON.stringify(prior.record) === JSON.stringify(record)) {
        if (prior.sweepOwnerKey !== sweepOwnerKey) {
          cached.set(record.matchId, { ...prior, sweepOwnerKey });
        }
        continue;
      }
      cached.set(record.matchId, { record, sweepOwnerKey, observedAtMs: envelope.observedAtMs,
        receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence });
      changed = true;
    }
    if (chunk.sweepComplete === true && chunk.sweepId !== undefined && sweep?.id === chunk.sweepId) {
      for (const [matchId, entry] of [...cached.entries()]) {
        if (entry.sweepOwnerKey !== sweepOwnerKey) continue;
        if (sweep.visited.has(matchId)) continue;
        cached.delete(matchId);
        changed = true;
      }
      sourceSweeps.delete(sweepOwnerKey);
      if (sourceSweeps.size === 0) this.#sweepsBySource.delete(envelope.sourceId);
    }
    this.#recordsBySource.set(envelope.sourceId, cached);
    if (!changed) return [];
    const parts: NormalizedCatalogPart[] = [...cached.values()].map((entry) => {
      const normalized = normalizeObservedFootballCatalog("CMD", [entry.record], {
        observedAtMs: entry.observedAtMs,
        receivedMonotonicMs: entry.receivedMonotonicMs,
        timezoneOffsetMinutes: 480,
        sequence: entry.sequence
      });
      const markets = normalized.markets.filter((market) => market.marketType !== "FT_1X2");
      const marketKeys = new Set(markets.map((market) => `${market.providerEventId}|${market.providerMarketId}`));
      return { diagnostics: normalized.diagnostics, events: normalized.events, markets,
        quotes: normalized.quotes.filter((quote) =>
          marketKeys.has(`${quote.providerEventId}|${quote.providerMarketId}`)) };
    });
    const catalog = mergeObservedCatalogParts({ accountId: "catalog-source:CMD:FOOTBALL", provider: "CMD",
      observedAtMs: envelope.observedAtMs, parts, collapseDuplicateEvents: true });
    const snapshotId = chunk.snapshotId;
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog, evidenceMode: "DELTA",
      generation: snapshotId, provenance: "DOM_FALLBACK",
      ...(chunk.sweepComplete === true ? { completeSweepEvidence: true } : {}) }];
  }
}
