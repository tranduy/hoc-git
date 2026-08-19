import { ChromeNetworkBodyChunkSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";

interface PendingBody {
  readonly sourceId: string;
  readonly requestKey: string;
  readonly chunkCount: number;
  readonly fragments: Map<number, string>;
  readonly firstObservedAtMs: number;
}

export class NetworkBodyAssembler {
  readonly #pending = new Map<string, PendingBody>();

  ingest(envelope: ChromeBridgeEnvelope): ChromeBridgeEnvelope | null {
    if (envelope.transport !== "HTTP_RESPONSE" || envelope.payload.encoding !== "UTF8") return envelope;
    let raw: unknown;
    try { raw = JSON.parse(envelope.payload.body); } catch { return envelope; }
    const parsed = ChromeNetworkBodyChunkSchema.safeParse(raw);
    if (!parsed.success) return envelope;
    const chunk = parsed.data;
    const requestKey = `${envelope.request.hostname}|${envelope.request.pathnameClass}|${envelope.request.resourceType}`;
    const current = this.#pending.get(chunk.snapshotId);
    if (current !== undefined && (current.sourceId !== envelope.sourceId || current.requestKey !== requestKey ||
      current.chunkCount !== chunk.chunkCount)) {
      this.#pending.delete(chunk.snapshotId);
      return null;
    }
    const state = current ?? { sourceId: envelope.sourceId, requestKey, chunkCount: chunk.chunkCount,
      fragments: new Map<number, string>(), firstObservedAtMs: envelope.observedAtMs };
    const prior = state.fragments.get(chunk.chunkIndex);
    if (prior !== undefined && prior !== chunk.bodyFragment) {
      this.#pending.delete(chunk.snapshotId);
      return null;
    }
    state.fragments.set(chunk.chunkIndex, chunk.bodyFragment);
    this.#pending.set(chunk.snapshotId, state);
    if (state.fragments.size !== state.chunkCount) return null;
    const fragments = Array.from({ length: state.chunkCount }, (_, index) => state.fragments.get(index));
    if (fragments.some((fragment) => fragment === undefined)) return null;
    this.#pending.delete(chunk.snapshotId);
    return { ...envelope, observedAtMs: state.firstObservedAtMs,
      payload: { encoding: "UTF8", body: fragments.join("") } };
  }

  resetSource(sourceId: string): void {
    for (const [snapshotId, pending] of this.#pending) {
      if (pending.sourceId === sourceId) this.#pending.delete(snapshotId);
    }
  }
}
