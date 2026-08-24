import { ChromeNetworkBodyChunkSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { AuthorityLaneToken } from "./provider-authority-types.js";

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_BODY_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_PENDING_BODIES_PER_SOURCE = 8;
const DEFAULT_MAX_PENDING_BODIES = DEFAULT_MAX_PENDING_BODIES_PER_SOURCE * 6;
const DEFAULT_MAX_PENDING_BYTES_PER_SOURCE = DEFAULT_MAX_BODY_BYTES;
const DEFAULT_MAX_PENDING_BYTES = DEFAULT_MAX_PENDING_BYTES_PER_SOURCE * 6;
const MAX_SOURCE_LINEAGES = 8;
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

  now(): number {
    return this.#observeNow(this.#now());
  }

  reserve(byteCount: number, ttlMs: number): NetworkBodyAssemblyReservation | null {
    nonnegativeInteger(byteCount, "byteCount");
    positiveIntegerValue(ttlMs, "ttlMs");
    const now = this.now();
    this.#sweep(now);
    if (this.#reservations.size >= this.#maxPendingBodies ||
      this.#pendingBytes() + byteCount > this.#maxPendingBytes) return null;
    const expiresAtMs = deadline(now, ttlMs);
    const reservation = Object.freeze({
      kind: "NETWORK_BODY_ASSEMBLY_RESERVATION" as const
    });
    this.#reservations.set(reservation, { bytes: byteCount, expiresAtMs });
    return reservation;
  }

  update(reservation: NetworkBodyAssemblyReservation, additionalBytes: number,
    ttlMs: number): NetworkBodyAssemblyReservationUpdate {
    nonnegativeInteger(additionalBytes, "additionalBytes");
    positiveIntegerValue(ttlMs, "ttlMs");
    const now = this.now();
    this.#sweep(now);
    const retained = this.#reservations.get(reservation);
    if (retained === undefined) return "MISSING";
    if (this.#pendingBytes() + additionalBytes > this.#maxPendingBytes) return "PRESSURE";
    retained.bytes += additionalBytes;
    retained.expiresAtMs = deadline(now, ttlMs);
    return "ACCEPTED";
  }

  isLive(reservation: NetworkBodyAssemblyReservation): boolean {
    const now = this.now();
    this.#sweep(now);
    return this.#reservations.has(reservation);
  }

  release(reservation: NetworkBodyAssemblyReservation): void {
    this.#reservations.delete(reservation);
  }

  stats(): NetworkBodyAssemblyBudgetStats {
    const now = this.now();
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
  readonly reservation: NetworkBodyAssemblyReservation;
  byteCount: number;
}

type SourceEpochFence =
  | { readonly kind: "LEGACY"; faulted: boolean }
  | { readonly kind: "CANONICAL"; readonly sessionId: string; generation: number; faulted: boolean };

export interface NetworkBodyAssemblerOptions {
  readonly laneToken?: AuthorityLaneToken;
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
  readonly #authorityLaneToken: AuthorityLaneToken | null;
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
    if (options.laneToken !== undefined && !Object.isFrozen(options.laneToken)) {
      throw new Error("NETWORK_BODY_laneToken_MUTABLE");
    }
    this.#authorityLaneToken = options.laneToken ?? null;
    this.#ttlMs = positiveInteger(options.ttlMs, DEFAULT_TTL_MS, "ttlMs");
    this.#maxBodyBytes = positiveInteger(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, "maxBodyBytes");
    this.#maxPendingBodiesPerSource = positiveInteger(options.maxPendingBodiesPerSource,
      DEFAULT_MAX_PENDING_BODIES_PER_SOURCE, "maxPendingBodiesPerSource");
    this.#maxPendingBytesPerSource = positiveInteger(options.maxPendingBytesPerSource,
      DEFAULT_MAX_PENDING_BYTES_PER_SOURCE, "maxPendingBytesPerSource");
    this.#budget = options.budget ?? new NetworkBodyAssemblyBudget({
      ...(options.maxPendingBodies === undefined ? {} : { maxPendingBodies: options.maxPendingBodies }),
      ...(options.maxPendingBytes === undefined ? {} : { maxPendingBytes: options.maxPendingBytes }),
      now: options.now ?? Date.now
    });
  }

  get authorityLaneToken(): AuthorityLaneToken | null {
    return this.#authorityLaneToken;
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
    if (!parsed.success) {
      if (!isPotentialNetworkChunk(raw)) return envelope;
      this.#faultDeclaredSourceEpoch(envelope.sourceId, envelope.sourceEpoch);
      return null;
    }

    this.#sweep();
    const chunk = parsed.data;
    const sourceEpoch = envelope.sourceEpoch ?? "legacy";
    const admission = this.#sourceEpochAdmission(envelope.sourceId, envelope.sourceEpoch);
    if (admission === "REJECTED") return null;
    const observerRequestId = "observerRequestId" in envelope.request &&
      typeof envelope.request.observerRequestId === "string"
      ? envelope.request.observerRequestId : "legacy-request";
    const key = bodyKey(envelope.sourceId, sourceEpoch,
      observerRequestId, chunk.snapshotId);

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
        this.#faultAdmittedSourceEpoch(envelope.sourceId, envelope.sourceEpoch, admission);
        return null;
      }
      const reservation = this.#budget.reserve(fragmentBytes, this.#ttlMs);
      if (reservation === null) return null;
      if (!this.#commitSourceEpoch(envelope.sourceId, envelope.sourceEpoch, admission)) {
        this.#budget.release(reservation);
        return null;
      }
      fragmentReserved = true;
      state = { key, sourceId: envelope.sourceId, sourceEpoch,
        identity, envelope, chunkCount: chunk.chunkCount, fragments: new Map<number, string>(),
        reservation, byteCount: 0 };
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
      const reservationUpdate = this.#budget.update(state.reservation, fragmentBytes, this.#ttlMs);
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
    this.#sweep();
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

  #faultDeclaredSourceEpoch(sourceId: string, sourceEpoch: string | undefined): void {
    const admission = this.#sourceEpochAdmission(sourceId, sourceEpoch);
    if (admission === "REJECTED" || !this.#commitSourceEpoch(sourceId, sourceEpoch, admission)) return;
    this.#faultSourceEpoch(sourceId, sourceEpoch ?? "legacy");
  }

  #faultAdmittedSourceEpoch(sourceId: string, sourceEpoch: string | undefined,
    admission: "CURRENT" | "ADVANCE" | "NEW"): void {
    if (!this.#commitSourceEpoch(sourceId, sourceEpoch, admission)) return;
    this.#faultSourceEpoch(sourceId, sourceEpoch ?? "legacy");
  }

  #sourceEpochAdmission(sourceId: string, sourceEpoch: string | undefined):
    "CURRENT" | "ADVANCE" | "NEW" | "REJECTED" {
    const proposed = sourceEpoch === undefined
      ? { kind: "LEGACY" as const }
      : canonicalEpoch(sourceEpoch);
    if (proposed === null) return "REJECTED";
    const current = this.#epochFenceBySource.get(sourceId);
    if (current === undefined) return this.#epochFenceBySource.size < MAX_SOURCE_LINEAGES ? "NEW" : "REJECTED";
    if (current.kind !== proposed.kind) return "REJECTED";
    if (current.kind === "LEGACY" || proposed.kind === "LEGACY") return current.faulted ? "REJECTED" : "CURRENT";
    if (current.sessionId !== proposed.sessionId || proposed.generation < current.generation) return "REJECTED";
    if (proposed.generation === current.generation) return current.faulted ? "REJECTED" : "CURRENT";
    return "ADVANCE";
  }

  #commitSourceEpoch(sourceId: string, sourceEpoch: string | undefined,
    admission: "CURRENT" | "ADVANCE" | "NEW"): boolean {
    if (admission === "CURRENT") return true;
    const proposed = sourceEpoch === undefined
      ? { kind: "LEGACY" as const }
      : canonicalEpoch(sourceEpoch);
    if (proposed === null) return false;
    if (admission === "NEW") {
      if (this.#epochFenceBySource.has(sourceId) || this.#epochFenceBySource.size >= MAX_SOURCE_LINEAGES) return false;
      this.#epochFenceBySource.set(sourceId, proposed.kind === "LEGACY"
        ? { kind: "LEGACY", faulted: false }
        : { ...proposed, faulted: false });
      return true;
    }
    const current = this.#epochFenceBySource.get(sourceId);
    if (current?.kind !== "CANONICAL" || proposed.kind !== "CANONICAL" ||
      current.sessionId !== proposed.sessionId || proposed.generation <= current.generation) return false;
    for (const pending of [...this.#pending.values()]) {
      if (pending.sourceId === sourceId) this.#removePending(pending);
    }
    current.generation = proposed.generation;
    current.faulted = false;
    return true;
  }

  #sweep(): void {
    for (const pending of [...this.#pending.values()]) {
      if (!this.#budget.isLive(pending.reservation)) {
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

function positiveIntegerValue(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`NETWORK_BODY_${name}_INVALID`);
}

function finiteNonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`NETWORK_BODY_${name}_INVALID`);
}

function deadline(nowMs: number, ttlMs: number): number {
  const expiresAtMs = nowMs + ttlMs;
  finiteNonnegative(expiresAtMs, "expiresAtMs");
  return expiresAtMs;
}

function bodyKey(sourceId: string, sourceEpoch: string, observerRequestId: string, snapshotId: string): string {
  return JSON.stringify([sourceId, sourceEpoch, observerRequestId, snapshotId]);
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
  return candidate.schemaVersion === 1 && ["snapshotId", "chunkIndex", "chunkCount", "bodyEncoding", "bodyFragment"]
    .some((field) => field in candidate);
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
