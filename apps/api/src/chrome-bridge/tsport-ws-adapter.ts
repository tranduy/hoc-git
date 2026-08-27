import { normalizeSbobetCatalog, type SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import { CmdSnapshotChunkSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { z } from "zod";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";
import { CmdSnapshotAssembler } from "./cmd-snapshot-assembler.js";
import { websocketLifecycleState } from "./websocket-lifecycle.js";

const ACCOUNT_ID = "catalog-source:APSPORT:FOOTBALL";
const MAX_RETIRED_DOM_SWEEPS = 64;
const MAX_SOURCE_EPOCH_LINEAGES = 16;
const MAX_PENDING_PRE_PROOF_RECORDS = 5_000;
const AUTHORITATIVE_BASELINE_REFRESH_MS = 20_000;
interface RetainedRecord {
  readonly record: SbobetCatalogInputRecord;
  readonly seenAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}

interface TsportStreamGeneration {
  readonly streamId: string;
  readonly sourceEpoch: string;
  readonly generation: string;
  expectedEventIds: ReadonlySet<string>;
  explicitEmptyProof: boolean;
  readonly records: Map<string, RetainedRecord>;
  proofReady: boolean;
  baselineEmitted: boolean;
  lastBaselineAtMs: number | null;
}

interface DomSweepState {
  readonly snapshotId: string;
  readonly sourceEpoch: string;
  readonly sweepId: string;
  readonly sweepFrameKey: string;
  readonly sweepDocumentKey: string;
  readonly startedAtSequence: number;
  readonly retiredSnapshotIds: Set<string>;
  readonly eventIds: Set<string>;
  sawEventRecord: boolean;
  completed: boolean;
}

interface ExpectedEventSet {
  readonly sourceEpoch: string;
  readonly eventIds: ReadonlySet<string>;
  readonly explicitEmptyProof: boolean;
}

interface SourceEpochFence {
  activeEpoch: string;
  readonly lineageHighWatermarks: Map<string, number>;
}

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
// DOM coverage must use the same virtual-football identity boundary as the
// normalizer. Otherwise a fresh socket can deliver every raw expected event
// while the normalized catalog can never contain the virtual identities.
function isVirtualFootballIdentity(sportId: string | number | undefined,
  competition: string, teams: readonly string[]): boolean {
  if (sportId !== undefined && String(sportId) !== "1") return true;
  const label = competition.normalize("NFKC").toLocaleLowerCase("en");
  if (sportId === undefined &&
    /(?:\butr\b|\btennis\b|\bbasketball\b|\bcdbl\b|\bupvl\b|\bvolleyball\b|\btt elite\b|table tennis)/u
      .test(label)) return true;
  if (sportId === undefined && teams.length === 2 &&
    teams.every((team) => /\bpro w\s*$/iu.test(team))) return true;
  if (/(?:e[\s-]?soccer|\bvirtual\b|simulated reality|soccer marble|\bpes\b|\u1ea3o|\u0111i\u1ec7n t\u1eed)/u
    .test(label)) return true;
  if (teams.some((team) => /\(v\)\s*$/iu.test(team))) return true;
  return teams.length === 2 && teams.every((team) =>
    /(?:\((?:pg|e|pes|v|s)\)(?:\s*\([^)]*\))*|\([a-z0-9_]{4,}\))\s*$/iu.test(team));
}

const domExpectedEventSchema = z.object({
  eventId: boundedText(128),
  sportId: z.union([boundedText(16), z.number().int().nonnegative().max(10_000)]).optional(),
  leagueName: boundedText(160),
  teamNames: z.tuple([boundedText(160), boundedText(160)]),
  markets: z.array(z.unknown())
}).passthrough();

function sourceEpoch(envelope: ChromeBridgeEnvelope): string {
  return envelope.sourceEpoch ?? "legacy";
}

function sourceEpochKey(envelope: ChromeBridgeEnvelope): string {
  return `${envelope.sourceId}|${sourceEpoch(envelope)}`;
}

function generationIdentity(envelope: ChromeBridgeEnvelope, streamId: string): string {
  return JSON.stringify(["TSPORT", envelope.sourceId, sourceEpoch(envelope), streamId, envelope.sequence]);
}

function canonicalSourceEpoch(value: string): { readonly lineage: string; readonly generation: number } | null {
  const match = /^(.+):(0|[1-9]\d*)$/u.exec(value);
  if (match === null) return null;
  const generation = Number(match[2]);
  return Number.isSafeInteger(generation) ? { lineage: match[1]!, generation } : null;
}

function rememberBounded(values: Set<string>, value: string, maximum: number): void {
  if (values.has(value)) return;
  while (values.size >= maximum) {
    const oldest = values.values().next().value as string | undefined;
    if (oldest === undefined) break;
    values.delete(oldest);
  }
  values.add(value);
}

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
  readonly #expectedEventIds = new Map<string, ExpectedEventSet>();
  readonly #currentStreams = new Map<string, TsportStreamGeneration>();
  readonly #domSweepStates = new Map<string, DomSweepState>();
  readonly #sourceEpochFences = new Map<string, SourceEpochFence>();
  readonly #seenStreamIds = new Map<string, Set<string>>();
  readonly #lastOpenSequences = new Map<string, number>();
  readonly #parsed = new WeakMap<ChromeBridgeEnvelope, JsonRecord | null>();
  readonly #assembler = new CmdSnapshotAssembler();
  resetSource(sourceId: string): void {
    this.#expectedEventIds.delete(sourceId);
    this.#currentStreams.delete(sourceId);
    this.#domSweepStates.delete(sourceId);
    this.#sourceEpochFences.delete(sourceId);
    this.#assembler.resetSource(sourceId);
    for (const key of this.#seenStreamIds.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#seenStreamIds.delete(key);
    }
    for (const key of this.#lastOpenSequences.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#lastOpenSequences.delete(key);
    }
  }

  #invalidateDomEvidence(sourceId: string, epoch: string): void {
    const expected = this.#expectedEventIds.get(sourceId);
    if (expected?.sourceEpoch === epoch) this.#expectedEventIds.delete(sourceId);
    const sweep = this.#domSweepStates.get(sourceId);
    if (sweep?.sourceEpoch === epoch) {
      sweep.completed = true;
      this.#assembler.resetSource(sourceId);
    }
  }

  #acceptDomSourceEpoch(sourceId: string, epoch: string): boolean {
    const existing = this.#sourceEpochFences.get(sourceId);
    if (existing?.activeEpoch === epoch) return true;
    if (epoch === "legacy") {
      if (existing !== undefined) return false;
      this.#sourceEpochFences.set(sourceId, {
        activeEpoch: epoch,
        lineageHighWatermarks: new Map()
      });
      return true;
    }
    const candidate = canonicalSourceEpoch(epoch);
    if (candidate === null) return false;
    if (existing === undefined) {
      this.#sourceEpochFences.set(sourceId, {
        activeEpoch: epoch,
        lineageHighWatermarks: new Map([[candidate.lineage, candidate.generation]])
      });
      return true;
    }
    const priorGeneration = existing.lineageHighWatermarks.get(candidate.lineage);
    if (priorGeneration !== undefined) {
      const active = canonicalSourceEpoch(existing.activeEpoch);
      if (active?.lineage !== candidate.lineage || candidate.generation <= priorGeneration) return false;
      existing.lineageHighWatermarks.set(candidate.lineage, candidate.generation);
      existing.activeEpoch = epoch;
      return true;
    }
    if (existing.lineageHighWatermarks.size >= MAX_SOURCE_EPOCH_LINEAGES) return false;
    existing.lineageHighWatermarks.set(candidate.lineage, candidate.generation);
    existing.activeEpoch = epoch;
    return true;
  }

  /**
   * Which gate a frame left through, for the frames that produce nothing.
   *
   * Measured 2026-08-27: with the socket path corrected the frames reach this
   * adapter and still decode to nothing, and every exit below returns the same
   * empty result.
   */
  #lastIgnoreReason: string | null = null;

  takeIgnoreReason(): string | null {
    const reason = this.#lastIgnoreReason;
    this.#lastIgnoreReason = null;
    return reason;
  }

  #ignore(reason: string): [] {
    this.#lastIgnoreReason = reason;
    return [];
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "TSPORT" || envelope.payload.encoding !== "UTF8") return false;
    if (envelope.transport === "DOM_SNAPSHOT") return envelope.request.resourceType === "DOM" &&
      envelope.request.pathnameClass === "/__fieldline_dom_snapshot__";
    if ((envelope.transport !== "WS_FRAME" && envelope.transport !== "WS_STATE") ||
      envelope.request.streamId === undefined ||
      !/^spws\.(?:agenate|racern)\.com$/iu.test(envelope.request.hostname) ||
      // Measured 2026-08-27: every one of APSPORT's 4389 socket frames was
      // refused before reaching any adapter, all of them on /ln/en/lm, while
      // this required /ln/{lang}/.../s/1/mg/0/tr/0 - a path the provider no
      // longer uses. Matching an exact path means a rename silences the book
      // completely and looks identical to a book with no traffic.
      //
      // The host still has to be theirs, and the frame still has to parse as a
      // TSPORT football record below, which is what actually decides. Only
      // where on that host the stream lives is allowed to move.
      !/^\/ln\/[\w-]{1,24}\/[\w/-]{1,48}$/u.test(
        envelope.request.pathnameClass)) return false;
    if (envelope.transport === "WS_STATE") return websocketLifecycleState(envelope) !== null;
    const parsed = parseOuter(envelope.payload.body)?.event ?? null;
    this.#parsed.set(envelope, parsed);
    return parsed !== null && extractTsportFootballRecord(parsed) !== null;
  }

  #catalogUpdate(
    envelope: ChromeBridgeEnvelope,
    stream: TsportStreamGeneration,
    evidenceMode: "BASELINE" | "DELTA"
  ): DecodedCatalogUpdate | null {
    const normalizeEntry = (entry: RetainedRecord): NormalizedCatalogPart => normalizeSbobetCatalog([entry.record], {
      observedAtMs: entry.seenAtMs, receivedMonotonicMs: entry.receivedMonotonicMs,
      sequence: entry.sequence, provider: "APSPORT",
      settlementProfile: "football-regulation-including-added-time"
    });
    const retainedEntries = [...stream.records.values()];
    retainedEntries.sort((left, right) => left.sequence - right.sequence ||
      left.receivedMonotonicMs - right.receivedMonotonicMs || left.seenAtMs - right.seenAtMs);
    const parts: NormalizedCatalogPart[] = retainedEntries.map(normalizeEntry);
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "APSPORT",
      observedAtMs: envelope.observedAtMs, parts });
    const explicitEmpty = evidenceMode === "BASELINE" && stream.explicitEmptyProof &&
      stream.expectedEventIds.size === 0 &&
      stream.records.size === 0;
    const normalizedEventIds = new Set(catalog.events.map((event) => event.providerEventId));
    const normalizedMarketEventIds = new Set(catalog.markets.map((market) => market.providerEventId));
    const normalizedQuoteEventIds = new Set(catalog.quotes.map((quote) => quote.providerEventId));
    for (const expectedEventId of stream.expectedEventIds) {
      if (!normalizedEventIds.has(expectedEventId) || !normalizedMarketEventIds.has(expectedEventId) ||
        !normalizedQuoteEventIds.has(expectedEventId)) return null;
    }
    if (!explicitEmpty && (catalog.events.length === 0 || catalog.markets.length === 0 ||
      catalog.quotes.length === 0)) return null;
    const update = {
      sourceId: envelope.sourceId,
      sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs,
      value: catalog,
      evidenceMode,
      provenance: "WS" as const,
      generation: stream.generation,
      ...(evidenceMode === "BASELINE" ? { authoritativeBaseline: true as const } : {})
    };
    return update;
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    if (envelope.request.replayed === true) return [];
    if (envelope.transport === "DOM_SNAPSHOT") {
      const envelopeSourceEpoch = sourceEpoch(envelope);
      let raw: unknown;
      try {
        raw = JSON.parse(envelope.payload.body);
      } catch {
        this.#invalidateDomEvidence(envelope.sourceId, envelopeSourceEpoch);
        return [];
      }
      const chunk = CmdSnapshotChunkSchema.safeParse(raw);
      if (!chunk.success || chunk.data.sweepId === undefined || chunk.data.sweepComplete === undefined ||
        chunk.data.sweepFrameKey === undefined ||
        chunk.data.sweepDocumentKey === undefined) {
        this.#invalidateDomEvidence(envelope.sourceId, envelopeSourceEpoch);
        return [];
      }
      const binding = {
        snapshotId: chunk.data.snapshotId,
        sourceEpoch: envelopeSourceEpoch,
        sweepId: chunk.data.sweepId,
        sweepFrameKey: chunk.data.sweepFrameKey,
        sweepDocumentKey: chunk.data.sweepDocumentKey
      };
      const existing = this.#domSweepStates.get(envelope.sourceId);
      let sweep: DomSweepState;
      if (existing === undefined) {
        if (!this.#acceptDomSourceEpoch(envelope.sourceId, binding.sourceEpoch)) return [];
        sweep = { ...binding, startedAtSequence: envelope.sequence,
          retiredSnapshotIds: new Set(), eventIds: new Set(), sawEventRecord: false, completed: false };
        this.#assembler.resetSource(envelope.sourceId);
        this.#domSweepStates.set(envelope.sourceId, sweep);
      } else if (existing.sourceEpoch !== binding.sourceEpoch) {
        if (!this.#acceptDomSourceEpoch(envelope.sourceId, binding.sourceEpoch)) return [];
        sweep = { ...binding, startedAtSequence: envelope.sequence,
          retiredSnapshotIds: new Set(), eventIds: new Set(), sawEventRecord: false, completed: false };
        this.#assembler.resetSource(envelope.sourceId);
        this.#domSweepStates.set(envelope.sourceId, sweep);
      } else if (existing.snapshotId !== binding.snapshotId) {
        if (existing.retiredSnapshotIds.has(binding.snapshotId) ||
          envelope.sequence <= existing.startedAtSequence) return [];
        const retiredSnapshotIds = new Set(existing.retiredSnapshotIds);
        rememberBounded(retiredSnapshotIds, existing.snapshotId, MAX_RETIRED_DOM_SWEEPS);
        const sameSweep = !existing.completed && existing.sweepId === binding.sweepId &&
          existing.sweepFrameKey === binding.sweepFrameKey &&
          existing.sweepDocumentKey === binding.sweepDocumentKey;
        sweep = { ...binding, startedAtSequence: envelope.sequence,
          retiredSnapshotIds, eventIds: sameSweep ? new Set(existing.eventIds) : new Set(),
          sawEventRecord: sameSweep && existing.sawEventRecord,
          completed: false };
        this.#assembler.resetSource(envelope.sourceId);
        this.#domSweepStates.set(envelope.sourceId, sweep);
      } else {
        if (existing.completed || existing.sweepId !== binding.sweepId ||
          existing.sweepFrameKey !== binding.sweepFrameKey ||
          existing.sweepDocumentKey !== binding.sweepDocumentKey) return [];
        sweep = existing;
      }
      const assembled = this.#assembler.ingest(envelope.sourceId, chunk.data, envelope.observedAtMs,
        sweep.startedAtSequence);
      if (assembled === null) return [];
      for (const candidate of assembled) {
        const parsed = domExpectedEventSchema.safeParse(candidate);
        if (!parsed.success) {
          this.#invalidateDomEvidence(envelope.sourceId, envelopeSourceEpoch);
          return [];
        }
        const outsideFootballSocket = isVirtualFootballIdentity(parsed.data.sportId,
          parsed.data.leagueName, parsed.data.teamNames);
        if (!outsideFootballSocket) {
          sweep.sawEventRecord = true;
          if (parsed.data.markets.length > 0) sweep.eventIds.add(parsed.data.eventId);
        }
        if (sweep.eventIds.size > 5_000) {
          this.#invalidateDomEvidence(envelope.sourceId, envelopeSourceEpoch);
          return [];
        }
      }
      if (chunk.data.sweepComplete !== true) return [];
      sweep.completed = true;
      const expectedEventIds: ExpectedEventSet = {
        sourceEpoch: sweep.sourceEpoch,
        eventIds: new Set(sweep.eventIds),
        explicitEmptyProof: !sweep.sawEventRecord
      };
      this.#expectedEventIds.set(envelope.sourceId, expectedEventIds);
      const pending = this.#currentStreams.get(envelope.sourceId);
      if (pending !== undefined && !pending.proofReady &&
        pending.sourceEpoch === expectedEventIds.sourceEpoch &&
        (expectedEventIds.explicitEmptyProof || expectedEventIds.eventIds.size > 0)) {
        pending.expectedEventIds = new Set(expectedEventIds.eventIds);
        pending.explicitEmptyProof = expectedEventIds.explicitEmptyProof;
        pending.proofReady = true;
        for (const eventId of pending.records.keys()) {
          if (!pending.expectedEventIds.has(eventId)) pending.records.delete(eventId);
        }
        if ([...pending.expectedEventIds].every((eventId) => pending.records.has(eventId))) {
          const baseline = this.#catalogUpdate(envelope, pending, "BASELINE");
          if (baseline !== null) {
            pending.baselineEmitted = true;
            pending.lastBaselineAtMs = envelope.observedAtMs;
            return [baseline];
          }
        }
      }
      return [];
    }

    const streamId = envelope.request.streamId;
    if (streamId === undefined) return this.#ignore("no-stream-id");
    if (envelope.transport === "WS_STATE") {
      const lifecycle = websocketLifecycleState(envelope);
      if (lifecycle === null) return this.#ignore("not-a-lifecycle-frame");
      if (lifecycle === "OPEN") {
        const lifecycleKey = sourceEpochKey(envelope);
        const seenStreamIds = this.#seenStreamIds.get(lifecycleKey) ?? new Set<string>();
        const lastOpenSequence = this.#lastOpenSequences.get(lifecycleKey) ?? -1;
        if (seenStreamIds.has(streamId) || envelope.sequence <= lastOpenSequence) return this.#ignore("stale-open");
        const currentSourceEpoch = sourceEpoch(envelope);
        if (!this.#acceptDomSourceEpoch(envelope.sourceId, currentSourceEpoch)) return [];
        const expectedEventIds = this.#expectedEventIds.get(envelope.sourceId);
        const sweep = this.#domSweepStates.get(envelope.sourceId);
        const retired = this.#currentStreams.get(envelope.sourceId);
        const retiresCurrent = retired?.sourceEpoch === currentSourceEpoch && retired.streamId !== streamId;
        const proofReady = !(sweep?.sourceEpoch === currentSourceEpoch && !sweep.completed) &&
          expectedEventIds !== undefined && expectedEventIds.sourceEpoch === currentSourceEpoch &&
          (expectedEventIds.explicitEmptyProof || expectedEventIds.eventIds.size > 0);
        seenStreamIds.add(streamId);
        this.#seenStreamIds.set(lifecycleKey, seenStreamIds);
        this.#lastOpenSequences.set(lifecycleKey, envelope.sequence);
        this.#currentStreams.delete(envelope.sourceId);
        const stream: TsportStreamGeneration = {
          streamId,
          sourceEpoch: currentSourceEpoch,
          generation: generationIdentity(envelope, streamId),
          expectedEventIds: new Set(proofReady ? expectedEventIds!.eventIds : []),
          explicitEmptyProof: proofReady && expectedEventIds!.explicitEmptyProof,
          records: new Map(),
          proofReady,
          baselineEmitted: false,
          lastBaselineAtMs: null
        };
        this.#currentStreams.set(envelope.sourceId, stream);
        if (!proofReady) {
          return retiresCurrent && retired.baselineEmitted
            ? [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
                observedAtMs: envelope.observedAtMs, invalidateAccountId: ACCOUNT_ID,
                reason: "PROVIDER_STREAM_GAP" }]
            : [];
        }
        if (stream.expectedEventIds.size > 0) {
          return retired?.sourceEpoch === currentSourceEpoch && retired.baselineEmitted
            ? [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
                observedAtMs: envelope.observedAtMs, invalidateAccountId: ACCOUNT_ID,
                reason: "PROVIDER_STREAM_GAP" }]
            : [];
        }
        const baseline = this.#catalogUpdate(envelope, stream, "BASELINE");
        if (baseline === null) return this.#ignore("no-baseline");
        stream.baselineEmitted = true;
        stream.lastBaselineAtMs = envelope.observedAtMs;
        return [baseline];
      }
      const current = this.#currentStreams.get(envelope.sourceId);
      if (current === undefined || current.streamId !== streamId ||
        current.sourceEpoch !== sourceEpoch(envelope)) return [];
      this.#currentStreams.delete(envelope.sourceId);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_CLOSED" }];
    }

    let current = this.#currentStreams.get(envelope.sourceId);
    if (current === undefined) {
      const currentSourceEpoch = sourceEpoch(envelope);
      if (!this.#acceptDomSourceEpoch(envelope.sourceId, currentSourceEpoch)) return [];
      const lifecycleKey = sourceEpochKey(envelope);
      const seenStreamIds = this.#seenStreamIds.get(lifecycleKey) ?? new Set<string>();
      if (seenStreamIds.has(streamId)) return this.#ignore("stream-already-seen");
      const expectedEventIds = this.#expectedEventIds.get(envelope.sourceId);
      const sweep = this.#domSweepStates.get(envelope.sourceId);
      const proofReady = !(sweep?.sourceEpoch === currentSourceEpoch && !sweep.completed) &&
        expectedEventIds !== undefined && expectedEventIds.sourceEpoch === currentSourceEpoch &&
        (expectedEventIds.explicitEmptyProof || expectedEventIds.eventIds.size > 0);
      seenStreamIds.add(streamId);
      this.#seenStreamIds.set(lifecycleKey, seenStreamIds);
      this.#lastOpenSequences.set(lifecycleKey, envelope.sequence);
      current = {
        streamId,
        sourceEpoch: currentSourceEpoch,
        generation: generationIdentity(envelope, streamId),
        expectedEventIds: new Set(proofReady ? expectedEventIds!.eventIds : []),
        explicitEmptyProof: proofReady && expectedEventIds!.explicitEmptyProof,
        records: new Map(),
        proofReady,
        baselineEmitted: false,
        lastBaselineAtMs: null
      };
      this.#currentStreams.set(envelope.sourceId, current);
    }
    if (current.streamId !== streamId ||
      current.sourceEpoch !== sourceEpoch(envelope)) return [];
    const event = this.#parsed.get(envelope);
    const incoming = event === null || event === undefined ? null : extractTsportFootballRecord(event);
    if (incoming === null) return this.#ignore("unparsed-record");
    if (isVirtualFootballIdentity(undefined, incoming.leagueName, incoming.teamNames)) {
      if (!current.proofReady || !current.explicitEmptyProof ||
        current.expectedEventIds.size > 0) return [];
      const baselineDue = !current.baselineEmitted || current.lastBaselineAtMs === null ||
        envelope.observedAtMs - current.lastBaselineAtMs >= AUTHORITATIVE_BASELINE_REFRESH_MS;
      if (!baselineDue) return this.#ignore("baseline-not-due");
      const baseline = this.#catalogUpdate(envelope, current, "BASELINE");
      if (baseline === null) return this.#ignore("no-baseline");
      current.baselineEmitted = true;
      current.lastBaselineAtMs = envelope.observedAtMs;
      return [baseline];
    }
    if (!current.proofReady && !current.records.has(incoming.eventId) &&
      current.records.size >= MAX_PENDING_PRE_PROOF_RECORDS) {
      const lifecycleKey = sourceEpochKey(envelope);
      const seenStreamIds = this.#seenStreamIds.get(lifecycleKey);
      seenStreamIds?.delete(streamId);
      if (seenStreamIds?.size === 0) this.#seenStreamIds.delete(lifecycleKey);
      this.#lastOpenSequences.delete(lifecycleKey);
      this.#currentStreams.delete(envelope.sourceId);
      return [];
    }
    current.records.set(incoming.eventId, {
      record: incoming,
      seenAtMs: envelope.observedAtMs,
      receivedMonotonicMs: envelope.receivedMonotonicMs,
      sequence: envelope.sequence
    });
    if (!current.proofReady) return this.#ignore("proof-not-ready");
    if (!current.baselineEmitted) {
      for (const expectedEventId of current.expectedEventIds) {
        if (!current.records.has(expectedEventId)) return [];
      }
    }
    const baselineDue = !current.baselineEmitted || current.lastBaselineAtMs === null ||
      envelope.observedAtMs - current.lastBaselineAtMs >= AUTHORITATIVE_BASELINE_REFRESH_MS;
    const evidenceMode = baselineDue ? "BASELINE" : "DELTA";
    const update = this.#catalogUpdate(envelope, current, evidenceMode);
    if (update === null) return this.#ignore("no-catalog-update");
    current.baselineEmitted = true;
    if (evidenceMode === "BASELINE") current.lastBaselineAtMs = envelope.observedAtMs;
    return [update];
  }
}
