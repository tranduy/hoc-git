import { normalizeSbobetCatalog, type SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import { CmdSnapshotChunkSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { CmdSnapshotAssembler } from "./cmd-snapshot-assembler.js";

const ACCOUNT_ID = "catalog-source:APSPORT:FOOTBALL";
const RETENTION_MS = 2 * 60 * 60 * 1_000;

type JsonRecord = Record<string, unknown>;
type TsportTwoWayMarketType = Exclude<SbobetCatalogInputRecord["markets"][number]["marketType"], "FT_1X2">;
const marketTypeByGroup: Readonly<Record<string, TsportTwoWayMarketType>> = {
  "3": "FT_TOTAL", "4": "FH_TOTAL", "5": "FT_AH", "6": "FH_AH",
  "19": "CORNER_FT_AH", "20": "CORNER_FH_AH",
  "21": "CORNER_FT_TOTAL", "22": "CORNER_FH_TOTAL",
  "31": "CARD_FT_TOTAL", "32": "CARD_FH_TOTAL",
  "33": "CARD_FT_AH", "34": "CARD_FH_AH",
  "80": "SH_TOTAL", "85": "SH_AH"
};

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const domSelectionSchema = z.strictObject({
  selectionId: boundedText(128), selection: z.enum(["OVER", "UNDER", "HOME", "DRAW", "AWAY"]),
  priceText: boundedText(32), locked: z.boolean(), lineText: z.string().trim().max(32).nullable().optional()
});
const domMarketSchema = z.strictObject({
  marketId: boundedText(128),
  marketType: z.enum(["FT_TOTAL", "FT_1X2", "FT_AH", "FH_TOTAL", "FH_AH", "SH_TOTAL", "SH_AH",
    "CORNER_FT_TOTAL", "CORNER_FT_AH", "CORNER_FH_TOTAL", "CORNER_FH_AH",
    "CARD_FT_TOTAL", "CARD_FT_AH", "CARD_FH_TOTAL", "CARD_FH_AH"]),
  lineText: z.string().trim().max(32).nullable(), selections: z.array(domSelectionSchema).min(2).max(3)
});
const domRecordSchema = z.strictObject({
  eventId: boundedText(128), leagueName: boundedText(160), timeText: boundedText(80),
  scoreText: z.string().trim().max(32).nullable(), startAtUtcMs: z.number().finite().nonnegative().optional(),
  teamNames: z.array(boundedText(160)).length(2), markets: z.array(domMarketSchema).max(128)
});

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function scalar(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function parseOuter(body: string): { sport: number; type: string; event: JsonRecord } | null {
  try {
    const outer = record(JSON.parse(body));
    if (outer === null || outer.s !== 1 || outer.t !== "eu" || typeof outer.d !== "string") return null;
    const event = record(JSON.parse(outer.d));
    return event === null ? null : { sport: 1, type: "eu", event };
  } catch {
    return null;
  }
}

function inverseLine(value: string): string | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const inverse = -parsed;
  return inverse > 0 ? `+${inverse}` : String(inverse);
}

function price(odd: JsonRecord, key: "8" | "9"): string | null {
  const formats = record(odd[key]);
  return formats === null ? null : scalar(formats["2"]);
}

export function extractTsportFootballRecord(event: JsonRecord): SbobetCatalogInputRecord | null {
  const eventId = scalar(event["2"]);
  const home = text(event["5"]);
  const away = text(event["22"]);
  const leagueName = text(event["53"]);
  if (eventId === null || home === null || away === null || home === away || leagueName === null ||
    event["10"] !== "Active" || !Array.isArray(event["50"])) return null;

  const markets: SbobetCatalogInputRecord["markets"][number][] = [];
  for (const rawGroup of event["50"]) {
    const group = record(rawGroup);
    if (group === null || group["10"] !== "Active" || !Array.isArray(group["9"])) continue;
    const groupId = scalar(group["3"]);
    const marketType = groupId === null ? null : marketTypeByGroup[groupId] ?? null;
    if (marketType === null) continue;
    for (const rawOdd of group["9"]) {
      const odd = record(rawOdd);
      if (odd === null) continue;
      const line = scalar(odd["7"]);
      const firstId = scalar(odd["0"]);
      const secondId = scalar(odd["2"]);
      const marketId = scalar(odd["6"]);
      const firstPrice = price(odd, "8");
      const secondPrice = price(odd, "9");
      if ([line, firstId, secondId, marketId, firstPrice, secondPrice].some((item) => item === null)) continue;
      const isHandicap = marketType.endsWith("_AH");
      const awayLine = isHandicap ? inverseLine(line!) : null;
      if (isHandicap && awayLine === null) continue;
      markets.push({
        marketId: marketId!, marketType, lineText: line!, selections: [
          { selectionId: firstId!, selection: isHandicap ? "HOME" : "OVER",
            priceText: firstPrice!, locked: false, ...(isHandicap ? { lineText: line! } : {}) },
          { selectionId: secondId!, selection: isHandicap ? "AWAY" : "UNDER",
            priceText: secondPrice!, locked: false, ...(isHandicap ? { lineText: awayLine! } : {}) }
        ]
      });
    }
  }
  if (markets.length === 0) return null;
  const scoreHome = Number(event["25"]);
  const scoreAway = Number(event["26"]);
  const scoreText = Number.isSafeInteger(scoreHome) && scoreHome >= 0 && Number.isSafeInteger(scoreAway) && scoreAway >= 0
    ? `${scoreHome} - ${scoreAway}` : null;
  const startAtUtcMs = typeof event["11"] === "string" ? Date.parse(event["11"]) : Number.NaN;
  return { eventId, leagueName, timeText: "LIVE", scoreText,
    ...(Number.isFinite(startAtUtcMs) ? { startAtUtcMs } : {}), teamNames: [home, away], markets };
}

export class TsportWsCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "tsport-ws-catalog-v1";
  readonly lobby = "TSPORT" as const;
  readonly providerFamily = "APSPORT";
  readonly #records = new Map<string, Map<string, { record: SbobetCatalogInputRecord; seenAtMs: number }>>();
  readonly #parsed = new WeakMap<ChromeBridgeEnvelope, JsonRecord | null>();
  readonly #assembler = new CmdSnapshotAssembler();

  resetSource(sourceId: string): void {
    this.#records.delete(sourceId);
    this.#assembler.resetSource(sourceId);
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "TSPORT" || envelope.payload.encoding !== "UTF8") return false;
    if (envelope.transport === "DOM_SNAPSHOT") return envelope.request.resourceType === "DOM" &&
      envelope.request.pathnameClass === "/__fieldline_dom_snapshot__";
    if (envelope.transport !== "WS_FRAME" ||
      !/^spws\.(?:agenate|racern)\.com$/iu.test(envelope.request.hostname) ||
      !/^\/ln\/[^/]+\/(?:p\/1\/u\/[^/]+(?:\/[^/]+)?\/)?s\/1\/mg\/0\/tr\/0$/u.test(
        envelope.request.pathnameClass)) return false;
    const parsed = parseOuter(envelope.payload.body)?.event ?? null;
    this.#parsed.set(envelope, parsed);
    return parsed !== null && extractTsportFootballRecord(parsed) !== null;
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    let incomingRecords: readonly SbobetCatalogInputRecord[];
    if (envelope.transport === "DOM_SNAPSHOT") {
      let raw: unknown;
      try { raw = JSON.parse(envelope.payload.body); } catch { return []; }
      const chunk = CmdSnapshotChunkSchema.safeParse(raw);
      if (!chunk.success) return [];
      const assembled = this.#assembler.ingest(envelope.sourceId, chunk.data, envelope.observedAtMs);
      if (assembled === null || assembled.length === 0 || assembled.length > 5_000) return [];
      incomingRecords = assembled.flatMap((candidate): SbobetCatalogInputRecord[] => {
        const parsed = domRecordSchema.safeParse(candidate);
        return parsed.success ? [parsed.data as SbobetCatalogInputRecord] : [];
      });
      if (incomingRecords.length === 0) return [];
    } else {
      const event = this.#parsed.get(envelope);
      const incoming = event === null || event === undefined ? null : extractTsportFootballRecord(event);
      if (incoming === null) return [];
      incomingRecords = [incoming];
    }
    const retained = this.#records.get(envelope.sourceId) ?? new Map<string,
      { record: SbobetCatalogInputRecord; seenAtMs: number }>();
    for (const incoming of incomingRecords) {
      retained.set(incoming.eventId, { record: incoming, seenAtMs: envelope.observedAtMs });
    }
    for (const [eventId, entry] of retained) {
      if (envelope.observedAtMs - entry.seenAtMs > RETENTION_MS) retained.delete(eventId);
    }
    this.#records.set(envelope.sourceId, retained);
    const normalized = normalizeSbobetCatalog([...retained.values()].map((entry) => entry.record), {
      observedAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
      sequence: envelope.sequence, provider: "APSPORT",
      settlementProfile: "football-regulation-including-added-time"
    });
    const emptyCatalog = normalized.events.length === 0 && normalized.markets.length === 0 &&
      normalized.quotes.length === 0;
    const virtualOnly = emptyCatalog && normalized.diagnostics.length > 0 &&
      normalized.diagnostics.every((diagnostic) => diagnostic === "SBOBET_CATALOG_EVENT_UNSUPPORTED");
    if (!virtualOnly && (normalized.events.length === 0 || normalized.markets.length === 0 ||
      normalized.quotes.length === 0)) return [];
    const catalog: ObservedProviderCatalog = {
      dataMode: "LIVE", accountId: ACCOUNT_ID, provider: "APSPORT", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: envelope.observedAtMs,
      rejectedMarketCount: normalized.diagnostics.length,
      events: normalized.events, markets: normalized.markets, quotes: normalized.quotes
    };
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog }];
  }
}
