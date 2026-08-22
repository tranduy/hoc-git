import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

interface CatalogSaver {
  save(sourceKey: string, catalog: ObservedProviderCatalog): Promise<void>;
}

export class LatestCatalogPersister {
  readonly #store: CatalogSaver;
  readonly #pending = new Map<string, ObservedProviderCatalog>();
  readonly #minimumWriteGapMs: number;
  #running = false;

  constructor(store: CatalogSaver, options: { readonly minimumWriteGapMs?: number } = {}) {
    this.#store = store;
    this.#minimumWriteGapMs = Math.max(0, options.minimumWriteGapMs ?? 1_000);
  }

  schedule(sourceKey: string, catalog: ObservedProviderCatalog): void {
    this.#pending.set(sourceKey, catalog);
    if (this.#running) return;
    this.#running = true;
    void this.#drain();
  }

  async #drain(): Promise<void> {
    try {
      while (this.#pending.size > 0) {
        const next = this.#pending.entries().next().value as [string, ObservedProviderCatalog] | undefined;
        if (next === undefined) return;
        const [sourceKey, catalog] = next;
        this.#pending.delete(sourceKey);
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
