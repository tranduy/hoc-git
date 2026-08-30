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
// A socket-adopted roster grows one event per unseen fixture and is only pruned
// when a real ROSTER batch replaces it, so it needs its own bound. The live view
// carries tens of fixtures; this leaves room for a busy card without letting a
// misbehaving stream grow the map without end.
const MAX_SOCKET_ADOPTED_EVENTS = 512;
const AUTHORITATIVE_BASELINE_REFRESH_MS = 20_000;
interface RetainedRecord {
  readonly record: SbobetCatalogInputRecord;
  readonly seenAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}

interface ApsportApiState {
  readonly sourceEpoch: string;
  readonly generation: string;
  readonly generationOrder: readonly [number, number];
  readonly prematchWindowHours: number;
  readonly rosterEventIds: Set<string>;
  readonly rosterRecords: Map<string, RetainedRecord>;
  readonly detailRecords: Map<string, RetainedRecord>;
  readonly socketRecords: Map<string, RetainedRecord>;
  readonly exactEventIds: Set<string>;
  readonly openStreams: Set<string>;
  readonly footballStreams: Set<string>;
  baselineEmitted: boolean;
  // True while the roster established with no fixtures at all, which is when
  // the socket's own records are allowed to populate it.
  adoptsSocketFixtures: boolean;
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
const apsportCatalogBatchSchema = z.object({
  schemaVersion: z.literal(1),
  generation: boundedText(128),
  phase: z.enum(["ROSTER", "DETAIL"]),
  complete: z.boolean(),
  trigger: z.enum(["SWEEP", "EVENT_CHANGE"]).optional(),
  prematchWindowHours: z.number().int().min(1).max(48),
  records: z.array(z.record(z.string(), z.unknown())).max(5_000)
}).strict();
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

function apsportGeneration(value: string): { readonly order: readonly [number, number] } | null {
  const match = /^apsport:(\d+):(\d+)$/u.exec(value);
  if (match === null) return null;
  const tabId = Number(match[1]);
  const ordinal = Number(match[2]);
  return Number.isSafeInteger(tabId) && Number.isSafeInteger(ordinal)
    ? { order: [tabId, ordinal] }
    : null;
}

function compareGeneration(left: readonly [number, number], right: readonly [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}

function apsportRawEventId(event: JsonRecord): string | null {
  const id = scalar(event["2"]);
  return id !== null && id.trim() !== "" && id.length <= 128 ? id : null;
}

function activeApsportApiEvent(event: JsonRecord): boolean {
  if (event["10"] === "Active") return true;
  if (event["10"] !== undefined && event["10"] !== null && event["10"] !== "") return false;
  return Array.isArray(event["50"]) && event["50"].some((candidate) => {
    const group = record(candidate);
    return group !== null && group["10"] === "Active" && marketTypeByGroup[String(group["3"])] !== undefined &&
      Array.isArray(group["9"]) && group["9"].length > 0;
  });
}

function eligibleApsportApiEvent(event: JsonRecord, nowMs: number, prematchWindowHours: number): boolean {
  if (apsportRawEventId(event) === null || !activeApsportApiEvent(event)) return false;
  const home = text(event["5"]);
  const away = text(event["22"]);
  const league = text(event["53"]);
  if (home === null || away === null || league === null ||
    isVirtualFootballIdentity(undefined, league, [home, away])) return false;
  if (event["6"] === true) return true;
  if (typeof event["11"] !== "string") return false;
  const startAtMs = Date.parse(event["11"]);
  if (!Number.isFinite(startAtMs)) return false;
  return startAtMs >= nowMs && startAtMs <= nowMs + prematchWindowHours * 60 * 60 * 1_000;
}

function retainedRecord(record: SbobetCatalogInputRecord, envelope: ChromeBridgeEnvelope): RetainedRecord {
  return { record, seenAtMs: envelope.observedAtMs,
    receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence };
}

function sameRecord(left: SbobetCatalogInputRecord | undefined, right: SbobetCatalogInputRecord): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Why a frame is not a TSPORT football record, counted by shape.
 *
 * Measured 2026-08-27: with the socket path corrected APSPORT's frames reach
 * this adapter and none decodes. Both checks below refuse in silence, and the
 * envelope and the record can fail for six different reasons between them.
 * Field names and type words only - no value from a frame is ever kept.
 */
export const tsportContentRefusals = new Map<string, number>();

function noteRefusal(reason: string): null {
  if (tsportContentRefusals.size < 12 || tsportContentRefusals.has(reason)) {
    tsportContentRefusals.set(reason, (tsportContentRefusals.get(reason) ?? 0) + 1);
  }
  return null;
}

function parseOuter(body: string): { sport: number; type: string; event: JsonRecord } | null {
  try {
    const outer = record(JSON.parse(body));
    if (outer === null) return noteRefusal("outer-not-an-object");
    if (outer.s !== 1) {
      // The envelope no longer carries s at all, and the reason alone cannot
      // say what replaced it. Field names are structure, not content, so the
      // keys are safe to keep where a value would not be.
      // The keys are the ones expected, so it is the sport marker itself that
      // has changed. A sport id is what separates football from basketball, so
      // it decides the fix and is structure rather than content.
      return noteRefusal(Object.prototype.hasOwnProperty.call(outer, "s")
        ? `outer-s-is-${JSON.stringify(outer.s)?.replace(/[^\w.]/gu, "").slice(0, 12)}` +
          `-t-${String(outer.t).replace(/[^\w]/gu, "").slice(0, 8)}`
        : `outer-keys-${Object.keys(outer).sort().slice(0, 8)
          .map((key) => key.replace(/[^\w]/gu, "").slice(0, 10)).join("-") || "none"}`);
    }
    if (outer.t !== "eu") return noteRefusal(`outer-t-${String(outer.t).slice(0, 12)}`);
    if (typeof outer.d !== "string") return noteRefusal(`outer-d-${typeof outer.d}`);
    const event = record(JSON.parse(outer.d));
    return event === null ? noteRefusal("inner-not-an-object") : { sport: 1, type: "eu", event };
  } catch {
    return noteRefusal("outer-unparsable");
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
  if (eventId === null) return noteRefusal("record-no-id");
  if (home === null || away === null || home === away) return noteRefusal("record-no-teams");
  if (leagueName === null) return noteRefusal("record-no-league");
  if (!Array.isArray(event["50"])) return noteRefusal("record-no-markets");

  // A book pausing a market is telling us the price is no longer on offer, and
  // refusing the frame that said so left the price it had standing as current.
  // That is what an impossible edge is made of, so a pause is carried through
  // as a locked selection - which the normalizer publishes as SUSPENDED, and
  // which comparison and staking already decline to price.
  const eventActive = activeApsportApiEvent(event);
  const markets: SbobetCatalogInputRecord["markets"][number][] = [];
  for (const rawGroup of event["50"]) {
    const group = record(rawGroup);
    if (group === null || !Array.isArray(group["9"])) continue;
    const locked = !eventActive || group["10"] !== "Active";
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
            priceText: firstPrice!, locked, ...(isHandicap ? { lineText: line! } : {}) },
          { selectionId: secondId!, selection: isHandicap ? "AWAY" : "UNDER",
            priceText: secondPrice!, locked, ...(isHandicap ? { lineText: awayLine! } : {}) }
        ]
      });
    }
  }
  // A frame that carries a score or a clock and no market is ordinary, and
  // saying so is what keeps it from reading as a fixture nobody carries.
  if (markets.length === 0) return noteRefusal("record-no-usable-markets");
  const scoreHome = Number(event["25"]);
  const scoreAway = Number(event["26"]);
  const scoreText = Number.isSafeInteger(scoreHome) && scoreHome >= 0 && Number.isSafeInteger(scoreAway) && scoreAway >= 0
    ? `${scoreHome} - ${scoreAway}` : null;
  const startAtUtcMs = typeof event["11"] === "string" ? Date.parse(event["11"]) : Number.NaN;
  const isLive = event["6"] === true;
  return { eventId, leagueName, timeText: isLive ? "LIVE" : "PREMATCH", scoreText: isLive ? scoreText : null,
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
  readonly #apiSources = new Map<string, ApsportApiState>();
  readonly #parsed = new WeakMap<ChromeBridgeEnvelope, JsonRecord | null>();
  readonly #assembler = new CmdSnapshotAssembler();
  resetSource(sourceId: string): void {
    this.#expectedEventIds.delete(sourceId);
    this.#currentStreams.delete(sourceId);
    this.#domSweepStates.delete(sourceId);
    this.#sourceEpochFences.delete(sourceId);
    this.#apiSources.delete(sourceId);
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
    if (envelope.transport === "HTTP_RESPONSE") return envelope.request.resourceType === "Fetch" &&
      envelope.request.pathnameClass === "/__fieldline_apsport_catalog_refresh__" &&
      (envelope.request.hostname === "agenate.com" || envelope.request.hostname.endsWith(".agenate.com"));
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

  #apiCatalogUpdate(
    envelope: ChromeBridgeEnvelope,
    state: ApsportApiState,
    evidenceMode: "BASELINE" | "DELTA",
    provenance: "WS" | "AUTHENTICATED_HTTP"
  ): DecodedCatalogUpdate {
    const normalizeEntry = (entry: RetainedRecord): NormalizedCatalogPart => normalizeSbobetCatalog([entry.record], {
      observedAtMs: entry.seenAtMs, receivedMonotonicMs: entry.receivedMonotonicMs,
      sequence: entry.sequence, provider: "APSPORT",
      settlementProfile: "football-regulation-including-added-time"
    });
    const retainedEntries = [...state.rosterRecords.values(), ...state.detailRecords.values(),
      ...state.socketRecords.values()];
    retainedEntries.sort((left, right) => left.sequence - right.sequence ||
      left.receivedMonotonicMs - right.receivedMonotonicMs || left.seenAtMs - right.seenAtMs);
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "APSPORT",
      observedAtMs: envelope.observedAtMs, parts: retainedEntries.map(normalizeEntry) });
    return {
      sourceId: envelope.sourceId,
      sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs,
      value: catalog,
      evidenceMode,
      provenance,
      generation: state.generation,
      providerTimestampMs: null,
      ...(evidenceMode === "BASELINE" ? { authoritativeBaseline: true as const } : {})
    };
  }

  #decodeApiBatch(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    let raw: unknown;
    try { raw = JSON.parse(envelope.payload.body); } catch { return this.#ignore("roster-body-unparsed"); }
    const batch = apsportCatalogBatchSchema.safeParse(raw);
    if (!batch.success) return this.#ignore("roster-shape");
    const parsedGeneration = apsportGeneration(batch.data.generation);
    if (parsedGeneration === null || parsedGeneration.order[0] !== envelope.tabId ||
      !this.#acceptDomSourceEpoch(envelope.sourceId, sourceEpoch(envelope))) return this.#ignore("roster-generation-or-epoch");
    const current = this.#apiSources.get(envelope.sourceId);
    if (batch.data.phase === "ROSTER") {
      if (!batch.data.complete || (current !== undefined && current.sourceEpoch === sourceEpoch(envelope) &&
        compareGeneration(parsedGeneration.order, current.generationOrder) <= 0)) return this.#ignore("roster-incomplete-or-old");
      const rosterEventIds = new Set<string>();
      const rosterRecords = new Map<string, RetainedRecord>();
      for (const rawEvent of batch.data.records) {
        if (!eligibleApsportApiEvent(rawEvent, envelope.observedAtMs, batch.data.prematchWindowHours)) continue;
        const eventId = apsportRawEventId(rawEvent)!;
        rosterEventIds.add(eventId);
        const extracted = extractTsportFootballRecord(rawEvent);
        if (extracted !== null) rosterRecords.set(eventId, retainedRecord(extracted, envelope));
      }
      const sameEpoch = current?.sourceEpoch === sourceEpoch(envelope);
      const retainEligible = (input: ReadonlyMap<string, RetainedRecord>): Map<string, RetainedRecord> =>
        new Map([...input].filter(([eventId]) => rosterEventIds.has(eventId)));
      const state: ApsportApiState = {
        sourceEpoch: sourceEpoch(envelope), generation: batch.data.generation,
        generationOrder: parsedGeneration.order, prematchWindowHours: batch.data.prematchWindowHours,
        rosterEventIds, rosterRecords,
        detailRecords: sameEpoch ? retainEligible(current!.detailRecords) : new Map(),
        socketRecords: sameEpoch ? retainEligible(current!.socketRecords) : new Map(),
        exactEventIds: new Set(),
        openStreams: sameEpoch ? new Set(current!.openStreams) : new Set(),
        footballStreams: sameEpoch ? new Set(current!.footballStreams) : new Set(),
        baselineEmitted: true,
        adoptsSocketFixtures: rosterEventIds.size === 0
      };
      this.#apiSources.set(envelope.sourceId, state);
      return [this.#apiCatalogUpdate(envelope, state, "BASELINE", "AUTHENTICATED_HTTP")];
    }
    if (current === undefined || current.sourceEpoch !== sourceEpoch(envelope) ||
      current.generation !== batch.data.generation ||
      current.prematchWindowHours !== batch.data.prematchWindowHours) return this.#ignore("delta-generation-mismatch");
    const isExactEventChange = batch.data.trigger === "EVENT_CHANGE";
    let changed = false;
    for (const rawEvent of batch.data.records) {
      const eventId = apsportRawEventId(rawEvent);
      if (eventId === null) continue;
      const wasKnown = current.rosterEventIds.has(eventId);
      if (!isExactEventChange && (!wasKnown || current.exactEventIds.has(eventId))) continue;
      if (isExactEventChange &&
        !eligibleApsportApiEvent(rawEvent, envelope.observedAtMs, batch.data.prematchWindowHours)) {
        if (!wasKnown) continue;
        current.exactEventIds.add(eventId);
        current.rosterEventIds.delete(eventId);
        current.rosterRecords.delete(eventId);
        current.detailRecords.delete(eventId);
        current.socketRecords.delete(eventId);
        changed = true;
        continue;
      }
      if (!eligibleApsportApiEvent(rawEvent, envelope.observedAtMs, batch.data.prematchWindowHours)) continue;
      const extracted = extractTsportFootballRecord(rawEvent);
      const previous = current.detailRecords.get(eventId)?.record;
      if (extracted === null) {
        if (isExactEventChange && wasKnown) {
          current.exactEventIds.add(eventId);
          current.rosterEventIds.delete(eventId);
          current.rosterRecords.delete(eventId);
          current.socketRecords.delete(eventId);
          changed = true;
        }
        if (current.detailRecords.delete(eventId)) changed = true;
        continue;
      }
      if (isExactEventChange) {
        current.rosterEventIds.add(eventId);
        current.exactEventIds.add(eventId);
        current.socketRecords.delete(eventId);
        changed = true;
      } else if (!sameRecord(previous, extracted)) changed = true;
      current.detailRecords.set(eventId, retainedRecord(extracted, envelope));
    }
    if (!changed) return this.#ignore("delta-no-change");
    return [this.#apiCatalogUpdate(envelope, current, "DELTA", "AUTHENTICATED_HTTP")];
  }

  #decodeApiSocketState(envelope: ChromeBridgeEnvelope, state: ApsportApiState,
    streamId: string): readonly DecodedCatalogUpdate[] {
    if (state.sourceEpoch !== sourceEpoch(envelope)) return this.#ignore("socket-epoch-mismatch");
    const lifecycle = websocketLifecycleState(envelope);
    if (lifecycle === null) return this.#ignore("socket-not-lifecycle");
    if (lifecycle === "OPEN") {
      state.openStreams.add(streamId);
      return this.#ignore("socket-open");
    }
    state.openStreams.delete(streamId);
    const wasFootball = state.footballStreams.delete(streamId);
    if (!wasFootball || state.footballStreams.size > 0 || !state.baselineEmitted) return [];
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, invalidateAccountId: ACCOUNT_ID,
      reason: "PROVIDER_STREAM_CLOSED" }];
  }

  #decodeApiSocketFrame(envelope: ChromeBridgeEnvelope, state: ApsportApiState,
    streamId: string): readonly DecodedCatalogUpdate[] {
    if (state.sourceEpoch !== sourceEpoch(envelope)) return [];
    const event = this.#parsed.get(envelope);
    const incoming = event === null || event === undefined ? null : extractTsportFootballRecord(event);
    // Two different frames were counted under one name, and they call for
    // opposite fixes: one is a frame this adapter could not read as a football
    // record at all, the other a fixture the roster does not carry.
    if (incoming === null) return this.#ignore("socket-record-unusable");
    if (!state.rosterEventIds.has(incoming.eventId)) {
      // The roster size decides which of two very different faults this is: an
      // empty roster is a roster that never established, while a full one that
      // matches nothing is a socket numbering its fixtures another way.
      if (!state.adoptsSocketFixtures) {
        return this.#ignore(`socket-not-in-roster-of-${state.rosterEventIds.size}`);
      }
      // Measured 2026-08-31: with the provider tab on its live view the page
      // never issues the list request the roster is captured from, so the
      // roster established empty and every socket frame was refused - 636 of
      // them while the book sat dark and the operator was told to go move a
      // browser tab. Those frames carry the whole record (id, teams, league,
      // priced market groups), so an empty roster adopts them instead.
      //
      // This is not the fragment-as-baseline trap: there is no catalog here to
      // replace, each frame only adds its own event, and the next real ROSTER
      // batch still replaces the lot wholesale on a higher generation.
      if (state.socketRecords.size >= MAX_SOCKET_ADOPTED_EVENTS) {
        return this.#ignore(`socket-adopted-roster-full-${state.socketRecords.size}`);
      }
      state.rosterEventIds.add(incoming.eventId);
    }
    state.openStreams.add(streamId);
    state.footballStreams.add(streamId);
    const previous = state.socketRecords.get(incoming.eventId)?.record;
    if (sameRecord(previous, incoming)) return [{ sourceId: envelope.sourceId,
      sequence: envelope.sequence, observedAtMs: envelope.observedAtMs, transportAlive: true }];
    state.socketRecords.set(incoming.eventId, retainedRecord(incoming, envelope));
    // While the socket is the roster, each update carries fixtures the empty
    // baseline never covered, and the coverage guard rightly refuses a delta
    // that invents events - measured 2026-08-31, that left the book publishing
    // an empty catalog while frames arrived every 122 ms. The accumulated set
    // is the whole book this lane knows, so it is offered as the baseline it
    // actually is, and stays monotonic until a real roster replaces it.
    if (state.adoptsSocketFixtures) {
      return [this.#apiCatalogUpdate(envelope, state, "BASELINE", "WS")];
    }
    return [this.#apiCatalogUpdate(envelope, state, "DELTA", "WS")];
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
    if (envelope.transport === "HTTP_RESPONSE") return this.#decodeApiBatch(envelope);
    if (envelope.transport === "DOM_SNAPSHOT") {
      const envelopeSourceEpoch = sourceEpoch(envelope);
      let raw: unknown;
      try {
        raw = JSON.parse(envelope.payload.body);
      } catch {
        this.#invalidateDomEvidence(envelope.sourceId, envelopeSourceEpoch);
        return this.#ignore("dom-body-unparsed");
      }
      const chunk = CmdSnapshotChunkSchema.safeParse(raw);
      if (!chunk.success || chunk.data.sweepId === undefined || chunk.data.sweepComplete === undefined ||
        chunk.data.sweepFrameKey === undefined ||
        chunk.data.sweepDocumentKey === undefined) {
        this.#invalidateDomEvidence(envelope.sourceId, envelopeSourceEpoch);
        return this.#ignore("dom-chunk-shape");
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
          envelope.sequence <= existing.startedAtSequence) return this.#ignore("dom-sweep-superseded");
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
          existing.sweepDocumentKey !== binding.sweepDocumentKey) return this.#ignore("dom-sweep-rebound");
        sweep = existing;
      }
      const assembled = this.#assembler.ingest(envelope.sourceId, chunk.data, envelope.observedAtMs,
        sweep.startedAtSequence);
      if (assembled === null) return this.#ignore("dom-chunk-incomplete");
      for (const candidate of assembled) {
        const parsed = domExpectedEventSchema.safeParse(candidate);
        if (!parsed.success) {
          this.#invalidateDomEvidence(envelope.sourceId, envelopeSourceEpoch);
          return this.#ignore("dom-expected-shape");
        }
        const outsideFootballSocket = isVirtualFootballIdentity(parsed.data.sportId,
          parsed.data.leagueName, parsed.data.teamNames);
        if (!outsideFootballSocket) {
          sweep.sawEventRecord = true;
          if (parsed.data.markets.length > 0) sweep.eventIds.add(parsed.data.eventId);
        }
        if (sweep.eventIds.size > 5_000) {
          this.#invalidateDomEvidence(envelope.sourceId, envelopeSourceEpoch);
          return this.#ignore("dom-sweep-too-large");
        }
      }
      if (chunk.data.sweepComplete !== true) return this.#ignore("dom-sweep-not-complete");
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
      return this.#ignore("dom-no-sweep-outcome");
    }

    const streamId = envelope.request.streamId;
    if (streamId === undefined) return this.#ignore("no-stream-id");
    const apiState = this.#apiSources.get(envelope.sourceId);
    if (apiState !== undefined) {
      return envelope.transport === "WS_STATE"
        ? this.#decodeApiSocketState(envelope, apiState, streamId)
        : this.#decodeApiSocketFrame(envelope, apiState, streamId);
    }
    if (envelope.transport === "WS_STATE") {
      const lifecycle = websocketLifecycleState(envelope);
      if (lifecycle === null) return this.#ignore("not-a-lifecycle-frame");
      if (lifecycle === "OPEN") {
        const lifecycleKey = sourceEpochKey(envelope);
        const seenStreamIds = this.#seenStreamIds.get(lifecycleKey) ?? new Set<string>();
        const lastOpenSequence = this.#lastOpenSequences.get(lifecycleKey) ?? -1;
        if (seenStreamIds.has(streamId) || envelope.sequence <= lastOpenSequence) return this.#ignore("stale-open");
        const currentSourceEpoch = sourceEpoch(envelope);
        if (!this.#acceptDomSourceEpoch(envelope.sourceId, currentSourceEpoch)) return this.#ignore("open-epoch-refused");
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
        current.sourceEpoch !== sourceEpoch(envelope)) return this.#ignore("stream-changed-mid-baseline");
      this.#currentStreams.delete(envelope.sourceId);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_CLOSED" }];
    }

    let current = this.#currentStreams.get(envelope.sourceId);
    if (current === undefined) {
      const currentSourceEpoch = sourceEpoch(envelope);
      if (!this.#acceptDomSourceEpoch(envelope.sourceId, currentSourceEpoch)) return this.#ignore("record-epoch-refused");
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
      current.sourceEpoch !== sourceEpoch(envelope)) return this.#ignore("stream-changed");
    const event = this.#parsed.get(envelope);
    const incoming = event === null || event === undefined ? null : extractTsportFootballRecord(event);
    if (incoming === null) return this.#ignore("unparsed-record");
    if (isVirtualFootballIdentity(undefined, incoming.leagueName, incoming.teamNames)) {
      if (!current.proofReady || !current.explicitEmptyProof ||
        current.expectedEventIds.size > 0) return this.#ignore("virtual-without-proof");
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
      return this.#ignore("stream-closed");
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
        if (!current.records.has(expectedEventId)) return this.#ignore("baseline-awaiting-expected");
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
