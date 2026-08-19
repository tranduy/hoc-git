import type { CatalogRevisionEntry } from "@tool-chenh/contracts";
import type { CatalogReadResult } from "../api/catalog.js";

export interface CatalogRevisionCoordinatorOptions {
  readonly read: (accountId: string) => Promise<CatalogReadResult>;
  readonly onCatalog: (result: CatalogReadResult) => void;
  readonly onError?: (accountId: string, error: unknown) => void;
  readonly coalesceMs?: number;
  readonly fallbackMs?: number;
}

export class CatalogRevisionCoordinator {
  readonly #read: CatalogRevisionCoordinatorOptions["read"];
  readonly #onCatalog: CatalogRevisionCoordinatorOptions["onCatalog"];
  readonly #onError: NonNullable<CatalogRevisionCoordinatorOptions["onError"]>;
  readonly #coalesceMs: number;
  readonly #fallbackMs: number;
  #selected = new Set<string>();
  #desired = new Map<string, CatalogRevisionEntry>();
  readonly #held = new Map<string, string>();
  readonly #pending = new Map<string, number>();
  readonly #inFlight = new Set<string>();
  #sequence = -1;
  #fallbackTimer: number | undefined;
  #stopped = false;

  constructor(options: CatalogRevisionCoordinatorOptions) {
    this.#read = options.read;
    this.#onCatalog = options.onCatalog;
    this.#onError = options.onError ?? (() => undefined);
    this.#coalesceMs = options.coalesceMs ?? 50;
    this.#fallbackMs = options.fallbackMs ?? 1_000;
  }

  setSelected(accountIds: readonly string[]): void {
    this.#selected = new Set(accountIds);
    for (const [accountId, timer] of this.#pending) if (!this.#selected.has(accountId)) {
      window.clearTimeout(timer);
      this.#pending.delete(accountId);
    }
    for (const accountId of this.#selected) this.#scheduleIfChanged(accountId);
  }

  setHeldRevision(accountId: string, revision: string): void {
    this.#held.set(accountId, revision);
  }

  acceptBaseline(entries: readonly CatalogRevisionEntry[], sequence: number): void {
    if (this.#stopped) return;
    this.#sequence = sequence;
    this.#desired = new Map(entries.map((entry) => [entry.accountId, entry]));
    this.#stopFallback();
    for (const accountId of this.#selected) this.#scheduleIfChanged(accountId);
  }

  acceptRevision(entry: CatalogRevisionEntry, sequence: number): void {
    if (this.#stopped || sequence <= this.#sequence) return;
    this.#sequence = sequence;
    this.#desired.set(entry.accountId, entry);
    if (this.#selected.has(entry.accountId)) this.#schedule(entry.accountId, this.#coalesceMs);
  }

  setRealtimeUnavailable(): void {
    if (this.#stopped || this.#fallbackTimer !== undefined) return;
    this.#fallbackTimer = window.setInterval(() => {
      for (const accountId of this.#selected) void this.#fetch(accountId, true);
    }, this.#fallbackMs);
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#stopFallback();
    for (const timer of this.#pending.values()) window.clearTimeout(timer);
    this.#pending.clear();
  }

  #scheduleIfChanged(accountId: string): void {
    const desired = this.#desired.get(accountId);
    if (desired !== undefined && desired.revision !== this.#held.get(accountId)) {
      this.#schedule(accountId, this.#coalesceMs);
    }
  }

  #schedule(accountId: string, delayMs: number): void {
    if (this.#stopped || !this.#selected.has(accountId) || this.#inFlight.has(accountId)) return;
    const existing = this.#pending.get(accountId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.#pending.delete(accountId);
      void this.#fetch(accountId, false);
    }, delayMs);
    this.#pending.set(accountId, timer);
  }

  async #fetch(accountId: string, fallback: boolean): Promise<void> {
    if (this.#stopped || !this.#selected.has(accountId) || this.#inFlight.has(accountId)) return;
    const desiredBeforeRead = this.#desired.get(accountId);
    if (!fallback && desiredBeforeRead !== undefined &&
      desiredBeforeRead.revision === this.#held.get(accountId)) return;
    this.#inFlight.add(accountId);
    const target = desiredBeforeRead;
    try {
      const result = await this.#read(accountId);
      if (this.#stopped || !this.#selected.has(accountId)) return;
      const latestTarget = this.#desired.get(accountId);
      const superseded = !fallback && latestTarget !== undefined && target !== undefined &&
        latestTarget.revision !== target.revision && result.revision !== latestTarget.revision;
      if (!superseded && result.revision !== this.#held.get(accountId)) {
        this.#held.set(accountId, result.revision);
        this.#onCatalog(result);
      }
    } catch (error) {
      this.#onError(accountId, error);
      if (!fallback) this.#schedule(accountId, this.#fallbackMs);
    } finally {
      this.#inFlight.delete(accountId);
      if (!fallback) this.#scheduleIfChanged(accountId);
    }
  }

  #stopFallback(): void {
    if (this.#fallbackTimer === undefined) return;
    window.clearInterval(this.#fallbackTimer);
    this.#fallbackTimer = undefined;
  }
}
