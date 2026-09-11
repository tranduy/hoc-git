import { normalizeObservedFootballCatalog, normalizeSabaFootballRecords,
  observeNativeCmdMarkets } from "@tool-chenh/adapters";
import type { CmdCatalogInputRecord } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { SabaPushDecoder } from "../providers/saba/saba-push-decoder.js";
import { parseSabaSocketFrame } from "../providers/saba/saba-socket-frame.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type CatalogEvent, type NormalizedCatalogPart } from "./catalog-part-merge.js";
import { CmdSnapshotAssembler } from "./cmd-snapshot-assembler.js";
import { decodePublicDomRecords } from "./cmd-dom-adapter.js";
import { SabaCollectorDomAssembler, type ValidatedSabaCollectorCandidate } from "./saba-collector-dom.js";
import { augmentSabaDomCleanSheet } from "./saba-clean-sheet-dom.js";
import { websocketLifecycleState } from "./websocket-lifecycle.js";
import type { SabaQuoteClockMapper } from "./saba-quote-clock.js";

const ACCOUNT_ID = "catalog-source:SABA:FOOTBALL";
const MAX_RETAINED_PART_AGE_MS = 3_600_000;
// How long the socket lane may refuse frames for want of a reset/empty frame
// before that refusal is reported as a stream gap instead of silence.
//
// Measured 2026-08-31 over 27 minutes of live watch: this provider drops and
// replaces its socket roughly every fourteen minutes, and the replacement
// streams deltas without ever resending reset, so the whole window is dead
// time the book spends refusing frames it cannot use. Reporting at 20s made
// each rotation a ~30s outage. The action this triggers is a snapshot request
// that reloads and navigates nothing, so it can afford to be prompt; a genuine
// MV3 handover still reseeds well inside eight seconds.
const BASELINE_STARVATION_MS = 8_000;
// A decode fault is likelier to be a transient handover artefact than a dead
// stream, so it keeps the longer, more patient window.
const FAULT_HOLD_MS = 20_000;
const MIN_STABLE_DOM_EVENTS = 20;
const SINGLE_GENERATION_DOM_EVENTS = 50;
const SABA_SCHEMA_CONTEXT_PATH = "/__fieldline_saba_schema_context__";
const SABA_SCHEMA_CONTEXT_MAX_BYTES = 256 * 1024;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSabaEngineIoHeartbeat(body: string): boolean {
  return body === "2" || body === "3";
}

function sabaDecodeFaultLabel(message: string): string {
  const raw = message === "SABA_PUSH_FRAME_INVALID" ? "frame-invalid"
    : message.startsWith("SABA_PUSH_SCHEMA_CHANGED:")
      ? message.slice("SABA_PUSH_SCHEMA_CHANGED:".length)
      : message === "SABA_PUSH_SCHEMA_CHANGED" ? "invalid" : "unknown";
  // Decoder errors contain protocol field/type names only. Keep the label
  // path-safe and bounded before it enters aggregate telemetry.
  return raw.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 64) || "unknown";
}

function sourceEpoch(envelope: ChromeBridgeEnvelope): string {
  return envelope.sourceEpoch ?? "legacy";
}

function sourceEpochKey(envelope: ChromeBridgeEnvelope): string {
  return `${envelope.sourceId}|${sourceEpoch(envelope)}`;
}

function canonicalSabaSourceEpoch(value: string): {
  readonly lineage: string; readonly generation: number
} | null {
  const match = /^([^|]+):(0|[1-9]\d*)$/u.exec(value);
  if (match === null) return null;
  const generation = Number(match[2]);
  return Number.isSafeInteger(generation) ? { lineage: match[1]!, generation } : null;
}

function liveIdentityScore(event: CatalogEvent): number {
  if (event.category !== "FOOTBALL" || event.liveState === null) return 0;
  const state = event.liveState;
  return Number(state.period !== null) + Number(state.clockMs !== null) +
    Number(state.scoreHome !== null) + Number(state.scoreAway !== null);
}

function selectStableSabaEvent(current: CatalogEvent, candidate: CatalogEvent): CatalogEvent {
  const currentScore = liveIdentityScore(current);
  const candidateScore = liveIdentityScore(candidate);
  if (candidateScore !== currentScore) return candidateScore > currentScore ? candidate : current;
  // SABA's page labels its whole live-betting section "TRỰC TIẾP", so the DOM
  // reports fixtures as live hours before kickoff with no period, clock or
  // score behind it. When neither record carries live evidence, keep the one
  // that does not claim live: it is the socket record, and it still holds the
  // provider's real kickoff time. A live event is never comparable with
  // another book's pre-match one, so guessing here silently hides fixtures.
  if (currentScore === 0 && current.isLive !== candidate.isLive) {
    return current.isLive ? candidate : current;
  }
  return current;
}

function stableDomCoverage(previous: ReadonlySet<string>, current: ReadonlySet<string>): boolean {
  if (previous.size === 0 || current.size === 0) return false;
  let shared = 0;
  for (const identity of current) if (previous.has(identity)) shared += 1;
  const smaller = Math.min(previous.size, current.size);
  const sizeDrift = Math.abs(previous.size - current.size);
  return shared / smaller >= 0.95 && sizeDrift <= Math.max(5, Math.ceil(previous.size * 0.1));
}

interface SabaStreamState {
  activeStreamId: string | null;
  activeStreamOrdinal: number | null;
  highWatermark: number;
  authorizing: boolean;
}

interface PendingCollectorRetention {
  readonly sourceId: string;
  readonly targetEpoch: string;
  readonly part: NormalizedCatalogPart;
  readonly prematchIds: ReadonlySet<string>;
  readonly originalObservedAtMs: number;
}

export class SabaWsCatalogAdapter implements ChromeTrafficAdapter {
  readonly #quoteClockMapper: SabaQuoteClockMapper | undefined;
  readonly #requireSocketBaseline: boolean;
  readonly #allowValidatedDomFallback: boolean;

  constructor(options: { readonly quoteClockMapper?: SabaQuoteClockMapper;
    // Production requires a validated native partition or a main-roster proof.
    // Collector completeness is separate from whether current quotes are usable.
    readonly requireSocketBaseline?: boolean; readonly allowValidatedDomFallback?: boolean } = {}) {
    this.#quoteClockMapper = options.quoteClockMapper;
    this.#requireSocketBaseline = options.requireSocketBaseline === true;
    this.#allowValidatedDomFallback = options.allowValidatedDomFallback === true;
  }

  /**
   * Which gate a frame left through, for the frames that produce nothing.
   *
   * Measured 2026-08-27: SABA received frames continuously - between 100 and
   * 330 per sample - while its catalog was republished roughly once every
   * hundred seconds, past its own 75 s freshness window, so the feed fell to
   * STALLED and the book read as offline for most of six hours. Every one of
   * these exits returns the same empty result, so nothing could say which.
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

  readonly id = "saba-ws-catalog-v1";
  readonly lobby = "SABA" as const;
  readonly providerFamily = "SABA";
  readonly #decoders = new Map<string, SabaPushDecoder>();
  readonly #assembler = new CmdSnapshotAssembler();
  readonly #collectorAssembler = new SabaCollectorDomAssembler();
  readonly #collectorBindings = new Map<string, {
    readonly generation: string; readonly frame: string; readonly document: string;
    readonly rosters: ReadonlyMap<string, ValidatedSabaCollectorCandidate["captures"][number]>;
    readonly lastScheduledClock: Map<string, number>;
  }>();
  readonly #collectorEpochs = new Map<string, string>();
  readonly #collectorPrematchIds = new Map<string, ReadonlySet<string>>();
  readonly #completeCollectorGenerations = new Map<string, string>();
  readonly #collectorCoverageByEpoch = new Map<string, {
    readonly mainRosterComplete: true; readonly hiddenMarketsComplete: boolean;
    readonly collectorGeneration: string;
  }>();
  readonly #pendingCollectorRetentions = new Map<string, PendingCollectorRetention>();
  readonly #parts = new Map<string, NormalizedCatalogPart>();
  readonly #partObservedAtMs = new Map<string, number>();
  readonly #readyPartitions = new Set<string>();
  readonly #domCandidates = new Map<string, ReadonlySet<string>>();
  readonly #domReadySources = new Set<string>();
  readonly #lastWsPublishAtMs = new Map<string, number>();
  readonly #streamStates = new Map<string, SabaStreamState>();
  readonly #authoritativeGenerations = new Map<string, string>();
  readonly #authoritativeBaselineAtMs = new Map<string, number>();
  readonly #baselineStarvedSinceMs = new Map<string, number>();
  readonly #faultHeldSinceMs = new Map<string, number>();

  collectorCoverage(sourceId: string, epoch: string): {
    readonly mainRosterComplete: true; readonly hiddenMarketsComplete: boolean;
    readonly collectorGeneration: string;
  } | null {
    const key = `${sourceId}|${epoch}`;
    return this.#parts.has(`${key}|COLLECTOR`) ? this.#collectorCoverageByEpoch.get(key) ?? null : null;
  }

  seedSchemaContext(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "SABA" || envelope.transport !== "TAB_STATE" ||
      envelope.payload.encoding !== "UTF8" || envelope.request.resourceType !== "Diagnostic" ||
      envelope.request.pathnameClass !== SABA_SCHEMA_CONTEXT_PATH || envelope.request.replayed === true ||
      typeof envelope.sourceEpoch !== "string" ||
      new TextEncoder().encode(envelope.payload.body).byteLength > SABA_SCHEMA_CONTEXT_MAX_BYTES) return false;
    const streamId = envelope.request.streamId;
    if (streamId === undefined) return false;
    const streamOrdinal = sabaStreamOrdinal(streamId);
    if (streamOrdinal === null) return false;
    const epochKey = sourceEpochKey(envelope);
    const stream = this.#streamStates.get(epochKey);
    if (stream?.activeStreamId !== streamId || stream.activeStreamOrdinal !== streamOrdinal) return false;

    let raw: unknown;
    try { raw = JSON.parse(envelope.payload.body); }
    catch { return false; }
    if (!isPlainRecord(raw) || Object.keys(raw).sort().join(",") !== "bridgeId,kind,revision,rows" ||
      raw.kind !== "SABA_SCHEMA_CONTEXT" || raw.revision !== null ||
      typeof raw.bridgeId !== "string" || !Array.isArray(raw.rows)) return false;

    const decoderKey = `${epochKey}|${streamId}`;
    const existing = this.#decoders.get(decoderKey);
    const decoder = existing ?? new SabaPushDecoder();
    try {
      decoder.seedSchemaContext({ bridgeId: raw.bridgeId, rows: raw.rows, revision: null });
    } catch {
      return false;
    }
    if (existing === undefined) this.#decoders.set(decoderKey, decoder);
    return true;
  }

  seedPendingCollectorRetentionFrom(previous: SabaWsCatalogAdapter, sourceId: string,
    previousEpoch: string, targetEpoch: string, atMs: number): boolean {
    if (previous === this || sourceId.length === 0 || sourceId.includes("|") ||
      !Number.isSafeInteger(atMs) || atMs < 0) return false;
    const previousIdentity = canonicalSabaSourceEpoch(previousEpoch);
    const targetIdentity = canonicalSabaSourceEpoch(targetEpoch);
    if (previousIdentity === null || targetIdentity === null ||
      previousIdentity.lineage !== targetIdentity.lineage ||
      targetIdentity.generation < previousIdentity.generation) return false;
    const previousEpochKey = sourceId + "|" + previousEpoch;
    const targetEpochKey = sourceId + "|" + targetEpoch;
    const previousPartKey = previousEpochKey + "|COLLECTOR";
    const targetPartKey = targetEpochKey + "|COLLECTOR";
    const part = previous.#parts.get(previousPartKey);
    const prematchIds = previous.#collectorPrematchIds.get(previousEpochKey);
    const originalObservedAtMs = previous.#partObservedAtMs.get(previousPartKey);
    if (part === undefined || prematchIds === undefined || originalObservedAtMs === undefined ||
      !Number.isSafeInteger(originalObservedAtMs) || originalObservedAtMs < 0 ||
      atMs < originalObservedAtMs || atMs - originalObservedAtMs > MAX_RETAINED_PART_AGE_MS ||
      this.#parts.has(targetPartKey) || this.#collectorPrematchIds.has(targetEpochKey) ||
      this.#pendingCollectorRetentions.has(targetEpochKey) ||
      this.#collectorEpochs.get(sourceId) === targetEpoch) return false;
    this.#pendingCollectorRetentions.set(targetEpochKey, {
      sourceId, targetEpoch, part, prematchIds: new Set(prematchIds), originalObservedAtMs
    });
    return true;
  }

  resetSource(sourceId: string): void {
    for (const key of this.#decoders.keys()) if (key.startsWith(`${sourceId}|`)) this.#decoders.delete(key);
    this.#assembler.resetSource(sourceId);
    this.#collectorAssembler.resetSource(sourceId);
    this.#collectorEpochs.delete(sourceId);
    for (const key of this.#collectorBindings.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#collectorBindings.delete(key);
    }
    for (const key of this.#collectorPrematchIds.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#collectorPrematchIds.delete(key);
    }
    for (const key of this.#completeCollectorGenerations.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#completeCollectorGenerations.delete(key);
    }
    for (const key of this.#collectorCoverageByEpoch.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#collectorCoverageByEpoch.delete(key);
    }
    for (const key of this.#parts.keys()) if (key.startsWith(`${sourceId}|`)) this.#parts.delete(key);
    for (const key of this.#partObservedAtMs.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#partObservedAtMs.delete(key);
    }
    for (const key of this.#readyPartitions) if (key.startsWith(`${sourceId}|`)) this.#readyPartitions.delete(key);
    for (const key of this.#pendingCollectorRetentions.keys()) {
      if (key.startsWith(sourceId + "|")) this.#pendingCollectorRetentions.delete(key);
    }
    this.#domCandidates.delete(sourceId);
    this.#domReadySources.delete(sourceId);
    for (const key of this.#lastWsPublishAtMs.keys()) if (key.startsWith(`${sourceId}|`)) {
      this.#lastWsPublishAtMs.delete(key);
    }
    for (const key of this.#streamStates.keys()) if (key.startsWith(`${sourceId}|`)) this.#streamStates.delete(key);
    for (const key of this.#authoritativeGenerations.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#authoritativeGenerations.delete(key);
    }
    for (const key of this.#authoritativeBaselineAtMs.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#authoritativeBaselineAtMs.delete(key);
    }
    for (const key of this.#baselineStarvedSinceMs.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#baselineStarvedSinceMs.delete(key);
    }
    for (const key of this.#faultHeldSinceMs.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#faultHeldSinceMs.delete(key);
    }
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "SABA" || envelope.payload.encoding !== "UTF8") return false;
    if (envelope.transport === "DOM_SNAPSHOT" && envelope.request.resourceType === "DOM" &&
      envelope.request.pathnameClass === "/__fieldline_dom_snapshot__") return true;
    if ((envelope.transport !== "WS_FRAME" && envelope.transport !== "WS_STATE") ||
      envelope.request.pathnameClass !== "/socket.io/") return false;
    const streamId = envelope.request.streamId;
    if (streamId === undefined || sabaStreamOrdinal(streamId) === null) return false;
    if (envelope.transport === "WS_STATE") return websocketLifecycleState(envelope) !== null;
    // Parsing large Socket.IO frames here and again in decode doubled the hot
    // path cost. The route and lobby already identify SABA; decode performs
    // the strict provider-frame validation once.
    return isSabaEngineIoHeartbeat(envelope.payload.body) || /^42\["m",/u.test(envelope.payload.body);
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return this.#ignore("fingerprint-refused");
    // Replayed provider evidence is display/bootstrap material only. It must
    // not allocate decoders, advance lifecycle high-water marks, or retire the
    // active stream even when this adapter is called outside the data plane.
    if (envelope.request.replayed === true) return this.#ignore("replayed-evidence");
    if (envelope.transport === "DOM_SNAPSHOT") {
      const collectorChunk = collectorDomChunk(envelope.payload.body);
      if (collectorChunk.dedicated) {
        if (collectorChunk.raw === null) return this.#ignore("collector-malformed-json");
        const epoch = sourceEpoch(envelope);
        const pinnedEpoch = this.#collectorEpochs.get(envelope.sourceId);
        if (pinnedEpoch === undefined) {
          if (!this.#collectorAssembler.activateSourceEpoch(envelope.sourceId, epoch)) {
            return this.#ignore("collector-invalid-binding");
          }
          this.#collectorEpochs.set(envelope.sourceId, epoch);
        } else if (pinnedEpoch !== epoch) {
          return this.#ignore("collector-stale-epoch");
        }
        const candidate = this.#collectorAssembler.ingest({ sourceId: envelope.sourceId,
          sourceEpoch: epoch, rawChunk: collectorChunk.raw,
          receivedMonotonicMs: envelope.receivedMonotonicMs,
          generationObservedAtMs: envelope.observedAtMs });
        if (candidate === null) return this.#ignore("collector-incomplete-or-invalid");
        if (candidate.captures.some(({ record }) => record.providerTimezoneOffsetMinutes === null)) {
          return this.#ignore("collector-timezone-unproven");
        }
        const normalized = normalizeCollectorCandidate(candidate);
        if (normalized === null) return this.#ignore("collector-market-id-collision");
        if (candidate.coverage !== "SCHEDULED_OWNERS" && incompleteNormalizedCatalog(normalized, true)) {
          return this.#ignore("incomplete-normalized-catalog");
        }
        const epochKey = sourceEpochKey(envelope);
        if (candidate.coverage === "SCHEDULED_OWNERS") {
          const binding = this.#collectorBindings.get(epochKey);
          const mainPart = this.#parts.get(`${epochKey}|COLLECTOR`);
          if (binding === undefined || mainPart === undefined ||
            binding.generation !== candidate.terminal.mainRosterGeneration ||
            binding.frame !== candidate.sweepFrameKey || binding.document !== candidate.sweepDocumentKey ||
            candidate.captures.some(capture => {
              const key = `${capture.period}\u0000${capture.ownerMatchId}`;
              const original = binding.rosters.get(key);
              return original === undefined || capture.record.providerTimezoneOffsetMinutes === undefined ||
                capture.record.providerTimezoneOffsetMinutes !== original.record.providerTimezoneOffsetMinutes ||
                JSON.stringify(capture.record.teamNames) !== JSON.stringify(original.record.teamNames) ||
                capture.record.leagueId !== original.record.leagueId ||
                (capture.captureKind === "ROSTER" && collectorRosterFingerprint(original) !== collectorRosterFingerprint(capture));
            })) return this.#ignore("collector-scheduled-binding-unproven");
          const actualCaptures = candidate.captures.filter(capture => capture.captureKind !== "ROSTER");
          if (actualCaptures.length === 0) return this.#ignore("collector-scheduled-no-new-capture");
          if (actualCaptures.some(capture => capture.capturedMonotonicMs <=
            (binding.lastScheduledClock.get(`${capture.period}\u0000${capture.ownerMatchId}`) ?? -1))) {
            return this.#ignore("collector-scheduled-stale-capture");
          }
          const prior = this.#parts.get(`${epochKey}|SCHEDULED`);
          const combined = prior === undefined ? normalized : mergeScheduledCollectorParts(prior, normalized);
          const captureRecords = canonicalizeSabaDomMarketIds(actualCaptures.map(capture => capture.record));
          if (captureRecords === null) return this.#ignore("collector-market-id-collision");
          const capturedMarketClocks = new Map<string, { monotonic: number; wall: number }>();
          actualCaptures.forEach((capture, index) => {
            for (const group of captureRecords[index]!.groups) for (const odd of group.odds) {
              capturedMarketClocks.set(`${capture.ownerMatchId}\u0000${odd.marketOddsId}`,
                { monotonic: capture.capturedMonotonicMs, wall: capture.capturedAtMs });
            }
          });
          const updates = this.#update(envelope, "SCHEDULED", combined, { evidenceMode: "DELTA",
            generation: candidate.terminal.mainRosterGeneration, provenance: "DOM_FALLBACK" }, false, capturedMarketClocks);
          if (updates.length > 0) for (const capture of actualCaptures) {
            binding.lastScheduledClock.set(`${capture.period}\u0000${capture.ownerMatchId}`, capture.capturedMonotonicMs);
          }
          return updates;
        }
        this.#pendingCollectorRetentions.delete(epochKey);
        const knownPrematchIds = new Set(normalized.events.map(({ providerEventId }) => providerEventId));
        this.#collectorPrematchIds.set(epochKey, knownPrematchIds);
        const domKey = `${epochKey}|DOM`;
        const domPart = this.#parts.get(domKey);
        if (domPart !== undefined) {
          const retained = filterCatalogPart(domPart, (event) =>
            liveIdentityScore(event) > 0 || knownPrematchIds.has(event.providerEventId));
          if (retained.events.length === 0 && (retained.nativeMarketObservations?.length ?? 0) === 0) {
            this.#parts.delete(domKey);
            this.#partObservedAtMs.delete(domKey);
          } else {
            this.#parts.set(domKey, retained);
          }
        }
        const scheduledKey = `${epochKey}|SCHEDULED`;
        const scheduled = this.#parts.get(scheduledKey);
        if (candidate.coverage === "HIDDEN_COMPLETE") {
          this.#parts.delete(scheduledKey);
          this.#partObservedAtMs.delete(scheduledKey);
        } else if (scheduled !== undefined) this.#parts.set(scheduledKey,
          filterCatalogPart(scheduled, event => knownPrematchIds.has(event.providerEventId)));
        const establishesCollectorAuthority = this.#requireSocketBaseline ||
          this.#domReadySources.has(envelope.sourceId);
        const updates = this.#update(envelope, "COLLECTOR", normalized, establishesCollectorAuthority
          ? { authoritativeBaseline: true, evidenceMode: "BASELINE",
              generation: candidate.collectorGeneration, provenance: "DOM_FALLBACK" }
          : { evidenceMode: "DELTA", generation: candidate.collectorGeneration,
               provenance: "DOM_FALLBACK" }, true);
        if (updates.length > 0) {
          this.#collectorCoverageByEpoch.set(epochKey, {
            mainRosterComplete: true, hiddenMarketsComplete: candidate.hiddenMarketsComplete,
            collectorGeneration: candidate.collectorGeneration
          });
          this.#collectorBindings.set(epochKey, { generation: candidate.collectorGeneration,
            frame: candidate.sweepFrameKey, document: candidate.sweepDocumentKey,
            lastScheduledClock: new Map([...(this.#collectorBindings.get(epochKey)?.lastScheduledClock ?? [])]
              .filter(([key]) => candidate.captures.some(capture => key === `${capture.period}\u0000${capture.ownerMatchId}`))),
            rosters: new Map(candidate.captures.filter(capture => capture.captureKind === "ROSTER")
              .map(capture => [`${capture.period}\u0000${capture.ownerMatchId}`, capture])) });
        }
        return updates;
      }
      // The DOM is only the visible viewport, never an authoritative baseline.
      // Publishing it before reset/done makes a healthy reconnect look LIVE
      // with only a handful of events and overwrites the complete catalog.
      const socketReady = [...this.#readyPartitions].some((key) => key.startsWith(`${envelope.sourceId}|`));
      const collectorReady = this.#completeCollectorGenerations.has(sourceEpochKey(envelope));
      if (this.#requireSocketBaseline && !this.#allowValidatedDomFallback && !socketReady && !collectorReady) {
        return this.#ignore("dom-awaiting-socket-baseline");
      }
      // Keep accepting the current visible DOM after the socket bootstrap. A
      // quiet SABA socket may not publish another catalog frame for minutes;
      // dropping these snapshots made an otherwise healthy catalog expire.
      // The DOM remains a separate partition, so hidden socket-only markets
      // stay in the union while overlapping visible prices are refreshed.
      let domRefusal = "dom-undecodable";
      const records = decodePublicDomRecords(this.#assembler, envelope,
        (reason) => { domRefusal = `dom-${reason}`; }, { allowEmptyTimeText: true });
      if (records === null) return this.#ignore(domRefusal);
      if (this.#requireSocketBaseline && !socketReady && !collectorReady && records.some((record) =>
        typeof record.providerTimezoneOffsetMinutes !== "number" ||
        !Number.isInteger(record.providerTimezoneOffsetMinutes) || Math.abs(record.providerTimezoneOffsetMinutes) > 840)) {
        return this.#ignore("dom-fallback-timezone-unconfirmed");
      }
      const canonicalRecords = canonicalizeSabaDomMarketIds(records);
      if (canonicalRecords === null) return this.#ignore("dom-market-id-collision");
      const usable = canonicalRecords.filter((record) =>
        record.timeText.trim() !== "" && record.groups.length > 0);
      const normalized = normalizeObservedFootballCatalog("SABA", canonicalRecords, {
        observedAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
        timezoneOffsetMinutes: 480, sequence: envelope.sequence
      });
      const normalizedDomComplete = !incompleteNormalizedCatalog(normalized, false);
      if (this.#requireSocketBaseline && !socketReady && !collectorReady && !normalizedDomComplete) {
        return this.#ignore("dom-fallback-incomplete");
      }
      let establishesDomAuthority = false;
      if (usable.length >= MIN_STABLE_DOM_EVENTS) {
        // Some SABA deployments expose the complete current event table in the
        // page but do not recreate their Socket.IO transport after a service
        // worker restart. One large atomic generation can establish fallback
        // authority; a smaller complete-looking table still needs a second
        // stable generation. Later generations must retain nearly identical
        // coverage, so a scrolling viewport cannot erase the last good catalog.
        // SABA has run on the DOM since its socket decoder stopped covering the
        // feed, so these three gates are its whole catalog, and every one of
        // them was silent: 44 snapshots were dropped with only the endpoint to
        // show for it. The counts say which gate to move and by how much.
        const identities = new Set(usable.map((record) => record.matchId));
        const previous = this.#domCandidates.get(envelope.sourceId);
        if (!this.#domReadySources.has(envelope.sourceId)) {
          this.#domCandidates.set(envelope.sourceId, identities);
          if (previous === undefined && (this.#requireSocketBaseline || usable.length < SINGLE_GENERATION_DOM_EVENTS)) {
            if (!socketReady && !collectorReady) {
              return this.#ignore(`dom-first-generation-${usable.length}-under-${SINGLE_GENERATION_DOM_EVENTS}`);
            }
          }
          if (previous !== undefined && !stableDomCoverage(previous, identities)) {
            return this.#ignore(`dom-coverage-moved-${previous.size}-to-${identities.size}`);
          }
          if (previous !== undefined || usable.length >= SINGLE_GENERATION_DOM_EVENTS) {
            this.#domReadySources.add(envelope.sourceId);
            establishesDomAuthority = true;
          }
        } else if (previous !== undefined && !stableDomCoverage(previous, identities)) {
          // One changed viewport is not enough to delete the prior full list,
          // but keeping the old comparison point forever also rejects a real
          // fixture roll-off forever. Remember the changed generation; a
          // second stable capture of that same list proves the replacement.
          this.#domCandidates.set(envelope.sourceId, identities);
          return this.#ignore(`dom-ready-coverage-moved-${previous.size}-to-${identities.size}`);
        } else {
          establishesDomAuthority = true;
        }
        this.#domCandidates.set(envelope.sourceId, identities);
      } else if (!socketReady && !collectorReady) {
        return this.#ignore(`dom-${usable.length}-events-under-${MIN_STABLE_DOM_EVENTS}`);
      }
      if (establishesDomAuthority && normalizedDomComplete) {
        this.#activatePendingCollectorRetention(envelope, normalized);
      }
      const nativeMarketObservations = observeNativeCmdMarkets("SABA", canonicalRecords, {
        observedAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
        timezoneOffsetMinutes: 480, sequence: envelope.sequence
      });
      const epochKey = sourceEpochKey(envelope);
      const collectorPrematchIds = this.#collectorPrematchIds.get(epochKey);
      const collectorPart = this.#parts.get(epochKey + "|COLLECTOR");
      // Repeated visible rows prove those prices, not that hidden socket rows
      // disappeared. Only a completed dedicated collector can qualify the
      // legacy fallback; production DOM never replaces socket authority.
      if (this.#requireSocketBaseline && (!this.#allowValidatedDomFallback || socketReady || collectorReady) || socketReady &&
        (collectorPrematchIds === undefined || collectorPart === undefined)) establishesDomAuthority = false;
      const withCleanSheets = canonicalRecords.reduce<NormalizedCatalogPart>((catalog, record) =>
        augmentSabaDomCleanSheet(catalog, record, {
          observedAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
          sequence: envelope.sequence
        }), { ...normalized, nativeMarketObservations });
      const normalizedWithNativeInventory = collectorPrematchIds === undefined
        ? withCleanSheets
        : filterCatalogPart(withCleanSheets, (event) =>
          liveIdentityScore(event) > 0 || collectorPrematchIds.has(event.providerEventId));
      const socketGeneration = this.#authoritativeGenerations.get(sourceEpochKey(envelope));
      if (establishesDomAuthority) {
        // A qualified DOM generation is a complete replacement proof. Keeping
        // an earlier, small socket partition in the adapter union resurrects
        // fixtures that the current page has already removed and makes a
        // recovered candidate look larger than the source really is.
        const epochPrefix = `${sourceEpochKey(envelope)}|`;
        for (const key of this.#parts.keys()) {
          if (!key.startsWith(epochPrefix) || collectorPrematchIds !== undefined &&
            (key.includes("|COLLECTOR") || key.includes("|WS:"))) continue;
          this.#parts.delete(key);
          this.#partObservedAtMs.delete(key);
        }
      }
      return this.#update(envelope, "DOM", normalizedWithNativeInventory, establishesDomAuthority
        ? { authoritativeBaseline: true, evidenceMode: "BASELINE",
            generation: `${sourceEpoch(envelope)}:dom:${envelope.sequence}`, provenance: "DOM_FALLBACK" }
        : { evidenceMode: "DELTA", generation: socketGeneration ?? `${sourceEpoch(envelope)}:dom:${envelope.sequence}`,
            provenance: "DOM_FALLBACK" }, establishesDomAuthority && normalizedDomComplete &&
          collectorPrematchIds !== undefined &&
          collectorPrematchIds.size > 0 && collectorPart !== undefined &&
          !incompleteNormalizedCatalog(collectorPart, false));
    }
    const streamId = envelope.request.streamId!;
    const streamOrdinal = sabaStreamOrdinal(streamId)!;
    const epochKey = sourceEpochKey(envelope);
    const decoderKey = `${epochKey}|${streamId}`;
    if (envelope.transport === "WS_FRAME" && isSabaEngineIoHeartbeat(envelope.payload.body)) {
      const current = this.#streamStates.get(epochKey);
      const wsBaselineAtMs = this.#authoritativeBaselineAtMs.get(epochKey);
      const domBaselineAtMs = this.#domReadySources.has(envelope.sourceId)
        ? this.#partObservedAtMs.get(`${epochKey}|DOM`) : undefined;
      const baselineAtMs = wsBaselineAtMs === undefined ? domBaselineAtMs : domBaselineAtMs === undefined
        ? wsBaselineAtMs : Math.max(wsBaselineAtMs, domBaselineAtMs);
      const baselineAgeMs = baselineAtMs === undefined ? Number.POSITIVE_INFINITY
        : envelope.observedAtMs - baselineAtMs;
      if (current?.activeStreamId !== streamId || current.activeStreamOrdinal !== streamOrdinal ||
        current.authorizing !== true ||
        (!this.#authoritativeGenerations.has(epochKey) && domBaselineAtMs === undefined) ||
        baselineAgeMs < 0 || baselineAgeMs > MAX_RETAINED_PART_AGE_MS) return this.#ignore("retained-part-too-old");
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, transportAlive: true }];
    }
    if (envelope.transport === "WS_STATE") {
      const state = websocketLifecycleState(envelope);
      if (state === null) return this.#ignore("not-a-lifecycle-frame");
      if (state === "OPEN") {
        const current = this.#streamStates.get(epochKey);
        if (current?.activeStreamId === streamId && current.activeStreamOrdinal === streamOrdinal) {
          if (current.authorizing) return this.#ignore("stream-authorizing");
          this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
          current.authorizing = true;
          this.#authoritativeGenerations.delete(epochKey);
          this.#authoritativeBaselineAtMs.delete(epochKey);
          return this.#ignore("stream-dropped");
        }
        if (current !== undefined && streamOrdinal <= current.highWatermark) return this.#ignore("stale-stream-ordinal");
        const retiresAuthoritativeStream = current?.activeStreamId !== null && current?.activeStreamId !== undefined &&
          this.#authoritativeGenerations.has(epochKey);
        this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
        if (current?.activeStreamId !== null && current?.activeStreamId !== undefined) {
          this.#dropStream(envelope.sourceId, sourceEpoch(envelope), current.activeStreamId);
        }
        this.#streamStates.set(epochKey, { activeStreamId: streamId,
          activeStreamOrdinal: streamOrdinal, highWatermark: streamOrdinal, authorizing: true });
        this.#authoritativeGenerations.delete(epochKey);
        this.#authoritativeBaselineAtMs.delete(epochKey);
        return retiresAuthoritativeStream
          ? [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
              invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_GAP" }]
          : [];
      }
      const current = this.#streamStates.get(epochKey);
      if (current?.activeStreamId !== streamId || current.activeStreamOrdinal !== streamOrdinal) return this.#ignore("stream-superseded");
      this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
      current.activeStreamId = null;
      current.activeStreamOrdinal = null;
      current.authorizing = false;
      this.#authoritativeGenerations.delete(epochKey);
      this.#authoritativeBaselineAtMs.delete(epochKey);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_CLOSED" }];
    }
    let stream = this.#streamStates.get(epochKey);
    if (stream === undefined) {
      // Characterized adapter fixtures may begin at the first provider frame;
      // the real producer emits OPEN first. Only the first canonical ordinal
      // may seed this bounded state. Once a lifecycle exists, frames cannot
      // advance it implicitly.
      stream = { activeStreamId: streamId, activeStreamOrdinal: streamOrdinal,
        highWatermark: streamOrdinal, authorizing: false };
      this.#streamStates.set(epochKey, stream);
    } else if (stream.activeStreamId === null && stream.activeStreamOrdinal === null &&
      streamOrdinal >= stream.highWatermark) {
      let recoveryFrame: ReturnType<typeof parseSabaSocketFrame>;
      try {
        recoveryFrame = parseSabaSocketFrame(envelope.payload.body);
      } catch {
        return this.#ignore("recovery-frame-unparsable");
      }
      const recoveryStartsBaseline = recoveryFrame !== null &&
        (recoveryFrame.rows as readonly unknown[]).some((row) => Array.isArray(row) &&
          (row[1] === "reset" || row[1] === "empty"));
      if (!recoveryStartsBaseline) {
        // Measured 2026-08-31: after the socket lane is dropped, the provider
        // keeps streaming deltas but only sends reset/empty on a fresh
        // connection, so these frames are refused forever while DOM snapshots
        // keep the feed nominally LIVE - the catalog froze for minutes while
        // the strip claimed a healthy source. Refusals that persist are a
        // fault, not quiet: declare the stream gap so the controller runs
        // recovery, which reconnects the socket and yields the reset frame
        // this branch is waiting for.
        const starvedSinceMs = this.#baselineStarvedSinceMs.get(epochKey);
        if (starvedSinceMs === undefined) {
          this.#baselineStarvedSinceMs.set(epochKey, envelope.observedAtMs);
          return this.#ignore("recovery-without-baseline");
        }
        if (envelope.observedAtMs - starvedSinceMs < BASELINE_STARVATION_MS) {
          return this.#ignore("recovery-without-baseline");
        }
        // Re-arm so a recovery that does not land keeps asking, bounded by the
        // same window rather than one gap per frame.
        this.#baselineStarvedSinceMs.set(epochKey, envelope.observedAtMs);
        this.#authoritativeGenerations.delete(epochKey);
        this.#authoritativeBaselineAtMs.delete(epochKey);
        return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
          observedAtMs: envelope.observedAtMs, invalidateAccountId: ACCOUNT_ID,
          reason: "PROVIDER_STREAM_GAP" }];
      }
      this.#baselineStarvedSinceMs.delete(epochKey);
      stream.activeStreamId = streamId;
      stream.activeStreamOrdinal = streamOrdinal;
      stream.highWatermark = streamOrdinal;
      stream.authorizing = false;
    }
    if (stream.activeStreamId !== streamId || stream.activeStreamOrdinal !== streamOrdinal) {
      return this.#ignore("stream-not-active");
    }
    let startsBaseline = false;
    let faultingReadyKey: string | null = null;
    const hadAuthorityBeforeFrame = this.#authoritativeGenerations.has(epochKey) ||
      this.#authoritativeBaselineAtMs.has(epochKey);
    try {
      const frame = parseSabaSocketFrame(envelope.payload.body);
      if (frame === null) return this.#ignore("unparsed-frame");
      faultingReadyKey = `${decoderKey}|${frame.bridgeId}`;
      if (JSON.stringify(frame.rows).includes('"A003"')) {
        this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
        stream.activeStreamId = null;
        stream.activeStreamOrdinal = null;
        stream.authorizing = false;
        this.#authoritativeGenerations.delete(epochKey);
        this.#authoritativeBaselineAtMs.delete(epochKey);
        return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
          invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_GAP" }];
      }
      let decoder = this.#decoders.get(decoderKey);
      if (decoder === undefined) {
        decoder = new SabaPushDecoder();
        this.#decoders.set(decoderKey, decoder);
      }
      startsBaseline = (frame.rows as readonly unknown[]).some((row) => Array.isArray(row) &&
        (row[1] === "reset" || row[1] === "empty"));
      const priorGeneration = startsBaseline ? this.#authoritativeGenerations.get(epochKey) : undefined;
      const priorBaselineAtMs = startsBaseline ? this.#authoritativeBaselineAtMs.get(epochKey) : undefined;
      const restorePriorAuthority = (): void => {
        if (priorGeneration !== undefined) this.#authoritativeGenerations.set(epochKey, priorGeneration);
        if (priorBaselineAtMs !== undefined) this.#authoritativeBaselineAtMs.set(epochKey, priorBaselineAtMs);
      };
      if (startsBaseline) {
        this.#authoritativeGenerations.delete(epochKey);
        this.#authoritativeBaselineAtMs.delete(epochKey);
      }
      const applied = decoder.apply(frame);
      if (applied.duplicate) {
        restorePriorAuthority();
        return this.#ignore("duplicate");
      }
      if (startsBaseline && !applied.fullSnapshot) {
        restorePriorAuthority();
        return this.#ignore("baseline-not-full");
      }
      if (applied.records.length === 0 && !applied.fullSnapshot) {
        return this.#ignore("no-records");
      }
      const normalized = normalizeSabaFootballRecords(applied.records, {
        observedAtMs: envelope.observedAtMs,
        receivedMonotonicMs: envelope.receivedMonotonicMs,
        sequence: envelope.sequence
      });
      const partition = `WS:${streamId}:${frame.bridgeId}`;
      const previousPart = this.#parts.get(`${epochKey}|${partition}`);
      if (previousPart !== undefined && sameSabaCatalogPart(previousPart, normalized)) {
        restorePriorAuthority();
        return this.#ignore("same-part");
      }
      if (!startsBaseline) {
        const baselineAtMs = this.#authoritativeBaselineAtMs.get(epochKey);
        if (baselineAtMs !== undefined && envelope.observedAtMs - baselineAtMs > MAX_RETAINED_PART_AGE_MS) {
          this.#authoritativeGenerations.delete(epochKey);
          this.#authoritativeBaselineAtMs.delete(epochKey);
          for (const key of this.#readyPartitions) {
            if (key.startsWith(`${epochKey}|`)) this.#readyPartitions.delete(key);
          }
        }
      }
      const readyKey = `${decoderKey}|${frame.bridgeId}`;
      if (applied.fullSnapshot) this.#readyPartitions.add(readyKey);
      if (!this.#readyPartitions.has(readyKey)) return this.#ignore("partition-not-ready");
      // Price deltas must be published immediately: a time-only throttle can
      // swallow the final odds change in a burst forever when no later frame
      // arrives. Only coalesce rapid metadata-only changes; the next metadata
      // or price frame materializes the decoder's complete current state.
      const publishKey = `${decoderKey}|${frame.bridgeId}`;
      const lastPublishedAtMs = this.#lastWsPublishAtMs.get(publishKey) ?? Number.NEGATIVE_INFINITY;
      const changesPrice = applied.changes.some((change) => change.record?.type === "o" ||
        change.record?.type === "do" || change.record?.type === "-o");
      if (!applied.fullSnapshot && !changesPrice && envelope.observedAtMs - lastPublishedAtMs < 500) return this.#ignore("no-price-change");
      this.#lastWsPublishAtMs.set(publishKey, envelope.observedAtMs);
      const currentStream = this.#streamStates.get(epochKey);
      if (applied.fullSnapshot && currentStream?.activeStreamId === streamId &&
        currentStream.activeStreamOrdinal === streamOrdinal) {
        currentStream.authorizing = true;
        this.#authoritativeGenerations.set(epochKey,
          `${sourceEpoch(envelope)}:saba:${streamId}:${envelope.sequence}`);
        this.#authoritativeBaselineAtMs.set(epochKey, envelope.observedAtMs);
      }
      const generation = this.#authoritativeGenerations.get(epochKey);
      const authoritative = applied.fullSnapshot && generation !== undefined &&
        this.#streamStates.get(epochKey)?.activeStreamId === streamId &&
        this.#streamStates.get(epochKey)?.authorizing === true;
      if (authoritative && applied.records.length === 0 && !this.#requireSocketBaseline) {
        // empty/done is a complete provider replacement, not an empty bridge
        // shard. Remove every retained epoch partition before publishing it.
        for (const key of this.#parts.keys()) {
          if (key.startsWith(`${epochKey}|`)) {
            this.#parts.delete(key);
            this.#partObservedAtMs.delete(key);
          }
        }
        for (const key of this.#readyPartitions) {
          if (key.startsWith(`${decoderKey}|`) && key !== readyKey) this.#readyPartitions.delete(key);
        }
        for (const key of this.#lastWsPublishAtMs.keys()) {
          if (key.startsWith(`${decoderKey}|`) && key !== publishKey) this.#lastWsPublishAtMs.delete(key);
        }
      }
      this.#faultHeldSinceMs.delete(epochKey);
      return this.#update(envelope, partition, normalized,
        authoritative ? { authoritativeBaseline: true, evidenceMode: "BASELINE", generation, provenance: "WS" }
          : generation !== undefined && this.#streamStates.get(epochKey)?.activeStreamId === streamId &&
              this.#streamStates.get(epochKey)?.authorizing === true
            ? { evidenceMode: "DELTA", generation, provenance: "WS" } : {},
        authoritative && applied.records.length === 0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "";
      const faultLabel = sabaDecodeFaultLabel(errorMessage);
      const sequenceGap = errorMessage.includes("SABA_PUSH_SCHEMA_CHANGED:SEQUENCE_GAP");
      const schemaFault = errorMessage.startsWith("SABA_PUSH_SCHEMA_CHANGED") ||
        errorMessage === "SABA_PUSH_FRAME_INVALID";
      const faultingPartitionWasReady = faultingReadyKey !== null && this.#readyPartitions.has(faultingReadyKey);
      // A newly announced, non-authoritative stream may deliver reset/data
      // against the page's existing field table without repeating `f`. Keep
      // that exact bootstrap failure in the already-bounded fault hold so a
      // separately verified schema context can seed it. Every other malformed
      // baseline still retires immediately, and the hold below retires this
      // stream too if no context arrives before FAULT_HOLD_MS.
      const awaitingSchemaContext = startsBaseline && !hadAuthorityBeforeFrame &&
        !faultingPartitionWasReady &&
        errorMessage.startsWith("SABA_PUSH_SCHEMA_CHANGED:FIELD_INDEX_UNMAPPED:");
      if (!awaitingSchemaContext && (startsBaseline || faultingReadyKey === null ||
        (sequenceGap || schemaFault) && faultingPartitionWasReady)) {
        const requireStrictlyNewerOpen = stream.authorizing || this.#authoritativeGenerations.has(epochKey);
        this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
        if (requireStrictlyNewerOpen) {
          stream.activeStreamId = null;
          stream.activeStreamOrdinal = null;
          stream.authorizing = false;
        } else {
          // On MV3/API handover a frame can arrive before CDP replays OPEN. A
          // schema-less orphan has never owned authority, so discarding its
          // provisional state must still allow that same observed OPEN to seed
          // the new epoch. Once OPEN or a baseline owned the stream, faults stay
          // latched behind the strictly-higher stream watermark.
          this.#streamStates.delete(epochKey);
        }
        this.#authoritativeGenerations.delete(epochKey);
        this.#authoritativeBaselineAtMs.delete(epochKey);
        return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
          invalidateAccountId: ACCOUNT_ID, reason: sequenceGap ? "PROVIDER_STREAM_GAP" : "SCHEMA_CHANGED" }];
      }
      // Measured 2026-08-31: this hold latched on a partition that had never
      // been ready, so every later frame threw the same fault and was refused
      // in silence - 438 of them while the catalog aged past 110s and the feed
      // still read LIVE on DOM evidence. A hold that outlives the realtime
      // contract is a fault, not a wait: name it so recovery reconnects the
      // socket, exactly as a ready partition's fault already does.
      const heldSinceMs = this.#faultHeldSinceMs.get(epochKey);
      if (heldSinceMs === undefined) {
        this.#faultHeldSinceMs.set(epochKey, envelope.observedAtMs);
        return this.#ignore(`decode-fault-held-${faultLabel}`);
      }
      if (envelope.observedAtMs - heldSinceMs < FAULT_HOLD_MS) {
        return this.#ignore(`decode-fault-held-${faultLabel}`);
      }
      // Re-arm rather than reporting one gap per frame, so a recovery that does
      // not land keeps asking on the same bounded window.
      this.#faultHeldSinceMs.set(epochKey, envelope.observedAtMs);
      this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
      stream.activeStreamId = null;
      stream.activeStreamOrdinal = null;
      stream.authorizing = false;
      this.#authoritativeGenerations.delete(epochKey);
      this.#authoritativeBaselineAtMs.delete(epochKey);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, invalidateAccountId: ACCOUNT_ID,
        reason: sequenceGap ? "PROVIDER_STREAM_GAP" : "SCHEMA_CHANGED" }];
    }
  }

  #activatePendingCollectorRetention(envelope: ChromeBridgeEnvelope,
    freshDom: NormalizedCatalogPart): boolean {
    const epochKey = sourceEpochKey(envelope);
    const pending = this.#pendingCollectorRetentions.get(epochKey);
    if (pending === undefined) return false;
    this.#pendingCollectorRetentions.delete(epochKey);
    const partKey = epochKey + "|COLLECTOR";
    if (pending.sourceId !== envelope.sourceId || pending.targetEpoch !== sourceEpoch(envelope) ||
      envelope.observedAtMs < pending.originalObservedAtMs ||
      envelope.observedAtMs - pending.originalObservedAtMs > MAX_RETAINED_PART_AGE_MS ||
      this.#parts.has(partKey) || this.#collectorPrematchIds.has(epochKey)) return false;
    const freshEvents = new Map(freshDom.events.map((event) => [event.providerEventId, event]));
    for (const retained of pending.part.events) {
      const current = freshEvents.get(retained.providerEventId);
      if (current !== undefined && (current.competition !== retained.competition ||
        current.participantA !== retained.participantA ||
        current.participantB !== retained.participantB ||
        current.startAtUtcMs !== retained.startAtUtcMs)) return false;
    }
    this.#parts.set(partKey, pending.part);
    this.#partObservedAtMs.set(partKey, pending.originalObservedAtMs);
    this.#collectorPrematchIds.set(epochKey, new Set(pending.prematchIds));
    return true;
  }

  #update(envelope: ChromeBridgeEnvelope, partition: string,
    normalized: NormalizedCatalogPart,
    evidence: Pick<Extract<DecodedCatalogUpdate, { readonly value: unknown }>, "authoritativeBaseline" |
      "evidenceMode" | "generation" | "provenance"> = {},
    allowCompleteEmpty = false,
    capturedMarketClocks?: ReadonlyMap<string, { readonly monotonic: number; readonly wall: number }>): readonly DecodedCatalogUpdate[] {
    if (incompleteNormalizedCatalog(normalized, allowCompleteEmpty) &&
      !(partition === "SCHEDULED" && (normalized.nativeMarketObservations?.length ?? 0) > 0)) {
      return this.#ignore("incomplete-normalized-catalog");
    }
    // Source clocks remain in internal parts for native ordering. Each new
    // quote gets one API-local acquisition clock, shared across candidate
    // adapters by object identity; publication never renews retained quotes.
    let receiptClock: { readonly observedAtMs: number; readonly observedMonotonicMs?: number };
    try { receiptClock = this.#quoteClockMapper?.observe(normalized.quotes, envelope) ?? {
      observedAtMs: envelope.observedAtMs, observedMonotonicMs: envelope.receivedMonotonicMs }; }
    catch { return this.#ignore("quote-clock-invalid"); }
    const epochKey = sourceEpochKey(envelope);
    const partitionKey = `${epochKey}|${partition}`;
    if (capturedMarketClocks !== undefined) {
      for (const [key, part] of this.#parts) {
        if (key.startsWith(`${epochKey}|`) && key !== partitionKey) {
          this.#parts.set(key, withoutSupersededCapturedMarkets(part, capturedMarketClocks));
        }
      }
    }
    this.#parts.delete(partitionKey);
    this.#parts.set(partitionKey, normalized);
    this.#partObservedAtMs.set(partitionKey, envelope.observedAtMs);
    for (const [key, observedAtMs] of this.#partObservedAtMs) {
      if (!key.startsWith(`${epochKey}|`) || envelope.observedAtMs - observedAtMs <= MAX_RETAINED_PART_AGE_MS) continue;
      this.#partObservedAtMs.delete(key);
      this.#parts.delete(key);
      if (key.endsWith("|COLLECTOR")) {
        this.#collectorPrematchIds.delete(epochKey);
        this.#completeCollectorGenerations.delete(epochKey);
        this.#collectorCoverageByEpoch.delete(epochKey);
      }
    }
    if (this.#requireSocketBaseline) {
      if (partition === "COLLECTOR" && evidence.authoritativeBaseline === true &&
        evidence.generation !== undefined) {
        this.#completeCollectorGenerations.set(epochKey, evidence.generation);
      }
      const collectorGeneration = this.#completeCollectorGenerations.get(epochKey);
      const domBaseline = partition === "DOM" && this.#allowValidatedDomFallback &&
        evidence.authoritativeBaseline === true;
      const publicationGeneration = collectorGeneration ?? this.#authoritativeGenerations.get(epochKey) ??
        (domBaseline ? evidence.generation : undefined);
      if (publicationGeneration === undefined) return this.#ignore("awaiting-validated-baseline");
      // Native reset/done proves usable quotes independently of collector coverage.
      // If a collector exists, a same-epoch reconnect keeps its original
      // retention time and quote acquisition clocks.
      if (partition.startsWith("WS:") && evidence.authoritativeBaseline === true &&
        evidence.generation !== undefined) {
        if (collectorGeneration !== undefined) {
          this.#completeCollectorGenerations.set(epochKey, evidence.generation);
        }
      } else if (partition !== "COLLECTOR" && !domBaseline) evidence = { evidenceMode: "DELTA",
        generation: publicationGeneration,
        ...(evidence.provenance === undefined ? {} : { provenance: evidence.provenance }) };
    }
    const sourceEntries = [...this.#parts].filter(([key]) => key.startsWith(`${epochKey}|`));
    // Collector-owned dates win event identity even when a previously received
    // legacy DOM quote is newer. Quote clocks are resolved independently below.
    sourceEntries.sort(([left], [right]) => Number(!left.endsWith("|COLLECTOR")) -
      Number(!right.endsWith("|COLLECTOR")));
    const sourceParts = newestQuoteParts(sourceEntries.map(([, value]) => value));
    let publicationParts = sourceParts;
    if (this.#quoteClockMapper !== undefined) {
      try {
        publicationParts = sourceParts.map((part) => ({ ...part,
          quotes: part.quotes.map((quote) => this.#quoteClockMapper!.localize(quote)) }));
      } catch { return this.#ignore("quote-clock-mapping-missing"); }
    }
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SABA",
      observedAtMs: envelope.observedAtMs, parts: publicationParts, selectEvent: selectStableSabaEvent,
      // SABA's live section also lists fixtures that have not kicked off, and
      // only here do its two partitions meet, so only here can its own schedule
      // contradict them.
      resolveScheduledPhase: true });
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: { ...catalog, ...receiptClock }, ...evidence,
      ...(partition === "SCHEDULED" ? { completeRetainedView: true as const } : {}) }];
  }

  streamStats(): { readonly sourceEpochs: number; readonly trackedStreamIds: number } {
    let trackedStreamIds = 0;
    for (const state of this.#streamStates.values()) if (state.activeStreamId !== null) trackedStreamIds += 1;
    return { sourceEpochs: this.#streamStates.size, trackedStreamIds };
  }

  #dropStream(sourceId: string, epoch: string, streamId: string): void {
    const decoderKey = `${sourceId}|${epoch}|${streamId}`;
    this.#decoders.delete(decoderKey);
    for (const key of this.#parts.keys()) {
      if (key.startsWith(`${sourceId}|${epoch}|WS:${streamId}:`)) {
        this.#parts.delete(key);
        this.#partObservedAtMs.delete(key);
      }
    }
    for (const key of this.#readyPartitions) {
      if (key.startsWith(`${decoderKey}|`)) this.#readyPartitions.delete(key);
    }
    for (const key of this.#lastWsPublishAtMs.keys()) {
      if (key.startsWith(`${decoderKey}|`)) this.#lastWsPublishAtMs.delete(key);
    }
  }
}

function incompleteNormalizedCatalog(normalized: NormalizedCatalogPart, allowCompleteEmpty: boolean): boolean {
  const empty = normalized.events.length === 0 && normalized.markets.length === 0 && normalized.quotes.length === 0;
  return !empty && (normalized.events.length === 0 || normalized.markets.length === 0 ||
    normalized.quotes.length === 0) || empty && !allowCompleteEmpty;
}

function sabaStreamOrdinal(streamId: string): number | null {
  if (!/^[1-9]\d*$/u.test(streamId)) return null;
  const ordinal = Number(streamId);
  return Number.isSafeInteger(ordinal) ? ordinal : null;
}

function sameSabaCatalogPart(left: NormalizedCatalogPart, right: NormalizedCatalogPart): boolean {
  const semanticFingerprint = (part: NormalizedCatalogPart): string => JSON.stringify(part, (key, value) =>
    key === "receivedMonotonicMs" || key === "sequence" || key === "observedAtMs" ? undefined : value);
  return semanticFingerprint(left) === semanticFingerprint(right);
}

function collectorDomChunk(body: string): { readonly dedicated: boolean; readonly raw: unknown | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { dedicated: /"(?:snapshotId|sweepId)"\s*:\s*"saba:collector:/u.test(body), raw: null };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { dedicated: false, raw };
  const value = raw as Record<string, unknown>;
  const dedicated = [value.snapshotId, value.sweepId].some((entry) =>
    typeof entry === "string" && entry.startsWith("saba:collector:"));
  return { dedicated, raw };
}

function quoteKey(quote: NormalizedCatalogPart["quotes"][number]): string {
  return `${quote.providerEventId}\u0000${quote.providerMarketId}\u0000${quote.providerSelectionId}`;
}

function marketKey(value: { readonly providerEventId: string; readonly providerMarketId: string }): string {
  return `${value.providerEventId}\u0000${value.providerMarketId}`;
}

function newestQuoteParts(parts: readonly NormalizedCatalogPart[]): NormalizedCatalogPart[] {
  const newest = new Map<string, NormalizedCatalogPart["quotes"][number]>();
  const marketOwners = new Map<string, { readonly partIndex: number;
    readonly receivedMonotonicMs: number; readonly sequence: number }>();
  const nativeOnlyNewest = new Map<string,
    NonNullable<NormalizedCatalogPart["nativeMarketObservations"]>[number]>();
  for (const [partIndex, part] of parts.entries()) {
    for (const quote of part.quotes) {
      const key = quoteKey(quote);
      const current = newest.get(key);
      if (current === undefined || quote.receivedMonotonicMs > current.receivedMonotonicMs ||
        quote.receivedMonotonicMs === current.receivedMonotonicMs &&
        (quote.sequence ?? -1) >= (current.sequence ?? -1)) newest.set(key, quote);
      const ownerKey = marketKey(quote);
      const owner = marketOwners.get(ownerKey);
      const sequence = quote.sequence ?? -1;
      if (owner === undefined || quote.receivedMonotonicMs > owner.receivedMonotonicMs ||
        quote.receivedMonotonicMs === owner.receivedMonotonicMs && sequence >= owner.sequence) {
        marketOwners.set(ownerKey, { partIndex, receivedMonotonicMs: quote.receivedMonotonicMs, sequence });
      }
    }
    for (const observation of part.nativeMarketObservations ?? []) {
      const key = `${marketKey(observation)}\u0000${observation.nativeType}`;
      const current = nativeOnlyNewest.get(key);
      if (current === undefined || observation.observedAtMs >= current.observedAtMs) {
        nativeOnlyNewest.set(key, observation);
      }
    }
  }
  return parts.map((part, partIndex) => ({ ...part,
    markets: part.markets.filter((market) => {
      const owner = marketOwners.get(marketKey(market));
      return owner === undefined || owner.partIndex === partIndex;
    }),
    quotes: part.quotes.filter((quote) => newest.get(quoteKey(quote)) === quote),
    ...(part.nativeMarketObservations === undefined ? {} : {
      nativeMarketObservations: part.nativeMarketObservations.filter((observation) => {
        const owner = marketOwners.get(marketKey(observation));
        if (owner !== undefined) return owner.partIndex === partIndex;
        const key = `${marketKey(observation)}\u0000${observation.nativeType}`;
        return nativeOnlyNewest.get(key) === observation;
      })
    }) }));
}

function filterCatalogPart(part: NormalizedCatalogPart, keepEvent: (event: CatalogEvent) => boolean):
NormalizedCatalogPart {
  const events = part.events.filter(keepEvent);
  const ids = new Set(events.map(({ providerEventId }) => providerEventId));
  return { ...part, events,
    markets: part.markets.filter(({ providerEventId }) => ids.has(providerEventId)),
    quotes: part.quotes.filter(({ providerEventId }) => ids.has(providerEventId)),
    ...(part.nativeMarketObservations === undefined ? {} : {
      nativeMarketObservations: part.nativeMarketObservations.filter(({ providerEventId }) =>
        ids.has(providerEventId))
    }) };
}

function canonicalizeSabaDomMarketIds(records: readonly CmdCatalogInputRecord[]):
readonly CmdCatalogInputRecord[] | null {
  const rawIdsByOwnerAndCanonicalId = new Map<string, string>();
  let collided = false;
  const canonicalRecords = records.map((record) => ({ ...record,
    groups: record.groups.map((group) => ({ ...group,
      odds: group.odds.map((odd) => {
        const prefix = `${record.matchId}__`;
        const suffix = odd.marketOddsId.startsWith(prefix)
          ? odd.marketOddsId.slice(prefix.length) : "";
        const canonicalMarketOddsId = /^\d+$/u.test(suffix) ? suffix : odd.marketOddsId;
        const collisionKey = `${record.matchId}\u0000${canonicalMarketOddsId}`;
        const previousRawId = rawIdsByOwnerAndCanonicalId.get(collisionKey);
        if (previousRawId !== undefined && previousRawId !== odd.marketOddsId) collided = true;
        else rawIdsByOwnerAndCanonicalId.set(collisionKey, odd.marketOddsId);
        return canonicalMarketOddsId === odd.marketOddsId ? odd
          : { ...odd, marketOddsId: canonicalMarketOddsId };
      })
    }))
  }));
  return collided ? null : canonicalRecords;
}

function normalizeCollectorCandidate(candidate: ValidatedSabaCollectorCandidate): NormalizedCatalogPart | null {
  const events = new Map<string, NormalizedCatalogPart["events"][number]>();
  const markets = new Map<string, NormalizedCatalogPart["markets"][number]>();
  const quotes = new Map<string, NormalizedCatalogPart["quotes"][number]>();
  const native = new Map<string,
    NonNullable<NormalizedCatalogPart["nativeMarketObservations"]>[number]>();
  const diagnostics: unknown[] = [];
  const captures = candidate.captures.filter(capture => candidate.coverage !== "SCHEDULED_OWNERS" ||
    capture.captureKind !== "ROSTER").sort((left, right) =>
    left.captureOrdinal - right.captureOrdinal);
  const canonicalRecords = canonicalizeSabaDomMarketIds(captures.map(({ record }) => record));
  if (canonicalRecords === null) return null;
  for (const [captureIndex, capture] of captures.entries()) {
    const options = { observedAtMs: capture.capturedAtMs,
      receivedMonotonicMs: capture.capturedMonotonicMs,
      timezoneOffsetMinutes: capture.record.providerTimezoneOffsetMinutes ?? 480,
      sequence: capture.captureOrdinal, requireExplicitDateForUndatedKickoff: true,
      ...(capture.kickoffDate.kind === "EXPLICIT" ? {
        explicitProviderDate: capture.kickoffDate.isoDate
      } : {}) };
    const canonicalRecord = canonicalRecords[captureIndex]!;
    const base = normalizeObservedFootballCatalog("SABA", [canonicalRecord], options);
    const normalized = augmentSabaDomCleanSheet({ ...base,
      nativeMarketObservations: observeNativeCmdMarkets("SABA", [canonicalRecord], options)
    }, canonicalRecord, options);
    const observedNative = normalized.nativeMarketObservations ?? [];
    for (const event of normalized.events) events.set(event.providerEventId, event);
    for (const market of normalized.markets) {
      markets.set(`${market.providerEventId}\u0000${market.providerMarketId}`, market);
    }
    for (const quote of normalized.quotes) {
      const key = quoteKey(quote);
      const current = quotes.get(key);
      if (current === undefined || quote.receivedMonotonicMs >= current.receivedMonotonicMs) {
        quotes.set(key, quote);
      }
    }
    for (const observation of observedNative) {
      native.set(`${observation.providerEventId}\u0000${observation.providerMarketId}\u0000${observation.nativeType}`,
        observation);
    }
    diagnostics.push(...normalized.diagnostics);
  }
  return { events: [...events.values()], markets: [...markets.values()], quotes: [...quotes.values()],
    nativeMarketObservations: [...native.values()], diagnostics };
}


function collectorRosterFingerprint(capture: ValidatedSabaCollectorCandidate["captures"][number]): string {
  return JSON.stringify({ record: capture.record, kickoffDate: capture.kickoffDate,
    capturedAtMs: capture.capturedAtMs, capturedMonotonicMs: capture.capturedMonotonicMs });
}

function mergeScheduledCollectorParts(prior: NormalizedCatalogPart, next: NormalizedCatalogPart): NormalizedCatalogPart {
  const events = new Map(prior.events.map(event => [event.providerEventId, event]));
  const markets = new Map(prior.markets.map(market => [`${market.providerEventId}\u0000${market.providerMarketId}`, market]));
  const quotes = new Map(prior.quotes.map(quote => [quoteKey(quote), quote]));
  const native = new Map((prior.nativeMarketObservations ?? []).map(observation =>
    [`${observation.providerEventId}\u0000${observation.providerMarketId}\u0000${observation.nativeType}`, observation]));
  // A captured market is a fresh inventory for that exact market. Its missing
  // selection can be closed, while unmentioned markets and owners stay retained.
  const refreshedMarkets = new Set((next.nativeMarketObservations ?? []).map(observation =>
    `${observation.providerEventId}\u0000${observation.providerMarketId}`));
  for (const [key, quote] of quotes) {
    if (refreshedMarkets.has(`${quote.providerEventId}\u0000${quote.providerMarketId}`)) quotes.delete(key);
  }
  for (const key of refreshedMarkets) markets.delete(key);
  for (const event of next.events) events.set(event.providerEventId, event);
  for (const market of next.markets) markets.set(`${market.providerEventId}\u0000${market.providerMarketId}`, market);
  for (const quote of next.quotes) {
    const key = quoteKey(quote);
    if (quote.receivedMonotonicMs >= (quotes.get(key)?.receivedMonotonicMs ?? -1)) quotes.set(key, quote);
  }
  for (const observation of next.nativeMarketObservations ?? []) {
    const key = `${observation.providerEventId}\u0000${observation.providerMarketId}\u0000${observation.nativeType}`;
    if (observation.observedAtMs >= (native.get(key)?.observedAtMs ?? -1)) native.set(key, observation);
  }
  return { events: [...events.values()], markets: [...markets.values()], quotes: [...quotes.values()],
    nativeMarketObservations: [...native.values()], diagnostics: next.diagnostics };
}


function withoutSupersededCapturedMarkets(part: NormalizedCatalogPart,
  clocks: ReadonlyMap<string, { readonly monotonic: number; readonly wall: number }>): NormalizedCatalogPart {
  const marketKey = (row: { readonly providerEventId: string; readonly providerMarketId: string }): string =>
    `${row.providerEventId}\u0000${row.providerMarketId}`;
  const quotes = part.quotes.filter(quote => {
    const captured = clocks.get(marketKey(quote));
    return captured === undefined || quote.receivedMonotonicMs > captured.monotonic;
  });
  const newerMarkets = new Set(quotes.map(marketKey));
  return { ...part, quotes,
    markets: part.markets.filter(market => !clocks.has(marketKey(market)) || newerMarkets.has(marketKey(market))),
    ...(part.nativeMarketObservations === undefined ? {} : {
      nativeMarketObservations: part.nativeMarketObservations.filter(observation => {
        const captured = clocks.get(marketKey(observation));
        return captured === undefined || observation.observedAtMs > captured.wall;
      }) }) };
}
