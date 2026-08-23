export interface ProviderWorkSchedulerOptions {
  readonly maxConcurrent?: number;
  readonly maxQueuedPerSource?: number;
  readonly onRejected?: (error: ProviderWorkQueueFullError) => void;
}

export class ProviderWorkQueueFullError extends Error {
  readonly code = "PROVIDER_WORK_QUEUE_FULL" as const;
  readonly sourceId: string;

  constructor(sourceId: string) {
    super(`Provider work queue is full for ${sourceId}`);
    this.name = "ProviderWorkQueueFullError";
    this.sourceId = sourceId;
  }
}

export class ProviderWorkClearedError extends Error {
  readonly code = "PROVIDER_WORK_CLEARED" as const;
  readonly sourceId: string;

  constructor(sourceId: string) {
    super(`Provider work queue was cleared for ${sourceId}`);
    this.name = "ProviderWorkClearedError";
    this.sourceId = sourceId;
  }
}

interface QueuedWork<T = unknown> {
  readonly operation: () => Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

interface ProviderLane {
  active: boolean;
  readonly queue: QueuedWork[];
}

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_QUEUED_PER_SOURCE = 1;

export class ProviderWorkScheduler {
  readonly #maxConcurrent: number;
  readonly #maxQueuedPerSource: number;
  readonly #onRejected: ((error: ProviderWorkQueueFullError) => void) | null;
  readonly #lanes = new Map<string, ProviderLane>();
  readonly #readySources: string[] = [];
  readonly #readySourceSet = new Set<string>();
  #activeCount = 0;

  constructor(options: ProviderWorkSchedulerOptions = {}) {
    this.#maxConcurrent = positiveInteger(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      "PROVIDER_WORK_MAX_CONCURRENT_INVALID");
    this.#maxQueuedPerSource = positiveInteger(
      options.maxQueuedPerSource ?? DEFAULT_MAX_QUEUED_PER_SOURCE,
      "PROVIDER_WORK_MAX_QUEUED_INVALID"
    );
    this.#onRejected = options.onRejected ?? null;
  }

  run<T>(sourceId: string, operation: () => Promise<T>): Promise<T> {
    if (!sourceId.trim()) return Promise.reject(new Error("PROVIDER_WORK_SOURCE_REQUIRED"));
    const lane = this.#lanes.get(sourceId) ?? { active: false, queue: [] };
    this.#lanes.set(sourceId, lane);
    if (lane.queue.length >= this.#maxQueuedPerSource) {
      const error = new ProviderWorkQueueFullError(sourceId);
      this.#onRejected?.(error);
      return Promise.reject(error);
    }
    const result = new Promise<T>((resolve, reject) => {
      lane.queue.push({ operation, resolve, reject } as QueuedWork);
    });
    this.#markReady(sourceId, lane);
    this.#drain();
    return result;
  }

  isBusy(sourceId: string): boolean {
    const lane = this.#lanes.get(sourceId);
    return lane !== undefined && (lane.active || lane.queue.length > 0);
  }

  clear(sourceId: string): void {
    const lane = this.#lanes.get(sourceId);
    if (lane === undefined) return;
    const error = new ProviderWorkClearedError(sourceId);
    for (const work of lane.queue.splice(0)) work.reject(error);
    this.#readySourceSet.delete(sourceId);
    if (!lane.active) this.#lanes.delete(sourceId);
  }

  #markReady(sourceId: string, lane: ProviderLane): void {
    if (lane.active || lane.queue.length === 0 || this.#readySourceSet.has(sourceId)) return;
    this.#readySourceSet.add(sourceId);
    this.#readySources.push(sourceId);
  }

  #drain(): void {
    while (this.#activeCount < this.#maxConcurrent && this.#readySources.length > 0) {
      const sourceId = this.#readySources.shift()!;
      if (!this.#readySourceSet.delete(sourceId)) continue;
      const lane = this.#lanes.get(sourceId);
      if (lane === undefined || lane.active) continue;
      const work = lane.queue.shift();
      if (work === undefined) continue;
      lane.active = true;
      this.#activeCount += 1;
      let operation: Promise<unknown>;
      try {
        operation = Promise.resolve(work.operation());
      } catch (error) {
        operation = Promise.reject(error);
      }
      void operation.then((value) => {
        this.#finish(sourceId, lane);
        work.resolve(value);
      }, (error: unknown) => {
        this.#finish(sourceId, lane);
        work.reject(error);
      });
    }
  }

  #finish(sourceId: string, lane: ProviderLane): void {
    lane.active = false;
    this.#activeCount -= 1;
    if (lane.queue.length === 0) this.#lanes.delete(sourceId);
    else this.#markReady(sourceId, lane);
    this.#drain();
  }
}

function positiveInteger(value: number, reason: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(reason);
  return value;
}
