interface PendingJob {
  readonly bytes: number;
  operation: (() => Promise<void>) | null;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

interface SourceLane {
  readonly pending: PendingJob[];
  bytes: number;
  active: boolean;
}

/** A bounded FIFO with cancellation that releases queued closures immediately.
 * Clearing a generation never opens a second physical lane behind a hung head.
 */
export class PendingSourceWork {
  readonly #lanes = new Map<string, SourceLane>();
  readonly #maxBytes: number;
  readonly #maxEntries: number;

  constructor(options: { readonly maxBytes: number; readonly maxEntries: number }) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0 ||
      !Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new Error("PENDING_SOURCE_WORK_BOUNDS_INVALID");
    }
    this.#maxBytes = options.maxBytes;
    this.#maxEntries = options.maxEntries;
  }

  keys(): IterableIterator<string> { return this.#lanes.keys(); }

  usage(sourceId: string): { readonly bytes: number; readonly entries: number } {
    const lane = this.#lanes.get(sourceId);
    return { bytes: lane?.bytes ?? 0, entries: lane === undefined ? 0 :
      lane.pending.length + Number(lane.active) };
  }

  /** null means no work was retained; the caller must retire/resync its stream. */
  enqueue(sourceId: string, bytes: number, operation: () => Promise<void>): Promise<void> | null {
    const current = this.usage(sourceId);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || current.bytes + bytes > this.#maxBytes ||
      current.entries >= this.#maxEntries) return null;
    const lane = this.#lanes.get(sourceId) ?? { pending: [], bytes: 0, active: false };
    this.#lanes.set(sourceId, lane);
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    lane.pending.push({ bytes, operation, resolve, reject });
    lane.bytes += bytes;
    if (!lane.active) void this.#drain(sourceId, lane);
    return completion;
  }

  clear(sourceId: string): void {
    const lane = this.#lanes.get(sourceId);
    if (lane === undefined) return;
    for (const job of lane.pending.splice(0)) {
      lane.bytes -= job.bytes;
      job.operation = null;
      job.resolve();
    }
    if (!lane.active) this.#lanes.delete(sourceId);
  }

  async #drain(sourceId: string, lane: SourceLane): Promise<void> {
    lane.active = true;
    while (lane.pending.length > 0) {
      const job = lane.pending.shift()!;
      try {
        // Match the observer's existing promise-lane admission timing.
        await Promise.resolve();
        const operation = job.operation!();
        job.operation = null;
        await operation;
        job.resolve();
      } catch (error) {
        job.operation = null;
        job.reject(error);
      } finally {
        lane.bytes -= job.bytes;
      }
    }
    lane.active = false;
    if (this.#lanes.get(sourceId) === lane) this.#lanes.delete(sourceId);
  }
}

/** Conservative retained-string weight, plus object/entry overhead. Stops at the
 * admission bound without allocating a second serialized copy of a large frame.
 */
export function retainedPayloadBytes(value: unknown, limit: number): number {
  let bytes = 256;
  const seen = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (bytes > limit) return;
    if (typeof item === "string") { bytes += item.length * 2 + 16; return; }
    if (item === null || typeof item !== "object") { bytes += 16; return; }
    if (seen.has(item)) return;
    if (depth > 32) { bytes = limit + 1; return; }
    seen.add(item);
    bytes += 64;
    for (const key in item) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
      bytes += key.length * 2 + 16;
      visit((item as Record<string, unknown>)[key], depth + 1);
      if (bytes > limit) return;
    }
  };
  visit(value, 0);
  return bytes;
}
