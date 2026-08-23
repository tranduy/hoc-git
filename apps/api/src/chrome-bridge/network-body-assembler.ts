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
}

export interface NetworkBodyAssemblyBudgetStats {
  readonly pendingBodies: number;
  readonly pendingBytes: number;
}

export class NetworkBodyAssemblyBudget {
  readonly #maxPendingBodies: number;
  readonly #maxPendingBytes: number;
  #pendingBodies = 0;
  #pendingBytes = 0;

  constructor(options: NetworkBodyAssemblyBudgetOptions = {}) {
    this.#maxPendingBodies = positiveInteger(options.maxPendingBodies,
      DEFAULT_MAX_PENDING_BODIES, "maxPendingBodies");
    this.#maxPendingBytes = positiveInteger(options.maxPendingBytes,
      DEFAULT_MAX_PENDING_BYTES, "maxPendingBytes");
  }

  tryReserve(bodyCount: number, byteCount: number): boolean {
    nonnegativeInteger(bodyCount, "bodyCount");
    nonnegativeInteger(byteCount, "byteCount");
    if (this.#pendingBodies + bodyCount > this.#maxPendingBodies ||
      this.#pendingBytes + byteCount > this.#maxPendingBytes) return false;
    this.#pendingBodies += bodyCount;
    this.#pendingBytes += byteCount;
    return true;
  }

  release(bodyCount: number, byteCount: number): void {
    nonnegativeInteger(bodyCount, "bodyCount");
    nonnegativeInteger(byteCount, "byteCount");
    if (bodyCount > this.#pendingBodies || byteCount > this.#pendingBytes) {
      throw new Error("NETWORK_BODY_BUDGET_RELEASE_UNDERFLOW");
    }
    this.#pendingBodies -= bodyCount;
    this.#pendingBytes -= byteCount;
  }

  stats(): NetworkBodyAssemblyBudgetStats {
    return { pendingBodies: this.#pendingBodies, pendingBytes: this.#pendingBytes };
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
  readonly createdAtMs: number;
  byteCount: number;
}

interface FaultedSourceEpoch {
  readonly sourceId: string;
  readonly sourceEpoch: string;
}

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
  // One exact fault bit and epoch watermark per source in this decode lane.
  // Fragment expiry releases memory but never re-admits the faulted epoch.
  readonly #faultedBySource = new Map<string, FaultedSourceEpoch>();
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
      ...(options.maxPendingBytes === undefined ? {} : { maxPendingBytes: options.maxPendingBytes })
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
    const key = bodyKey(envelope.sourceId, sourceEpoch, chunk.snapshotId);
    this.#releaseRetiredFault(envelope.sourceId, sourceEpoch);
    if (this.#faultedBySource.has(envelope.sourceId)) return null;

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
      if (!this.#budget.tryReserve(1, fragmentBytes)) {
        this.#faultSourceEpoch(envelope.sourceId, sourceEpoch);
        return null;
      }
      fragmentReserved = true;
      state = { key, sourceId: envelope.sourceId, sourceEpoch,
        identity, envelope, chunkCount: chunk.chunkCount, fragments: new Map<number, string>(),
        createdAtMs: now, byteCount: 0 };
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
    if (!fragmentReserved && !this.#budget.tryReserve(0, fragmentBytes)) {
      this.#faultSourceEpoch(envelope.sourceId, sourceEpoch);
      return null;
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
      quarantinedBodies: 0, blockedSourceEpochs: this.#faultedBySource.size };
  }

  resetSource(sourceId: string): void {
    for (const pending of [...this.#pending.values()]) {
      if (pending.sourceId === sourceId) this.#removePending(pending);
    }
    this.#faultedBySource.delete(sourceId);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of [...this.#pending.values()]) this.#removePending(pending);
    this.#faultedBySource.clear();
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
    this.#budget.release(1, pending.byteCount);
  }

  #faultSourceEpoch(sourceId: string, sourceEpoch: string): void {
    if (!this.#faultedBySource.has(sourceId)) {
      this.#faultedBySource.set(sourceId, { sourceId, sourceEpoch });
    }
    for (const pending of [...this.#pending.values()]) {
      if (pending.sourceId === sourceId && pending.sourceEpoch === sourceEpoch) this.#removePending(pending);
    }
  }

  #releaseRetiredFault(sourceId: string, sourceEpoch: string): void {
    const faulted = this.#faultedBySource.get(sourceId);
    if (faulted !== undefined && isStrictlyNewerEpoch(faulted.sourceEpoch, sourceEpoch)) {
      this.#faultedBySource.delete(sourceId);
    }
  }

  #sweep(now: number): void {
    for (const pending of [...this.#pending.values()]) {
      if (now - pending.createdAtMs >= this.#ttlMs) {
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

function bodyKey(sourceId: string, sourceEpoch: string, snapshotId: string): string {
  return JSON.stringify([sourceId, sourceEpoch, snapshotId]);
}

function canonicalEpoch(sourceEpoch: string): { readonly lineage: string; readonly generation: number } | null {
  const match = /^(.+):(0|[1-9]\d*)$/u.exec(sourceEpoch);
  if (match === null) return null;
  const generation = Number(match[2]);
  return Number.isSafeInteger(generation) ? { lineage: match[1]!, generation } : null;
}

function isStrictlyNewerEpoch(previous: string, candidate: string): boolean {
  const left = canonicalEpoch(previous);
  const right = canonicalEpoch(candidate);
  return left !== null && right !== null && left.lineage === right.lineage &&
    right.generation > left.generation;
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
