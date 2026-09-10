import type { CatalogRevisionEntry } from "@tool-chenh/contracts";
import type { CatalogReadResult } from "../api/catalog.js";

export interface CatalogRevisionCoordinatorOptions {
  readonly read: (accountId: string) => Promise<CatalogReadResult>;
  readonly onCatalog: (result: CatalogReadResult) => void;
  readonly onStale?: (entry: CatalogRevisionEntry) => void;
  readonly onError?: (accountId: string, error: unknown) => void;
  readonly retryDelayMs?: (error: unknown) => number;
  readonly coalesceMs?: number;
  readonly fallbackMs?: number;
  readonly minimumPublishIntervalMs?: number;
}

export class CatalogRevisionCoordinator {
  readonly #read: CatalogRevisionCoordinatorOptions["read"];
  readonly #onCatalog: CatalogRevisionCoordinatorOptions["onCatalog"];
  readonly #onStale: NonNullable<CatalogRevisionCoordinatorOptions["onStale"]>;
  readonly #onError: NonNullable<CatalogRevisionCoordinatorOptions["onError"]>;
  readonly #coalesceMs: number;
  readonly #fallbackMs: number;
  readonly #minimumPublishIntervalMs: number;
  readonly #retryDelayMs: (error: unknown) => number;
  #selected = new Set<string>();
  #desired = new Map<string, CatalogRevisionEntry>();
  readonly #held = new Map<string, string>();
  readonly #heldSource = new Map<string, string>();
  readonly #forced = new Set<string>();
  readonly #externallyHeldTarget = new Map<string, CatalogRevisionEntry | undefined>();
  readonly #lastObservedAtMs = new Map<string, number>();
  readonly #pending = new Map<string, number>();
  readonly #pendingDueAtMs = new Map<string, number>();
  readonly #inFlight = new Set<string>();
  readonly #lastPublishedAtMs = new Map<string, number>();
  readonly #retryAt = new Map<string, number>();
  #sequence = -1;
  #baselineGeneration = 0;
  #fallbackTimer: number | undefined;
  #stopped = false;

  constructor(options: CatalogRevisionCoordinatorOptions) {
    this.#read = options.read;
    this.#onCatalog = options.onCatalog;
    this.#onStale = options.onStale ?? (() => undefined);
    this.#onError = options.onError ?? (() => undefined);
    this.#coalesceMs = options.coalesceMs ?? 50;
    this.#fallbackMs = options.fallbackMs ?? 1_000;
    this.#minimumPublishIntervalMs = options.minimumPublishIntervalMs ?? 0;
    this.#retryDelayMs = options.retryDelayMs ?? (() => this.#fallbackMs);
  }

  setSelected(accountIds: readonly string[]): void {
    const previous = this.#selected;
    this.#selected = new Set(accountIds);
    for (const [accountId, timer] of this.#pending) if (!this.#selected.has(accountId)) {
      window.clearTimeout(timer);
      this.#pending.delete(accountId);
      this.#pendingDueAtMs.delete(accountId);
    }
    for (const accountId of this.#selected) {
      if (!previous.has(accountId)) {
        this.#retryAt.delete(accountId);
        this.#lastPublishedAtMs.delete(accountId);
      }
      this.#scheduleIfChanged(accountId);
    }
  }

  setHeldRevision(accountId: string, revision: string, sourceRevision = revision): void {
    if (this.#held.get(accountId) !== revision) {
      this.#externallyHeldTarget.set(accountId, this.#desired.get(accountId));
    }
    this.#held.set(accountId, revision);
    this.#heldSource.set(accountId, sourceRevision);
  }

  /** A peer's roster changed, so a selected view can change without new odds. */
  refreshViews(exceptAccountId?: string): void {
    if (this.#stopped) return;
    for (const accountId of this.#selected) {
      if (accountId === exceptAccountId) continue;
      this.#forced.add(accountId);
      this.#schedule(accountId, this.#coalesceMs);
    }
  }

  acceptBaseline(entries: readonly CatalogRevisionEntry[], sequence: number): void {
    if (this.#stopped) return;
    this.#baselineGeneration += 1;
    this.#sequence = sequence;
    this.#desired = new Map(entries.map((entry) => [entry.accountId, entry]));
    for (const entry of entries) if (entry.snapshotState === "STALE") this.#onStale(entry);
    this.#stopFallback();
    for (const accountId of this.#selected) this.#scheduleIfChanged(accountId);
  }

  acceptRevision(entry: CatalogRevisionEntry, sequence: number): void {
    if (this.#stopped || sequence <= this.#sequence) return;
    this.#sequence = sequence;
    this.#desired.set(entry.accountId, entry);
    if (entry.snapshotState === "STALE") this.#onStale(entry);
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
    this.#pendingDueAtMs.clear();
    this.#lastPublishedAtMs.clear();
    this.#retryAt.clear();
    this.#forced.clear();
  }

  #scheduleIfChanged(accountId: string): void {
    const desired = this.#desired.get(accountId);
    if (this.#forced.has(accountId) || desired !== undefined && desired.revision !== this.#heldSource.get(accountId)) {
      this.#schedule(accountId, this.#coalesceMs);
    }
  }

  #schedule(accountId: string, delayMs: number): void {
    if (this.#stopped || !this.#selected.has(accountId) || this.#inFlight.has(accountId)) return;
    const nowMs = Date.now();
    const retryAtMs = this.#retryAt.get(accountId) ?? 0;
    const publishAtMs = (this.#lastPublishedAtMs.get(accountId) ?? 0) + this.#minimumPublishIntervalMs;
    const dueAtMs = Math.max(nowMs + Math.max(0, delayMs), retryAtMs, publishAtMs);
    const existing = this.#pending.get(accountId);
    const existingDueAtMs = this.#pendingDueAtMs.get(accountId);
    if (existing !== undefined && existingDueAtMs !== undefined && existingDueAtMs <= dueAtMs) return;
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.#pending.delete(accountId);
      this.#pendingDueAtMs.delete(accountId);
      void this.#fetch(accountId, false);
    }, Math.max(0, dueAtMs - nowMs));
    this.#pending.set(accountId, timer);
    this.#pendingDueAtMs.set(accountId, dueAtMs);
  }

  async #fetch(accountId: string, fallback: boolean): Promise<void> {
    if (this.#stopped || !this.#selected.has(accountId) || this.#inFlight.has(accountId)) return;
    if ((this.#retryAt.get(accountId) ?? 0) > Date.now()) return;
    const publishAtMs = (this.#lastPublishedAtMs.get(accountId) ?? 0) + this.#minimumPublishIntervalMs;
    if (publishAtMs > Date.now()) return;
    const desiredBeforeRead = this.#desired.get(accountId);
    if (!fallback && !this.#forced.has(accountId) && desiredBeforeRead !== undefined &&
      desiredBeforeRead.revision === this.#heldSource.get(accountId)) return;
    this.#inFlight.add(accountId);
    const forced = this.#forced.has(accountId);
    this.#forced.delete(accountId);
    const target = desiredBeforeRead;
    const heldBeforeRead = this.#held.get(accountId);
    const baselineGeneration = this.#baselineGeneration;
    let failed = false;
    try {
      const result = await this.#read(accountId);
      if (this.#stopped || !this.#selected.has(accountId) ||
        baselineGeneration !== this.#baselineGeneration) return;
      if (result.catalog.accountId !== accountId) throw new Error("Catalog response account mismatch");
      const latestTarget = this.#desired.get(accountId);
      const held = this.#held.get(accountId);
      const sourceRevision = result.sourceRevision ?? result.revision;
      const followsExternalHeldUpdate = latestTarget !== undefined &&
        latestTarget !== this.#externallyHeldTarget.get(accountId) &&
        sourceRevision === latestTarget.revision;
      // Large reads can finish between revisions. Publish their progress unless
      // a concurrent initial/cache read already advanced the catalog we hold.
      const repeatsTargetBeforeExternalUpdate = latestTarget !== undefined &&
        latestTarget === this.#externallyHeldTarget.get(accountId) && result.revision === latestTarget.revision;
      const heldAdvanced = (held !== heldBeforeRead && !followsExternalHeldUpdate) ||
        repeatsTargetBeforeExternalUpdate;
      const observedAtMs = result.catalog.observedAtMs;
      const olderObservation = observedAtMs < Math.max(this.#lastObservedAtMs.get(accountId) ?? 0,
        target?.observedAtMs ?? 0);
      const overtakenByStale = latestTarget?.snapshotState === "STALE" &&
        result.catalog.snapshotState !== "STALE" && observedAtMs <= latestTarget.observedAtMs;
      if (!heldAdvanced && !olderObservation && !overtakenByStale && result.revision !== held) {
        this.#held.set(accountId, result.revision);
        this.#heldSource.set(accountId, sourceRevision);
        this.#lastObservedAtMs.set(accountId, observedAtMs);
        this.#lastPublishedAtMs.set(accountId, Date.now());
        this.#onCatalog(result);
      }
      this.#retryAt.delete(accountId);
    } catch (error) {
      if (this.#stopped || !this.#selected.has(accountId) ||
        baselineGeneration !== this.#baselineGeneration) return;
      failed = true;
      if (forced) this.#forced.add(accountId);
      const retryDelayMs = Math.max(0, this.#retryDelayMs(error));
      this.#retryAt.set(accountId, Date.now() + retryDelayMs);
      this.#onError(accountId, error);
    } finally {
      this.#inFlight.delete(accountId);
      if (!fallback || this.#forced.has(accountId) || baselineGeneration !== this.#baselineGeneration) {
        if (failed) this.#schedule(accountId, 0);
        else this.#scheduleIfChanged(accountId);
      }
    }
  }

  #stopFallback(): void {
    if (this.#fallbackTimer === undefined) return;
    window.clearInterval(this.#fallbackTimer);
    this.#fallbackTimer = undefined;
  }
}
