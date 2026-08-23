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
const MAX_RETAINED_PART_AGE_MS = 60_000;

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
  return liveIdentityScore(candidate) > liveIdentityScore(current) ? candidate : current;
}

function stableDomCoverage(previous: ReadonlySet<string>, current: ReadonlySet<string>): boolean {
  if (previous.size === 0 || current.size === 0) return false;
  let shared = 0;
  for (const identity of current) if (previous.has(identity)) shared += 1;
  const smaller = Math.min(previous.size, current.size);
  const sizeDrift = Math.abs(previous.size - current.size);
  return shared / smaller >= 0.95 && sizeDrift <= Math.max(5, Math.ceil(previous.size * 0.1));
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
  readonly #activeStreams = new Map<string, string>();
  readonly #retiredStreams = new Map<string, Set<string>>();
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
    for (const key of this.#activeStreams.keys()) if (key.startsWith(`${sourceId}|`)) this.#activeStreams.delete(key);
    for (const key of this.#retiredStreams.keys()) if (key.startsWith(`${sourceId}|`)) this.#retiredStreams.delete(key);
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
    if (envelope.transport === "WS_STATE") return envelope.request.streamId !== undefined &&
      websocketLifecycleState(envelope) !== null;
    // Parsing large Socket.IO frames here and again in decode doubled the hot
    // path cost. The route and lobby already identify SABA; decode performs
    // the strict provider-frame validation once.
    return /^42\["m",/u.test(envelope.payload.body);
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
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
        // worker restart. Promote that table only after two atomic generations
        // have nearly identical event coverage. A scrolling viewport or a
        // half-rendered generation cannot satisfy this quorum and cannot erase
        // the last good catalog.
        if (usable.length < 20) return [];
        const identities = new Set(usable.map((record) => record.matchId));
        const previous = this.#domCandidates.get(envelope.sourceId);
        if (!this.#domReadySources.has(envelope.sourceId)) {
          this.#domCandidates.set(envelope.sourceId, identities);
          if (previous === undefined || !stableDomCoverage(previous, identities)) return [];
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
      return this.#update(envelope, "DOM", normalized, {
        evidenceMode: "DELTA", generation: `${sourceEpoch(envelope)}:dom:${envelope.sequence}`,
        provenance: "DOM_FALLBACK"
      });
    }
    const streamId = envelope.request.streamId ?? "legacy";
    const epochKey = sourceEpochKey(envelope);
    const decoderKey = `${epochKey}|${streamId}`;
    if (envelope.transport === "WS_STATE") {
      const state = websocketLifecycleState(envelope);
      if (state === null) return [];
      if (state === "OPEN") {
        const previous = this.#activeStreams.get(epochKey);
        if (this.#retiredStreams.get(epochKey)?.has(streamId) === true || previous === streamId) return [];
        this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
        if (previous !== undefined && previous !== streamId) {
          this.#dropStream(envelope.sourceId, sourceEpoch(envelope), previous);
          const retired = this.#retiredStreams.get(epochKey) ?? new Set<string>();
          retired.add(previous);
          this.#retiredStreams.set(epochKey, retired);
        }
        this.#activeStreams.set(epochKey, streamId);
        this.#authoritativeGenerations.delete(epochKey);
        this.#authoritativeBaselineAtMs.delete(epochKey);
        return [];
      }
      this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
      if (this.#activeStreams.get(epochKey) !== streamId) return [];
      this.#activeStreams.delete(epochKey);
      const retired = this.#retiredStreams.get(epochKey) ?? new Set<string>();
      retired.add(streamId);
      this.#retiredStreams.set(epochKey, retired);
      this.#authoritativeGenerations.delete(epochKey);
      this.#authoritativeBaselineAtMs.delete(epochKey);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
        invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_CLOSED" }];
    }
    if (this.#retiredStreams.get(epochKey)?.has(streamId) === true) return [];
    try {
      const frame = parseSabaSocketFrame(envelope.payload.body);
      if (frame === null) return [];
      if (JSON.stringify(frame.rows).includes('"A003"')) {
        this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
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
      const startsBaseline = (frame.rows as readonly unknown[]).some((row) => Array.isArray(row) &&
        (row[1] === "reset" || row[1] === "empty"));
      if (startsBaseline) {
        this.#authoritativeGenerations.delete(epochKey);
        this.#authoritativeBaselineAtMs.delete(epochKey);
      } else {
        const baselineAtMs = this.#authoritativeBaselineAtMs.get(epochKey);
        if (baselineAtMs !== undefined && envelope.observedAtMs - baselineAtMs > MAX_RETAINED_PART_AGE_MS) {
          this.#authoritativeGenerations.delete(epochKey);
          this.#authoritativeBaselineAtMs.delete(epochKey);
          for (const key of this.#readyPartitions) {
            if (key.startsWith(`${epochKey}|`)) this.#readyPartitions.delete(key);
          }
        }
      }
      const applied = decoder.apply(frame);
      if (applied.duplicate || (applied.records.length === 0 && !applied.fullSnapshot)) return [];
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
      const normalized = normalizeSabaFootballRecords(applied.records, {
        observedAtMs: envelope.observedAtMs,
        receivedMonotonicMs: envelope.receivedMonotonicMs,
        sequence: envelope.sequence
      });
      if (applied.fullSnapshot && envelope.request.replayed !== true &&
        this.#activeStreams.get(epochKey) === streamId) {
        this.#authoritativeGenerations.set(epochKey,
          `${sourceEpoch(envelope)}:saba:${streamId}:${envelope.sequence}`);
        this.#authoritativeBaselineAtMs.set(epochKey, envelope.observedAtMs);
      }
      const generation = this.#authoritativeGenerations.get(epochKey);
      const authoritative = applied.fullSnapshot && generation !== undefined &&
        envelope.request.replayed !== true && this.#activeStreams.get(epochKey) === streamId;
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
      return this.#update(envelope, `WS:${streamId}:${frame.bridgeId}`, normalized,
        authoritative ? { authoritativeBaseline: true, evidenceMode: "BASELINE", generation, provenance: "WS" }
          : generation !== undefined && this.#activeStreams.get(epochKey) === streamId
            ? { evidenceMode: "DELTA", generation, provenance: "WS" } : {},
        authoritative && applied.records.length === 0);
    } catch (error) {
      if (error instanceof Error && error.message.includes("SABA_PUSH_SCHEMA_CHANGED:SEQUENCE_GAP")) {
        this.#dropStream(envelope.sourceId, sourceEpoch(envelope), streamId);
        this.#authoritativeGenerations.delete(epochKey);
        this.#authoritativeBaselineAtMs.delete(epochKey);
        return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
          invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_GAP" }];
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
      observedAtMs: envelope.observedAtMs, parts: sourceParts, selectEvent: selectStableSabaEvent });
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog, ...evidence }];
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
