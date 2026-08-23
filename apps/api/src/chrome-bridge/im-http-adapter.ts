import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { extractImFootballCatalog, mergeImFootballDelta } from
  "../providers/im/im-football-catalog-source.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";

const ACCOUNT_ID = "catalog-source:IM:FOOTBALL";
const HOST = "imsports.directsb.net";
const SNAPSHOT_PATH = "/api/EventV6/GetSE";
const DELTA_PATH = "/api/EventV6/GetSEDelta";
const PREMATCH_HORIZON_MS = 48 * 60 * 60 * 1_000;
type ImPartition = "IM_MARKET_1" | "IM_MARKET_2";
type ImRecord = ReturnType<typeof extractImFootballCatalog>[number];

interface RetainedRecord {
  readonly record: ImRecord;
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}

type PartitionRecords = Map<string, RetainedRecord>;

interface ClassifiedPartition {
  readonly records: PartitionRecords;
  readonly inputCount: number;
}

interface SnapshotGeneration {
  readonly id: string;
  readonly partitions: Map<ImPartition, ClassifiedPartition>;
  readonly startedSequence: number;
  readonly cutoffSequence: number;
  readonly bufferedDeltas: ChromeBridgeEnvelope[];
}

interface SourceState {
  current: Map<ImPartition, PartitionRecords> | null;
  currentGeneration: string | null;
  pending: SnapshotGeneration | null;
  readonly obsoleteGenerations: Set<string>;
  newestGenerationOrdinal: number | null;
  readonly recentDeltas: ChromeBridgeEnvelope[];
  latestDeltaSequence: number | null;
}

function rememberObsolete(state: SourceState, generation: string): void {
  state.obsoleteGenerations.add(generation);
  while (state.obsoleteGenerations.size > 64) {
    const oldest = state.obsoleteGenerations.values().next().value as string | undefined;
    if (oldest === undefined) break;
    state.obsoleteGenerations.delete(oldest);
  }
}

export class ImHttpCatalogAdapter implements ChromeTrafficAdapter {
  readonly id = "im-http-catalog-v1";
  readonly lobby = "IM" as const;
  readonly providerFamily = "IM";
  readonly #states = new Map<string, SourceState>();
  readonly #parsedBodies = new WeakMap<ChromeBridgeEnvelope, Record<string, unknown> | null>();

  resetSource(sourceId: string): void {
    this.#states.delete(sourceId);
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "IM" || envelope.transport !== "HTTP_RESPONSE" ||
      envelope.request.hostname !== HOST || envelope.payload.encoding !== "UTF8" ||
      (envelope.request.pathnameClass !== SNAPSHOT_PATH && envelope.request.pathnameClass !== DELTA_PATH)) return false;
    if (envelope.request.pathnameClass === SNAPSHOT_PATH &&
      (envelope.request.providerPartition === undefined || envelope.request.streamId === undefined ||
        envelope.request.reconcileCutoffSequence === undefined)) return false;
    const root = parseRecord(envelope.payload.body);
    this.#parsedBodies.set(envelope, root);
    return root?.StatusCode === 100 && (envelope.request.pathnameClass === SNAPSHOT_PATH
      ? Array.isArray(root.sel) : Array.isArray(root.dc));
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const root = this.#parsedBodies.get(envelope) ?? parseRecord(envelope.payload.body);
    if (root === null) return [];
    const state = this.#states.get(envelope.sourceId) ?? { current: null, currentGeneration: null,
      pending: null, obsoleteGenerations: new Set<string>(), newestGenerationOrdinal: null,
      recentDeltas: [], latestDeltaSequence: null };
    if (envelope.request.pathnameClass === SNAPSHOT_PATH) {
      const partition = envelope.request.providerPartition;
      const generation = envelope.request.streamId;
      const cutoffSequence = envelope.request.reconcileCutoffSequence;
      const ordinal = generation === undefined ? null : generationOrdinal(generation);
      if (partition === undefined || generation === undefined || cutoffSequence === undefined ||
        state.obsoleteGenerations.has(generation) ||
        (ordinal !== null && state.newestGenerationOrdinal !== null && ordinal < state.newestGenerationOrdinal) ||
        state.currentGeneration === generation) return [];
      if (ordinal !== null && (state.newestGenerationOrdinal === null || ordinal > state.newestGenerationOrdinal)) {
        state.newestGenerationOrdinal = ordinal;
      }
      if (state.pending === null || state.pending.id !== generation) {
        if (state.pending !== null) rememberObsolete(state, state.pending.id);
        state.pending = { id: generation, partitions: new Map<ImPartition, ClassifiedPartition>(),
          startedSequence: envelope.sequence, cutoffSequence,
          bufferedDeltas: state.recentDeltas.filter((delta) => delta.sequence > cutoffSequence) };
      }
      if (state.pending.cutoffSequence !== cutoffSequence) return [];
      const classified = classifySnapshot(root, envelope.observedAtMs);
      if (classified === null) return [];
      const records = new Map<string, RetainedRecord>();
      for (const record of classified.records) {
        records.set(record.eventId, { record, observedAtMs: envelope.observedAtMs,
          receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence });
      }
      state.pending.partitions.set(partition, { records, inputCount: classified.inputCount });
      this.#states.set(envelope.sourceId, state);
      if (!state.pending.partitions.has("IM_MARKET_1") || !state.pending.partitions.has("IM_MARKET_2")) return [];
      const pendingPartitions = state.pending.partitions;
      const acceptedCount = [...pendingPartitions.values()].reduce((sum, value) => sum + value.records.size, 0);
      const inputCount = [...pendingPartitions.values()].reduce((sum, value) => sum + value.inputCount, 0);
      if (acceptedCount === 0 && inputCount > 0) return [];
      if (state.currentGeneration !== null) rememberObsolete(state, state.currentGeneration);
      state.current = new Map([...pendingPartitions].map(([key, value]) => [key, value.records]));
      state.currentGeneration = state.pending.id;
      for (const buffered of state.pending.bufferedDeltas) this.#applyDelta(state.current, buffered);
      state.pending = null;
    } else {
      if (state.latestDeltaSequence !== null && envelope.sequence <= state.latestDeltaSequence) return [];
      state.latestDeltaSequence = envelope.sequence;
      state.recentDeltas.push(envelope);
      while (state.recentDeltas.length > 128) state.recentDeltas.shift();
      this.#states.set(envelope.sourceId, state);
      const sourcePartitions = state.current;
      if (sourcePartitions === null) return [];
      if (state.pending !== null && envelope.sequence > state.pending.cutoffSequence) {
        state.pending.bufferedDeltas.push(envelope);
      }
      const changed = this.#applyDelta(sourcePartitions, envelope);
      if (!changed) return [];
    }
    this.#states.set(envelope.sourceId, state);
    const sourcePartitions = state.current;
    if (sourcePartitions === null) return [];
    const parts: NormalizedCatalogPart[] = [];
    for (const partition of ["IM_MARKET_1", "IM_MARKET_2"] as const) {
      for (const entry of sourcePartitions.get(partition)!.values()) {
        parts.push(normalizeSbobetCatalog([entry.record], {
          observedAtMs: entry.observedAtMs,
          receivedMonotonicMs: entry.receivedMonotonicMs,
          sequence: entry.sequence,
          provider: "IM",
          settlementProfile: "football-regulation-including-added-time"
        }));
      }
    }
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "IM",
      observedAtMs: envelope.observedAtMs, parts });
    const evidenceMode = envelope.request.pathnameClass === SNAPSHOT_PATH ? "BASELINE" : "DELTA";
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs, value: catalog,
      ...(evidenceMode === "BASELINE" ? { authoritativeBaseline: true } : {}), evidenceMode,
      generation: state.currentGeneration!, provenance: "AUTHENTICATED_HTTP", providerTimestampMs: null }];
  }

  #applyDelta(sourcePartitions: Map<ImPartition, PartitionRecords>, envelope: ChromeBridgeEnvelope): boolean {
    const root = parseRecord(envelope.payload.body);
    if (root === null) return false;
    const target = envelope.request.providerPartition;
    const partitions = target === undefined
      ? sourcePartitions.size === 2 ? [...sourcePartitions.entries()] : []
      : sourcePartitions.has(target) ? [[target, sourcePartitions.get(target)!] as const] : [];
    let changed = false;
    for (const [, records] of partitions) {
      for (const [eventId, entry] of [...records]) {
        const updated = mergeImFootballDelta([entry.record], root);
        if (updated.length === 0) { records.delete(eventId); changed = true; }
        else if (updated[0] !== entry.record) {
          records.set(eventId, { record: updated[0]!, observedAtMs: envelope.observedAtMs,
            receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence });
          changed = true;
        }
      }
    }
    return changed;
  }
}

function classifySnapshot(root: Record<string, unknown>, nowMs: number): {
  readonly records: readonly ImRecord[]; readonly inputCount: number } | null {
  const candidates = root.sel;
  if (!Array.isArray(candidates)) return null;
  const accepted: ImRecord[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) return null;
    const eventId = candidate.eid;
    const eventAtMs = typeof candidate.edt === "string" ? Date.parse(candidate.edt) : Number.NaN;
    if (!((typeof eventId === "number" && Number.isSafeInteger(eventId) && eventId > 0) ||
      (typeof eventId === "string" && /^\d+$/u.test(eventId))) ||
      typeof candidate.htn !== "string" || candidate.htn.trim() === "" ||
      typeof candidate.atn !== "string" || candidate.atn.trim() === "" ||
      candidate.htn.trim() === candidate.atn.trim() ||
      typeof candidate.cn !== "string" || candidate.cn.trim() === "" ||
      typeof candidate.isrbt !== "boolean" || !Number.isFinite(eventAtMs) || !Array.isArray(candidate.mls)) return null;
    if (candidate.iscyb === true) continue;
    if (candidate.iscyb !== false) return null;
    if (!(candidate.mls as unknown[]).every(isClassifiedImMarket)) return null;
    const extracted = extractImFootballCatalog({ StatusCode: 100, sel: [candidate] }, {
      nowMs, prematchHorizonMs: PREMATCH_HORIZON_MS
    });
    if (extracted.length > 0) accepted.push(...extracted);
    else if (candidate.isrbt !== true && (eventAtMs < nowMs || eventAtMs > nowMs + PREMATCH_HORIZON_MS)) continue;
    // Structurally valid but unsupported market/period/line records are an
    // explained provider-domain exclusion rather than malformed evidence.
  }
  return { records: accepted, inputCount: candidates.length };
}

function isClassifiedImMarket(value: unknown): boolean {
  if (!isRecord(value) || providerIdentifier(value.mi) === null || !Number.isSafeInteger(Number(value.bti)) ||
    !Number.isSafeInteger(Number(value.gp)) || !Array.isArray(value.ws)) return false;
  const supportedDomain = [1, 2].includes(Number(value.bti)) && [1, 2, 3].includes(Number(value.gp));
  if (!supportedDomain) return true;
  if (value.ws.length !== 2) return false;
  const expectedSelections = Number(value.bti) === 1 ? new Set([1, 2]) : new Set([3, 4]);
  const actualSelections = new Set<number>();
  for (const selection of value.ws) {
    if (!isRecord(selection) || providerIdentifier(selection.wsi) === null ||
      !expectedSelections.has(Number(selection.si)) || actualSelections.has(Number(selection.si)) ||
      typeof selection.hdp !== "number" || !Number.isFinite(selection.hdp) || Math.abs(selection.hdp) > 100 ||
      typeof selection.dih !== "string" || selection.dih.trim() === "" ||
      typeof selection.o !== "number" || !Number.isFinite(selection.o) || selection.o === 0 ||
      Math.abs(selection.o) > 1) return false;
    actualSelections.add(Number(selection.si));
  }
  return actualSelections.size === 2;
}

function providerIdentifier(value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value)
    : typeof value === "string" && /^\d+$/u.test(value) && value !== "0" ? value : null;
}

function generationOrdinal(generation: string): number | null {
  const match = /:(\d+)$/u.exec(generation);
  if (match === null) return null;
  const ordinal = Number(match[1]);
  return Number.isSafeInteger(ordinal) ? ordinal : null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
