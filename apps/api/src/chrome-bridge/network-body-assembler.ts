import { ChromeNetworkBodyChunkSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { chromeBridgeAccountKeyForLobby, type ChromeBridgeAccountKey } from "./chrome-bridge-account.js";

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_BODY_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_PENDING_BODIES_PER_SOURCE = 8;
const DEFAULT_MAX_PENDING_BODIES = DEFAULT_MAX_PENDING_BODIES_PER_SOURCE * 6;
const DEFAULT_MAX_PENDING_BYTES_PER_SOURCE = DEFAULT_MAX_BODY_BYTES;
const DEFAULT_MAX_PENDING_BYTES = DEFAULT_MAX_PENDING_BYTES_PER_SOURCE * 6;
const textEncoder = new TextEncoder();

interface PendingBody {
  readonly key: string;
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly epochKey: string;
  readonly accountKey: ChromeBridgeAccountKey;
  readonly identity: string;
  readonly envelope: ChromeBridgeEnvelope;
  readonly chunkCount: number;
  readonly fragments: Map<number, string>;
  readonly createdAtMs: number;
  byteCount: number;
}

interface QuarantinedBody {
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly epochKey: string;
  readonly accountKey: ChromeBridgeAccountKey;
}

interface BlockedSourceEpoch {
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
  readonly #maxPendingBodies: number;
  readonly #maxPendingBytesPerSource: number;
  readonly #maxPendingBytes: number;
  readonly #maxQuarantinedBodiesPerSource: number;
  readonly #maxQuarantinedBodies: number;
  readonly #pending = new Map<string, PendingBody>();
  readonly #snapshotOwners = new Map<string, string>();
  readonly #quarantined = new Map<string, QuarantinedBody>();
  // One escalated fence per provider account bounds rejection state even if a
  // peer rotates infinitely many snapshot IDs. It is released only by explicit
  // reset/recovery or a strictly newer canonical source epoch.
  readonly #blockedByAccount = new Map<ChromeBridgeAccountKey, BlockedSourceEpoch>();
  #pendingBytes = 0;

  constructor(options: NetworkBodyAssemblerOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = positiveInteger(options.ttlMs, DEFAULT_TTL_MS, "ttlMs");
    this.#maxBodyBytes = positiveInteger(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, "maxBodyBytes");
    this.#maxPendingBodiesPerSource = positiveInteger(options.maxPendingBodiesPerSource,
      DEFAULT_MAX_PENDING_BODIES_PER_SOURCE, "maxPendingBodiesPerSource");
    this.#maxPendingBodies = positiveInteger(options.maxPendingBodies,
      DEFAULT_MAX_PENDING_BODIES, "maxPendingBodies");
    this.#maxPendingBytesPerSource = positiveInteger(options.maxPendingBytesPerSource,
      DEFAULT_MAX_PENDING_BYTES_PER_SOURCE, "maxPendingBytesPerSource");
    this.#maxPendingBytes = positiveInteger(options.maxPendingBytes,
      DEFAULT_MAX_PENDING_BYTES, "maxPendingBytes");
    this.#maxQuarantinedBodiesPerSource = positiveInteger(options.maxQuarantinedBodiesPerSource,
      this.#maxPendingBodiesPerSource, "maxQuarantinedBodiesPerSource");
    this.#maxQuarantinedBodies = positiveInteger(options.maxQuarantinedBodies,
      this.#maxPendingBodies, "maxQuarantinedBodies");
  }

  ingest(envelope: ChromeBridgeEnvelope): ChromeBridgeEnvelope | null {
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
    const epochKey = sourceEpochKey(envelope.sourceId, sourceEpoch);
    const accountKey = chromeBridgeAccountKeyForLobby(envelope.lobby);
    const key = bodyKey(envelope.sourceId, sourceEpoch, chunk.snapshotId);
    this.#releaseRetiredFences(accountKey, sourceEpoch);
    if (this.#blockedByAccount.has(accountKey) || this.#quarantined.has(key)) return null;

    // snapshotId is producer request/document identity. If it appears under a
    // different authority scope while still pending, quarantine both exact
    // scopes rather than allowing either half to complete.
    const snapshotOwnerKey = this.#snapshotOwners.get(chunk.snapshotId);
    if (snapshotOwnerKey !== undefined && snapshotOwnerKey !== key) {
      const snapshotOwner = this.#pending.get(snapshotOwnerKey);
      if (snapshotOwner !== undefined) this.#quarantinePending(snapshotOwner);
      this.#quarantine(key, envelope.sourceId, sourceEpoch, epochKey, accountKey);
      return null;
    }

    const identity = assemblyIdentity(envelope);
    let state = this.#pending.get(key);
    if (state !== undefined && (state.identity !== identity || state.chunkCount !== chunk.chunkCount)) {
      this.#quarantinePending(state);
      return null;
    }

    const fragmentBytes = textEncoder.encode(chunk.bodyFragment).byteLength;
    if (state === undefined) {
      if (fragmentBytes > this.#maxBodyBytes ||
        this.#pending.size >= this.#maxPendingBodies ||
        this.#pendingCount(envelope.sourceId) >= this.#maxPendingBodiesPerSource ||
        this.#pendingBytes + fragmentBytes > this.#maxPendingBytes ||
        this.#pendingByteCount(envelope.sourceId) + fragmentBytes > this.#maxPendingBytesPerSource) {
        this.#quarantine(key, envelope.sourceId, sourceEpoch, epochKey, accountKey);
        return null;
      }
      state = { key, snapshotId: chunk.snapshotId, sourceId: envelope.sourceId, sourceEpoch, epochKey,
        accountKey, identity, envelope, chunkCount: chunk.chunkCount, fragments: new Map<number, string>(),
        createdAtMs: now, byteCount: 0 };
      this.#pending.set(key, state);
      this.#snapshotOwners.set(chunk.snapshotId, key);
    }

    const prior = state.fragments.get(chunk.chunkIndex);
    if (prior !== undefined) {
      if (prior !== chunk.bodyFragment) this.#quarantinePending(state);
      return null;
    }
    if (state.byteCount + fragmentBytes > this.#maxBodyBytes ||
      this.#pendingBytes + fragmentBytes > this.#maxPendingBytes ||
      this.#pendingByteCount(envelope.sourceId) + fragmentBytes > this.#maxPendingBytesPerSource) {
      this.#quarantinePending(state);
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
      quarantinedBodies: this.#quarantined.size, blockedSourceEpochs: this.#blockedByAccount.size };
  }

  resetSource(sourceId: string): void {
    for (const pending of [...this.#pending.values()]) {
      if (pending.sourceId === sourceId) this.#removePending(pending);
    }
    for (const [key, quarantined] of this.#quarantined) {
      if (quarantined.sourceId === sourceId) this.#quarantined.delete(key);
    }
    for (const [accountKey, blocked] of this.#blockedByAccount) {
      if (blocked.sourceId === sourceId) this.#blockedByAccount.delete(accountKey);
    }
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

  #quarantinedCount(sourceId: string): number {
    let count = 0;
    for (const body of this.#quarantined.values()) if (body.sourceId === sourceId) count += 1;
    return count;
  }

  #removePending(pending: PendingBody): void {
    if (this.#pending.get(pending.key) !== pending) return;
    this.#pending.delete(pending.key);
    this.#pendingBytes -= pending.byteCount;
    if (this.#snapshotOwners.get(pending.snapshotId) === pending.key) {
      this.#snapshotOwners.delete(pending.snapshotId);
    }
  }

  #quarantinePending(pending: PendingBody): void {
    this.#removePending(pending);
    this.#quarantine(pending.key, pending.sourceId, pending.sourceEpoch, pending.epochKey,
      pending.accountKey);
  }

  #quarantine(key: string, sourceId: string, sourceEpoch: string, epochKey: string,
    accountKey: ChromeBridgeAccountKey): void {
    if (this.#quarantined.has(key) || this.#blockedByAccount.has(accountKey)) return;
    if (this.#quarantined.size >= this.#maxQuarantinedBodies ||
      this.#quarantinedCount(sourceId) >= this.#maxQuarantinedBodiesPerSource) {
      this.#blockSourceEpoch(accountKey, sourceId, sourceEpoch);
      return;
    }
    this.#quarantined.set(key, { sourceId, sourceEpoch, epochKey, accountKey });
  }

  #blockSourceEpoch(accountKey: ChromeBridgeAccountKey, sourceId: string,
    sourceEpoch: string): void {
    if (!this.#blockedByAccount.has(accountKey)) {
      this.#blockedByAccount.set(accountKey, { sourceId, sourceEpoch });
    }
    // Escalation replaces many exact tombstones with one bounded epoch fence.
    for (const pending of [...this.#pending.values()]) {
      if (pending.accountKey === accountKey) this.#removePending(pending);
    }
    for (const [key, quarantined] of this.#quarantined) {
      if (quarantined.accountKey === accountKey) this.#quarantined.delete(key);
    }
  }

  #releaseRetiredFences(accountKey: ChromeBridgeAccountKey, sourceEpoch: string): void {
    const blocked = this.#blockedByAccount.get(accountKey);
    if (blocked !== undefined && isStrictlyNewerEpoch(blocked.sourceEpoch, sourceEpoch)) {
      this.#blockedByAccount.delete(accountKey);
    }
    for (const [key, quarantined] of this.#quarantined) {
      if (quarantined.accountKey === accountKey &&
        isStrictlyNewerEpoch(quarantined.sourceEpoch, sourceEpoch)) this.#quarantined.delete(key);
    }
  }

  #sweep(now: number): void {
    for (const pending of [...this.#pending.values()]) {
      if (now - pending.createdAtMs >= this.#ttlMs) this.#quarantinePending(pending);
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`NETWORK_BODY_${name}_INVALID`);
  return resolved;
}

function sourceEpochKey(sourceId: string, sourceEpoch: string): string {
  return JSON.stringify([sourceId, sourceEpoch]);
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
    request.hostname,
    request.pathnameClass,
    request.resourceType,
    request.streamId ?? null,
    request.providerPartition ?? null,
    request.providerFunctionCode ?? null,
    request.reconcileCutoffSequence ?? null,
    request.replayed ?? null
  ]);
}
