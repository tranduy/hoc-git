import type { CmdSnapshotChunk } from "@tool-chenh/contracts";

type PendingSnapshot = {
  readonly chunkCount: number;
  readonly sweepMetadataFingerprint: string;
  readonly firstSeenMs: number;
  readonly chunks: Map<number, { readonly fingerprint: string; readonly records: readonly unknown[]; readonly bytes: number }>;
  bytes: number;
};

export type CmdSnapshotAssemblerOptions = {
  readonly ttlMs?: number;
  readonly maxBufferedBytes?: number;
};

const keyOf = (sourceId: string, snapshotId: string) => `${sourceId}\u0000${snapshotId}`;

export class CmdSnapshotAssembler {
  readonly #ttlMs: number;
  readonly #maxBufferedBytes: number;
  readonly #pending = new Map<string, PendingSnapshot>();
  readonly #closedUntil = new Map<string, number>();
  readonly #latestGenerationBySource = new Map<string, { readonly observedAtMs: number; readonly snapshotId: string }>();

  constructor(options: CmdSnapshotAssemblerOptions = {}) {
    this.#ttlMs = options.ttlMs ?? 10_000;
    this.#maxBufferedBytes = options.maxBufferedBytes ?? 20 * 1024 * 1024;
  }

  ingest(sourceId: string, chunk: CmdSnapshotChunk, receivedAtMs: number,
    generationObservedAtMs = receivedAtMs): readonly unknown[] | null {
    this.#expire(receivedAtMs);
    const key = keyOf(sourceId, chunk.snapshotId);
    if ((this.#closedUntil.get(key) ?? 0) > receivedAtMs) return null;

    const latest = this.#latestGenerationBySource.get(sourceId);
    if (latest && generationObservedAtMs < latest.observedAtMs) return null;
    if (!latest || generationObservedAtMs > latest.observedAtMs ||
      (generationObservedAtMs === latest.observedAtMs && chunk.snapshotId !== latest.snapshotId)) {
      const prefix = `${sourceId}\u0000`;
      for (const pendingKey of this.#pending.keys()) {
        if (pendingKey.startsWith(prefix)) this.#pending.delete(pendingKey);
      }
      this.#latestGenerationBySource.set(sourceId, { observedAtMs: generationObservedAtMs,
        snapshotId: chunk.snapshotId });
    }

    let pending = this.#pending.get(key);
    const sweepMetadataFingerprint = JSON.stringify([
      chunk.sweepId ?? null,
      chunk.sweepComplete ?? null,
      chunk.sweepFrameKey ?? null,
      chunk.sweepDocumentKey ?? null
    ]);
    if (!pending) {
      pending = { chunkCount: chunk.chunkCount, sweepMetadataFingerprint,
        firstSeenMs: receivedAtMs, chunks: new Map(), bytes: 0 };
      this.#pending.set(key, pending);
    } else if (pending.chunkCount !== chunk.chunkCount ||
      pending.sweepMetadataFingerprint !== sweepMetadataFingerprint) {
      this.#reject(key, receivedAtMs);
      return null;
    }

    const fingerprint = JSON.stringify(chunk.records);
    const existing = pending.chunks.get(chunk.chunkIndex);
    if (existing) {
      if (existing.fingerprint !== fingerprint) this.#reject(key, receivedAtMs);
      return null;
    }

    const bytes = new TextEncoder().encode(fingerprint).byteLength;
    if (pending.bytes + bytes > this.#maxBufferedBytes) {
      this.#reject(key, receivedAtMs);
      return null;
    }
    pending.chunks.set(chunk.chunkIndex, { fingerprint, records: chunk.records, bytes });
    pending.bytes += bytes;
    if (pending.chunks.size !== pending.chunkCount) return null;

    const records: unknown[] = [];
    for (let index = 0; index < pending.chunkCount; index += 1) {
      const part = pending.chunks.get(index);
      if (!part) return null;
      records.push(...part.records);
    }
    this.#pending.delete(key);
    this.#closedUntil.set(key, receivedAtMs + this.#ttlMs);
    return records;
  }

  resetSource(sourceId: string): void {
    const prefix = `${sourceId}\u0000`;
    for (const key of this.#pending.keys()) if (key.startsWith(prefix)) this.#pending.delete(key);
    for (const key of this.#closedUntil.keys()) if (key.startsWith(prefix)) this.#closedUntil.delete(key);
    this.#latestGenerationBySource.delete(sourceId);
  }

  #reject(key: string, nowMs: number): void {
    this.#pending.delete(key);
    this.#closedUntil.set(key, nowMs + this.#ttlMs);
  }

  #expire(nowMs: number): void {
    for (const [key, pending] of this.#pending) {
      if (nowMs - pending.firstSeenMs > this.#ttlMs) this.#reject(key, nowMs);
    }
    for (const [key, until] of this.#closedUntil) {
      if (until <= nowMs) this.#closedUntil.delete(key);
    }
  }
}
