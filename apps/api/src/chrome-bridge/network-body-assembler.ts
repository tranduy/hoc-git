import { ChromeNetworkBodyChunkSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_BODY_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_PENDING_BODIES_PER_SOURCE = 8;
const DEFAULT_MAX_PENDING_BODIES = DEFAULT_MAX_PENDING_BODIES_PER_SOURCE * 6;
const DEFAULT_MAX_PENDING_BYTES_PER_SOURCE = DEFAULT_MAX_BODY_BYTES;
const DEFAULT_MAX_PENDING_BYTES = DEFAULT_MAX_PENDING_BYTES_PER_SOURCE * 6;
const textEncoder = new TextEncoder();

export interface NetworkBodyAssemblyBudgetOptions {
  readonly maxPendingBodies?: number;
  readonly maxPendingBytes?: number;
  readonly now?: () => number;
}

export interface NetworkBodyAssemblyBudgetStats {
  readonly pendingBodies: number;
  readonly pendingBytes: number;
}

export interface NetworkBodyAssemblyReservation {
  readonly kind: "NETWORK_BODY_ASSEMBLY_RESERVATION";
}

export type NetworkBodyAssemblyReservationUpdate = "ACCEPTED" | "MISSING" | "PRESSURE";

export class NetworkBodyAssemblyBudget {
  readonly #maxPendingBodies: number;
  readonly #maxPendingBytes: number;
  readonly #now: () => number;
  readonly #reservations = new Map<NetworkBodyAssemblyReservation, {
    bytes: number;
    expiresAtMs: number;
  }>();
  #observedNowMs = 0;

  constructor(options: NetworkBodyAssemblyBudgetOptions = {}) {
    this.#maxPendingBodies = positiveInteger(options.maxPendingBodies,
      DEFAULT_MAX_PENDING_BODIES, "maxPendingBodies");
    this.#maxPendingBytes = positiveInteger(options.maxPendingBytes,
      DEFAULT_MAX_PENDING_BYTES, "maxPendingBytes");
    this.#now = options.now ?? Date.now;
  }

  reserve(byteCount: number, expiresAtMs: number, nowMs: number): NetworkBodyAssemblyReservation | null {
    nonnegativeInteger(byteCount, "byteCount");
    finiteNonnegative(expiresAtMs, "expiresAtMs");
    const now = this.#observeNow(nowMs);
    this.#sweep(now);
    if (expiresAtMs <= now || this.#reservations.size >= this.#maxPendingBodies ||
      this.#pendingBytes() + byteCount > this.#maxPendingBytes) return null;
    const reservation = Object.freeze({
      kind: "NETWORK_BODY_ASSEMBLY_RESERVATION" as const
    });
    this.#reservations.set(reservation, { bytes: byteCount, expiresAtMs });
    return reservation;
  }

  update(reservation: NetworkBodyAssemblyReservation, additionalBytes: number,
    expiresAtMs: number, nowMs: number): NetworkBodyAssemblyReservationUpdate {
    nonnegativeInteger(additionalBytes, "additionalBytes");
    finiteNonnegative(expiresAtMs, "expiresAtMs");
    const now = this.#observeNow(nowMs);
    this.#sweep(now);
    const retained = this.#reservations.get(reservation);
    if (retained === undefined || expiresAtMs <= now) return "MISSING";
    if (this.#pendingBytes() + additionalBytes > this.#maxPendingBytes) return "PRESSURE";
    retained.bytes += additionalBytes;
    // A fragment cannot extend the body's original absolute TTL.
    retained.expiresAtMs = Math.min(retained.expiresAtMs, expiresAtMs);
    return "ACCEPTED";
  }

  isLive(reservation: NetworkBodyAssemblyReservation, nowMs: number): boolean {
    const now = this.#observeNow(nowMs);
    this.#sweep(now);
    return this.#reservations.has(reservation);
  }

  release(reservation: NetworkBodyAssemblyReservation): void {
    this.#reservations.delete(reservation);
  }

  stats(): NetworkBodyAssemblyBudgetStats {
    const now = this.#observeNow(this.#now());
    this.#sweep(now);
    return { pendingBodies: this.#reservations.size, pendingBytes: this.#pendingBytes() };
  }

  #observeNow(nowMs: number): number {
    finiteNonnegative(nowMs, "nowMs");
    this.#observedNowMs = Math.max(this.#observedNowMs, nowMs);
    return this.#observedNowMs;
  }

  #sweep(nowMs: number): void {
    for (const [reservation, retained] of this.#reservations) {
      if (retained.expiresAtMs <= nowMs) this.#reservations.delete(reservation);
    }
  }

  #pendingBytes(): number {
    let bytes = 0;
    for (const retained of this.#reservations.values()) bytes += retained.bytes;
    return bytes;
  }
}

interface PendingBody {
  readonly key: string;
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly identity: string;
  readonly envelope: ChromeBridgeEnvelope;
  readonly chunkCount: number;
  readonly fragments: Map<number, string>;
  readonly expiresAtMs: number;
  readonly reservation: NetworkBodyAssemblyReservation;
  byteCount: number;
}

type SourceEpochFence =
  | { readonly kind: "LEGACY"; faulted: boolean }
  | { readonly kind: "CANONICAL"; readonly sessionId: string; generation: number; faulted: boolean };

export interface NetworkBodyAssemblerOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly maxBodyBytes?: number;
  readonly maxPendingBodiesPerSource?: number;
  readonly maxPendingBodies?: number;
  readonly maxPendingBytesPerSource?: number;
  readonly maxPendingBytes?: number;
  readonly budget?: NetworkBodyAssemblyBudget;
  readonly maxQuarantinedBodiesPerSource?: number;
  readonly maxQuarantinedBodies?: number;
}

export interface NetworkBodyAssemblerStats {
  readonly pendingBodies: number;
  readonly pendingBytes: number;
  readonly quarantinedBodies: number;
  readonly blockedSourceEpochs: number;
}

export class NetworkBodyAssembler {
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxBodyBytes: number;
  readonly #maxPendingBodiesPerSource: number;
  readonly #maxPendingBytesPerSource: number;
  readonly #budget: NetworkBodyAssemblyBudget;
  readonly #pending = new Map<string, PendingBody>();
  // One compact lineage high-watermark per source owned by this decode lane.
  // Lower generations remain retired after reset, expiry, or later admission.
  readonly #epochFenceBySource = new Map<string, SourceEpochFence>();
  #pendingBytes = 0;
  #disposed = false;

  constructor(options: NetworkBodyAssemblerOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = positiveInteger(options.ttlMs, DEFAULT_TTL_MS, "ttlMs");
    this.#maxBodyBytes = positiveInteger(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, "maxBodyBytes");
    this.#maxPendingBodiesPerSource = positiveInteger(options.maxPendingBodiesPerSource,
      DEFAULT_MAX_PENDING_BODIES_PER_SOURCE, "maxPendingBodiesPerSource");
    this.#maxPendingBytesPerSource = positiveInteger(options.maxPendingBytesPerSource,
      DEFAULT_MAX_PENDING_BYTES_PER_SOURCE, "maxPendingBytesPerSource");
    this.#budget = options.budget ?? new NetworkBodyAssemblyBudget({
      ...(options.maxPendingBodies === undefined ? {} : { maxPendingBodies: options.maxPendingBodies }),
      ...(options.maxPendingBytes === undefined ? {} : { maxPendingBytes: options.maxPendingBytes }),
      now: this.#now
    });
  }

  ingest(envelope: ChromeBridgeEnvelope): ChromeBridgeEnvelope | null {
    if (this.#disposed) return null;
    if (envelope.transport !== "HTTP_RESPONSE" || envelope.payload.encoding !== "UTF8") return envelope;
    let raw: unknown;
    try { raw = JSON.parse(envelope.payload.body); } catch { return envelope; }
    const parsed = ChromeNetworkBodyChunkSchema.safeParse(raw);
    // A malformed/oversize value that declares itself as a bridge chunk is
    // never forwarded as provider data. Non-wrapper provider JSON remains a
    // normal single-envelope HTTP response.
    if (!parsed.success) return isPotentialNetworkChunk(raw) ? null : envelope;

    const now = this.#now();
    this.#sweep(now);
    const chunk = parsed.data;
    const sourceEpoch = envelope.sourceEpoch ?? "legacy";
    if (!this.#admitSourceEpoch(envelope.sourceId, envelope.sourceEpoch)) return null;
    const key = bodyKey(envelope.sourceId, sourceEpoch, chunk.snapshotId);

    const identity = assemblyIdentity(envelope);
    let state = this.#pending.get(key);
    let fragmentReserved = false;
    if (state !== undefined && (state.identity !== identity || state.chunkCount !== chunk.chunkCount)) {
      this.#faultSourceEpoch(envelope.sourceId, sourceEpoch);
      return null;
    }

    const fragmentBytes = textEncoder.encode(chunk.bodyFragment).byteLength;
    if (state === undefined) {
      if (fragmentBytes > this.#maxBodyBytes ||
        this.#pendingCount(envelope.sourceId) >= this.#maxPendingBodiesPerSource ||
        this.#pendingByteCount(envelope.sourceId) + fragmentBytes > this.#maxPendingBytesPerSource) {
        this.#faultSourceEpoch(envelope.sourceId, sourceEpoch);
        return null;
      }
      const expiresAtMs = now + this.#ttlMs;
      const reservation = this.#budget.reserve(fragmentBytes, expiresAtMs, now);
      if (reservation === null) return null;
      fragmentReserved = true;
      state = { key, sourceId: envelope.sourceId, sourceEpoch,
        identity, envelope, chunkCount: chunk.chunkCount, fragments: new Map<number, string>(),
        expiresAtMs, reservation, byteCount: 0 };
      this.#pending.set(key, state);
    }

    const prior = state.fragments.get(chunk.chunkIndex);
    if (prior !== undefined) {
      if (prior !== chunk.bodyFragment) this.#faultSourceEpoch(envelope.sourceId, sourceEpoch);
      return null;
    }
    if (state.byteCount + fragmentBytes > this.#maxBodyBytes ||
      this.#pendingByteCount(envelope.sourceId) + fragmentBytes > this.#maxPendingBytesPerSource) {
      this.#faultSourceEpoch(envelope.sourceId, sourceEpoch);
      return null;
    }
    if (!fragmentReserved) {
      const reservationUpdate = this.#budget.update(state.reservation, fragmentBytes,
        state.expiresAtMs, now);
      if (reservationUpdate === "MISSING") {
        this.#faultSourceEpoch(envelope.sourceId, sourceEpoch);
        return null;
      }
      if (reservationUpdate === "PRESSURE") return null;
    }
    state.fragments.set(chunk.chunkIndex, chunk.bodyFragment);
    state.byteCount += fragmentBytes;
    this.#pendingBytes += fragmentBytes;
    if (state.fragments.size !== state.chunkCount) return null;
    const fragments = Array.from({ length: state.chunkCount }, (_, index) => state.fragments.get(index));
    if (fragments.some((fragment) => fragment === undefined)) return null;
    this.#removePending(state);
    return { ...state.envelope, sequence: envelope.sequence,
      payload: { encoding: "UTF8", body: fragments.join("") } };
  }

  stats(): NetworkBodyAssemblerStats {
    this.#sweep(this.#now());
    return { pendingBodies: this.#pending.size, pendingBytes: this.#pendingBytes,
      quarantinedBodies: 0, blockedSourceEpochs: [...this.#epochFenceBySource.values()]
        .filter((fence) => fence.faulted).length };
  }

  resetSource(sourceId: string): void {
    for (const pending of [...this.#pending.values()]) {
      if (pending.sourceId === sourceId) this.#removePending(pending);
    }
    const fence = this.#epochFenceBySource.get(sourceId);
    if (fence !== undefined) fence.faulted = true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of [...this.#pending.values()]) this.#removePending(pending);
    this.#epochFenceBySource.clear();
  }

  #pendingCount(sourceId: string): number {
    let count = 0;
    for (const pending of this.#pending.values()) if (pending.sourceId === sourceId) count += 1;
    return count;
  }

  #pendingByteCount(sourceId: string): number {
    let bytes = 0;
    for (const pending of this.#pending.values()) if (pending.sourceId === sourceId) bytes += pending.byteCount;
    return bytes;
  }

  #removePending(pending: PendingBody): void {
    if (this.#pending.get(pending.key) !== pending) return;
    this.#pending.delete(pending.key);
    this.#pendingBytes -= pending.byteCount;
    this.#budget.release(pending.reservation);
  }

  #faultSourceEpoch(sourceId: string, sourceEpoch: string): void {
    const fence = this.#epochFenceBySource.get(sourceId);
    if (fence !== undefined && fenceMatchesSourceEpoch(fence, sourceEpoch)) fence.faulted = true;
    for (const pending of [...this.#pending.values()]) {
      if (pending.sourceId === sourceId && pending.sourceEpoch === sourceEpoch) this.#removePending(pending);
    }
  }

  #admitSourceEpoch(sourceId: string, sourceEpoch: string | undefined): boolean {
    const proposed = sourceEpoch === undefined
      ? { kind: "LEGACY" as const }
      : canonicalEpoch(sourceEpoch);
    if (proposed === null) return false;
    const current = this.#epochFenceBySource.get(sourceId);
    if (current === undefined) {
      this.#epochFenceBySource.set(sourceId, proposed.kind === "LEGACY"
        ? { kind: "LEGACY", faulted: false }
        : { ...proposed, faulted: false });
      return true;
    }
    if (current.kind !== proposed.kind) return false;
    if (current.kind === "LEGACY" || proposed.kind === "LEGACY") return !current.faulted;
    if (current.sessionId !== proposed.sessionId || proposed.generation < current.generation) return false;
    if (proposed.generation === current.generation) return !current.faulted;
    for (const pending of [...this.#pending.values()]) {
      if (pending.sourceId === sourceId) this.#removePending(pending);
    }
    current.generation = proposed.generation;
    current.faulted = false;
    return true;
  }

  #sweep(now: number): void {
    for (const pending of [...this.#pending.values()]) {
      if (now >= pending.expiresAtMs || !this.#budget.isLive(pending.reservation, now)) {
        this.#faultSourceEpoch(pending.sourceId, pending.sourceEpoch);
      }
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`NETWORK_BODY_${name}_INVALID`);
  return resolved;
}

function nonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`NETWORK_BODY_${name}_INVALID`);
}

function finiteNonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`NETWORK_BODY_${name}_INVALID`);
}

function bodyKey(sourceId: string, sourceEpoch: string, snapshotId: string): string {
  return JSON.stringify([sourceId, sourceEpoch, snapshotId]);
}

function canonicalEpoch(sourceEpoch: string): {
  readonly kind: "CANONICAL";
  readonly sessionId: string;
  readonly generation: number;
} | null {
  const separator = sourceEpoch.lastIndexOf(":");
  if (separator <= 0 || separator === sourceEpoch.length - 1) return null;
  const generationText = sourceEpoch.slice(separator + 1);
  if (!/^(0|[1-9]\d*)$/u.test(generationText)) return null;
  const generation = Number(generationText);
  return Number.isSafeInteger(generation)
    ? { kind: "CANONICAL", sessionId: sourceEpoch.slice(0, separator), generation }
    : null;
}

function fenceMatchesSourceEpoch(fence: SourceEpochFence, sourceEpoch: string): boolean {
  if (fence.kind === "LEGACY") return sourceEpoch === "legacy";
  const candidate = canonicalEpoch(sourceEpoch);
  return candidate !== null && candidate.sessionId === fence.sessionId &&
    candidate.generation === fence.generation;
}

function isPotentialNetworkChunk(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1 && "snapshotId" in candidate && "chunkIndex" in candidate &&
    "chunkCount" in candidate && "bodyFragment" in candidate;
}

function assemblyIdentity(envelope: ChromeBridgeEnvelope): string {
  const request = envelope.request;
  return JSON.stringify([
    envelope.version,
    envelope.kind,
    envelope.lobby,
    envelope.sourceId,
    envelope.sourceEpoch ?? null,
    envelope.tabId,
    envelope.observedAtMs,
    envelope.receivedMonotonicMs,
    envelope.transport,
    Object.entries(request).sort(([left], [right]) => left.localeCompare(right))
  ]);
}
