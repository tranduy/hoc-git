import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

interface CatalogSaver {
  save(sourceKey: string, catalog: ObservedProviderCatalog): Promise<void>;
}

export class LatestCatalogPersister {
  readonly #store: CatalogSaver;
  readonly #pending = new Map<string, ObservedProviderCatalog>();
  readonly #deferred = new Map<string, ObservedProviderCatalog>();
  readonly #flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #minimumWriteGapMs: number;
  /**
   * Measured 2026-09-16 on the live stack: six catalog files rewritten in full
   * every minute, 356 MB of them, BTI alone 198 MB. The API sat at 82% of one
   * core with the disk at 36%, because each save serialises a whole catalog and
   * a save takes long enough that the gap between writes never applies -- the
   * writer simply runs back to back forever.
   *
   * This is a crash-recovery cache, not a live feed. Nothing reads it while the
   * stack is up; it exists so a restart does not start cold. Writing a given
   * source at most once per interval keeps that guarantee and stops the rest.
   */
  readonly #minimumSourceIntervalMs: number;
  readonly #savedAtMs = new Map<string, number>();
  readonly #now: () => number;
  #running = false;

  constructor(store: CatalogSaver, options: { readonly minimumWriteGapMs?: number;
    readonly minimumSourceIntervalMs?: number; readonly now?: () => number } = {}) {
    this.#store = store;
    this.#minimumWriteGapMs = Math.max(0, options.minimumWriteGapMs ?? 1_000);
    this.#minimumSourceIntervalMs = Math.max(0, options.minimumSourceIntervalMs ?? 60_000);
    this.#now = options.now ?? Date.now;
  }

  schedule(sourceKey: string, catalog: ObservedProviderCatalog): void {
    this.#pending.set(sourceKey, catalog);
    this.#deferred.delete(sourceKey);
    if (this.#running) return;
    this.#running = true;
    void this.#drain();
  }

  /**
   * A source that falls quiet right after being deferred would otherwise never
   * reach the disk, and a restart would then load an older catalog than the one
   * the process last held. The timer exists only for that case; a newer
   * schedule() replaces the deferred copy and the timer becomes a no-op.
   */
  #armFlush(sourceKey: string, delayMs: number): void {
    if (this.#flushTimers.has(sourceKey)) return;
    const timer = setTimeout(() => {
      this.#flushTimers.delete(sourceKey);
      const deferred = this.#deferred.get(sourceKey);
      if (deferred === undefined) return;
      this.#deferred.delete(sourceKey);
      this.schedule(sourceKey, deferred);
    }, Math.max(0, delayMs));
    timer.unref?.();
    this.#flushTimers.set(sourceKey, timer);
  }

  /** Drops the pending timers so a shutdown does not keep the process alive. */
  stop(): void {
    for (const timer of this.#flushTimers.values()) clearTimeout(timer);
    this.#flushTimers.clear();
  }

  async #drain(): Promise<void> {
    try {
      while (this.#pending.size > 0) {
        const next = this.#pending.entries().next().value as [string, ObservedProviderCatalog] | undefined;
        if (next === undefined) return;
        const [sourceKey, catalog] = next;
        this.#pending.delete(sourceKey);
        const savedAtMs = this.#savedAtMs.get(sourceKey);
        if (savedAtMs !== undefined && this.#now() - savedAtMs < this.#minimumSourceIntervalMs) {
          // Keep the newest catalog for this source without writing it now. A
          // later schedule() replaces it, so the disk only ever receives the
          // latest, never a backlog.
          this.#deferred.set(sourceKey, catalog);
          this.#armFlush(sourceKey, this.#minimumSourceIntervalMs - (this.#now() - savedAtMs));
          continue;
        }
        this.#savedAtMs.set(sourceKey, this.#now());
        await this.#store.save(sourceKey, catalog).catch(() => undefined);
        if (this.#pending.size > 0 && this.#minimumWriteGapMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, this.#minimumWriteGapMs));
        }
      }
    } finally {
      this.#running = false;
      if (this.#pending.size > 0) {
        const next = this.#pending.entries().next().value as [string, ObservedProviderCatalog];
        this.schedule(next[0], next[1]);
      }
    }
  }
}
