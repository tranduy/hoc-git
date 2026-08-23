import type { PersistedSabaWsSnapshots } from "./network-observer.js";

export interface SnapshotStorageArea {
  readonly get: (key: string) => Promise<Record<string, unknown>>;
  readonly set: (items: Record<string, unknown>) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
}

export class SabaSnapshotStorage {
  #mutationTail: Promise<void> | null = null;

  constructor(private readonly area: SnapshotStorageArea,
    private readonly key = "sabaWsSnapshotsV1") {}

  async load(sourceId: string): Promise<unknown> {
    const pendingMutation = this.#mutationTail;
    if (pendingMutation !== null) await pendingMutation.catch(() => undefined);
    const stored = (await this.area.get(this.key))[this.key];
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    const values = stored as Record<string, unknown>;
    return values[sourceId] ?? (values.sourceId === sourceId ? stored : null);
  }

  save(snapshots: PersistedSabaWsSnapshots): Promise<void> {
    return this.#mutate(async () => {
      const stored = (await this.area.get(this.key))[this.key];
      const values = stored && typeof stored === "object" && !Array.isArray(stored) &&
        !("sourceId" in stored) ? stored as Record<string, unknown> : {};
      await this.area.set({ [this.key]: { ...values, [snapshots.sourceId]: snapshots } });
    });
  }

  clear(sourceId: string): Promise<void> {
    return this.#mutate(async () => {
      const stored = (await this.area.get(this.key))[this.key];
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return;
      const values = { ...stored as Record<string, unknown> };
      if (values.sourceId === sourceId) {
        await this.area.remove(this.key);
        return;
      }
      delete values[sourceId];
      await this.area.set({ [this.key]: values });
    });
  }

  #mutate(operation: () => Promise<void>): Promise<void> {
    const prior = this.#mutationTail;
    const current = (prior === null ? Promise.resolve() : prior.catch(() => undefined)).then(operation);
    const settled = current.finally(() => {
      if (this.#mutationTail === settled) this.#mutationTail = null;
    });
    this.#mutationTail = settled;
    return settled;
  }
}
