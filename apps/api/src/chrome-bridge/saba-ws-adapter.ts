import { normalizeObservedFootballCatalog, normalizeSabaFootballRecords } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { SabaPushDecoder } from "../providers/saba/saba-push-decoder.js";
import { parseSabaSocketFrame } from "../providers/saba/saba-socket-frame.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type CatalogEvent, type NormalizedCatalogPart } from "./catalog-part-merge.js";
import { CmdSnapshotAssembler } from "./cmd-snapshot-assembler.js";
import { decodePublicDomRecords } from "./cmd-dom-adapter.js";
import { websocketLifecycleState } from "./websocket-lifecycle.js";

const ACCOUNT_ID = "catalog-source:SABA:FOOTBALL";
const MAX_RETAINED_PART_AGE_MS = 3_600_000;
const MIN_STABLE_DOM_EVENTS = 20;
const SINGLE_GENERATION_DOM_EVENTS = 50;

function isSabaEngineIoHeartbeat(body: string): boolean {
  return body === "2" || body === "3";
}

function sourceEpoch(envelope: ChromeBridgeEnvelope): string {
  return envelope.sourceEpoch ?? "legacy";
}

function sourceEpochKey(envelope: ChromeBridgeEnvelope): string {
  return `${envelope.sourceId}|${sourceEpoch(envelope)}`;
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

export class SabaWsCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "saba-ws-catalog-v1";
  readonly lobby = "SABA" as const;
  readonly providerFamily = "SABA";
  readonly #decoders = new Map<string, SabaPushDecoder>();
  readonly #assembler = new CmdSnapshotAssembler();
  readonly #parts = new Map<string, NormalizedCatalogPart>();
  readonly #partObservedAtMs = new Map<string, number>();
  readonly #readyPartitions = new Set<string>();
  readonly #domCandidates = new Map<string, ReadonlySet<string>>();
  readonly #domReadySources = new Set<string>();
  readonly #lastWsPublishAtMs = new Map<string, number>();
  readonly #streamStates = new Map<string, SabaStreamState>();
  readonly #authoritativeGenerations = new Map<string, string>();
  readonly #authoritativeBaselineAtMs = new Map<string, number>();

  resetSource(sourceId: string): void {
    for (const key of this.#decoders.keys()) if (key.startsWith(`${sourceId}|`)) this.#decoders.delete(key);
    this.#assembler.resetSource(sourceId);
    for (const key of this.#parts.keys()) if (key.startsWith(`${sourceId}|`)) this.#parts.delete(key);
    for (const key of this.#partObservedAtMs.keys()) {
      if (key.startsWith(`${sourceId}|`)) this.#partObservedAtMs.delete(key);
    }
    for (const key of this.#readyPartitions) if (key.startsWith(`${sourceId}|`)) this.#readyPartitions.delete(key);
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
    if (!this.fingerprint(envelope)) return [];
    // Replayed provider evidence is display/bootstrap material only. It must
    // not allocate decoders, advance lifecycle high-water marks, or retire the
    // active stream even when this adapter is called outside the data plane.
    if (envelope.request.replayed === true) return [];
    if (envelope.transport === "DOM_SNAPSHOT") {
      // The DOM is only the visible viewport, never an authoritative baseline.
      // Publishing it before reset/done makes a healthy reconnect look LIVE
      // with only a handful of events and overwrites the complete catalog.
      const socketReady = [...this.#readyPartitions].some((key) => key.startsWith(`${envelope.sourceId}|`));
      // Keep accepting the current visible DOM after the socket bootstrap. A
      // quiet SABA socket may not publish another catalog frame for minutes;
      // dropping these snapshots made an otherwise healthy catalog expire.
      // The DOM remains a separate partition, so hidden socket-only markets
      // stay in the union while overlapping visible prices are refreshed.
      const records = decodePublicDomRecords(this.#assembler, envelope);
      if (records === null) return [];
      const usable = records.filter((record) => record.groups.length > 0);
      if (!socketReady) {
        // Some SABA deployments expose the complete current event table in the
        // page but do not recreate their Socket.IO transport after a service
        // worker restart. One large atomic generation can establish fallback
        // authority; a smaller complete-looking table still needs a second
        // stable generation. Later generations must retain nearly identical
        // coverage, so a scrolling viewport cannot erase the last good catalog.
        if (usable.length < MIN_STABLE_DOM_EVENTS) return [];
        const identities = new Set(usable.map((record) => record.matchId));
        const previous = this.#domCandidates.get(envelope.sourceId);
        if (!this.#domReadySources.has(envelope.sourceId)) {
          this.#domCandidates.set(envelope.sourceId, identities);
          if (previous === undefined && usable.length < SINGLE_GENERATION_DOM_EVENTS) return [];
          if (previous !== undefined && !stableDomCoverage(previous, identities)) return [];
          this.#domReadySources.add(envelope.sourceId);
        } else if (previous !== undefined && !stableDomCoverage(previous, identities)) {
          return [];
        }
        this.#domCandidates.set(envelope.sourceId, identities);
      }
      const normalized = normalizeObservedFootballCatalog("SABA", records, {
        observedAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
        timezoneOffsetMinutes: 480, sequence: envelope.sequence
      });
      const establishesDomAuthority = !socketReady && this.#domReadySources.has(envelope.sourceId);
      return this.#update(envelope, "DOM", normalized, establishesDomAuthority
        ? { authoritativeBaseline: true, evidenceMode: "BASELINE",
            generation: `${sourceEpoch(envelope)}:dom:${envelope.sequence}`, provenance: "DOM_FALLBACK" }
        : { evidenceMode: "DELTA", generation: `${sourceEpoch(envelope)}:dom:${envelope.sequence}`,
            provenance: "DOM_FALLBACK" });
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
        baselineAgeMs < 0 || baselineAgeMs > MAX_RETAINED_PART_AGE_MS) return [];
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, transportAlive: true }];
    }
    if (envelope.transport === "WS_STATE") {
      const state = websocketLifecycleState(envelope);
      if (state === null) return [];
      if (state === "OPEN") {
        const current = this.#streamStates.get(epochKey);
        if (current?.activeStreamId === streamId && current.activeStreamOrdinal === streamOrdinal) {
          if (current.authorizing) return [];
          this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
          current.authorizing = true;
          this.#authoritativeGenerations.delete(epochKey);
          this.#authoritativeBaselineAtMs.delete(epochKey);
          return [];
        }
        if (current !== undefined && streamOrdinal <= current.highWatermark) return [];
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
      if (current?.activeStreamId !== streamId || current.activeStreamOrdinal !== streamOrdinal) return [];
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
        return [];
      }
      const recoveryStartsBaseline = recoveryFrame !== null &&
        (recoveryFrame.rows as readonly unknown[]).some((row) => Array.isArray(row) &&
          (row[1] === "reset" || row[1] === "empty"));
      if (!recoveryStartsBaseline) return [];
      stream.activeStreamId = streamId;
      stream.activeStreamOrdinal = streamOrdinal;
      stream.highWatermark = streamOrdinal;
      stream.authorizing = false;
    }
    if (stream.activeStreamId !== streamId || stream.activeStreamOrdinal !== streamOrdinal) return [];
    let startsBaseline = false;
    let faultingReadyKey: string | null = null;
    try {
      const frame = parseSabaSocketFrame(envelope.payload.body);
      if (frame === null) return [];
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
        return [];
      }
      if (startsBaseline && !applied.fullSnapshot) {
        restorePriorAuthority();
        return [];
      }
      if (applied.records.length === 0 && !applied.fullSnapshot) return [];
      const normalized = normalizeSabaFootballRecords(applied.records, {
        observedAtMs: envelope.observedAtMs,
        receivedMonotonicMs: envelope.receivedMonotonicMs,
        sequence: envelope.sequence
      });
      const partition = `WS:${streamId}:${frame.bridgeId}`;
      const previousPart = this.#parts.get(`${epochKey}|${partition}`);
      if (previousPart !== undefined && sameSabaCatalogPart(previousPart, normalized)) {
        restorePriorAuthority();
        return [];
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
      if (!this.#readyPartitions.has(readyKey)) return [];
      // Price deltas must be published immediately: a time-only throttle can
      // swallow the final odds change in a burst forever when no later frame
      // arrives. Only coalesce rapid metadata-only changes; the next metadata
      // or price frame materializes the decoder's complete current state.
      const publishKey = `${decoderKey}|${frame.bridgeId}`;
      const lastPublishedAtMs = this.#lastWsPublishAtMs.get(publishKey) ?? Number.NEGATIVE_INFINITY;
      const changesPrice = applied.changes.some((change) => change.record?.type === "o" ||
        change.record?.type === "do" || change.record?.type === "-o");
      if (!applied.fullSnapshot && !changesPrice && envelope.observedAtMs - lastPublishedAtMs < 500) return [];
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
      if (authoritative && applied.records.length === 0) {
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
      return this.#update(envelope, partition, normalized,
        authoritative ? { authoritativeBaseline: true, evidenceMode: "BASELINE", generation, provenance: "WS" }
          : generation !== undefined && this.#streamStates.get(epochKey)?.activeStreamId === streamId &&
              this.#streamStates.get(epochKey)?.authorizing === true
            ? { evidenceMode: "DELTA", generation, provenance: "WS" } : {},
        authoritative && applied.records.length === 0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "";
      const sequenceGap = errorMessage.includes("SABA_PUSH_SCHEMA_CHANGED:SEQUENCE_GAP");
      const schemaFault = errorMessage.startsWith("SABA_PUSH_SCHEMA_CHANGED") ||
        errorMessage === "SABA_PUSH_FRAME_INVALID";
      const faultingPartitionWasReady = faultingReadyKey !== null && this.#readyPartitions.has(faultingReadyKey);
      if (startsBaseline || faultingReadyKey === null ||
        ((sequenceGap || schemaFault) && faultingPartitionWasReady)) {
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
      return [];
    }
  }

  #update(envelope: ChromeBridgeEnvelope, partition: string,
    normalized: NormalizedCatalogPart,
    evidence: Pick<Extract<DecodedCatalogUpdate, { readonly value: unknown }>, "authoritativeBaseline" |
      "evidenceMode" | "generation" | "provenance"> = {},
    allowCompleteEmpty = false): readonly DecodedCatalogUpdate[] {
    const empty = normalized.events.length === 0 && normalized.markets.length === 0 && normalized.quotes.length === 0;
    if ((!empty && (normalized.events.length === 0 || normalized.markets.length === 0 || normalized.quotes.length === 0)) ||
      (empty && !allowCompleteEmpty)) return [];
    const epochKey = sourceEpochKey(envelope);
    const partitionKey = `${epochKey}|${partition}`;
    this.#parts.delete(partitionKey);
    this.#parts.set(partitionKey, normalized);
    this.#partObservedAtMs.set(partitionKey, envelope.observedAtMs);
    for (const [key, observedAtMs] of this.#partObservedAtMs) {
      if (!key.startsWith(`${epochKey}|`) || envelope.observedAtMs - observedAtMs <= MAX_RETAINED_PART_AGE_MS) continue;
      this.#partObservedAtMs.delete(key);
      this.#parts.delete(key);
    }
    const sourceParts = [...this.#parts].filter(([key]) => key.startsWith(`${epochKey}|`))
      .map(([, value]) => value);
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SABA",
      observedAtMs: envelope.observedAtMs, parts: sourceParts, selectEvent: selectStableSabaEvent,
      // SABA's live section also lists fixtures that have not kicked off, and
      // only here do its two partitions meet, so only here can its own schedule
      // contradict them.
      resolveScheduledPhase: true });
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog, ...evidence }];
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

function sabaStreamOrdinal(streamId: string): number | null {
  if (!/^[1-9]\d*$/u.test(streamId)) return null;
  const ordinal = Number(streamId);
  return Number.isSafeInteger(ordinal) ? ordinal : null;
}

function sameSabaCatalogPart(left: NormalizedCatalogPart, right: NormalizedCatalogPart): boolean {
  const semanticFingerprint = (part: NormalizedCatalogPart): string => JSON.stringify(part, (key, value) =>
    key === "receivedMonotonicMs" || key === "sequence" ? undefined : value);
  return semanticFingerprint(left) === semanticFingerprint(right);
}
