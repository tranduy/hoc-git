import type { CatalogRevisionEntry } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogRevisionHasher } from "./catalog-revision-hasher.js";

export interface StoredCatalogRevision extends CatalogRevisionEntry {
  readonly sequence: number;
  readonly catalog: ObservedProviderCatalog;
  readonly freshUntilMs: number | null;
}

export interface CatalogRevisionBaseline {
  readonly sequence: number;
  readonly entries: readonly CatalogRevisionEntry[];
}

type Listener = (entry: StoredCatalogRevision) => void;
interface PublicationOptions {
  readonly snapshotState: "FRESH" | "STALE";
  readonly freshnessMs: number;
}

function publicEntry(entry: StoredCatalogRevision): CatalogRevisionEntry {
  return { accountId: entry.accountId, revision: entry.revision,
    observedAtMs: entry.observedAtMs, snapshotState: entry.snapshotState };
}

export class CatalogRevisionStore {
  readonly #now: () => number;
  readonly #entries = new Map<string, StoredCatalogRevision>();
  readonly #listeners = new Set<Listener>();
  readonly #hasher = new CatalogRevisionHasher();
  readonly #pending = new Map<string, { readonly catalog: ObservedProviderCatalog;
    readonly freshUntilMs: number }>();
  #publicationTimer: ReturnType<typeof setTimeout> | undefined;
  #sequence = 0;
  #expiryTimer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(options: { readonly now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  /** Feed bursts still enter the authoritative data plane individually. Only
   * their derived UI revision hashes coalesce over 20 ms. Reads flush the
   * latest snapshot; invalidation is immediate and freshness never extends. */
  publishCoalesced(accountId: string, catalog: ObservedProviderCatalog, options: PublicationOptions): void {
    if (this.#closed) throw new Error("CATALOG_REVISION_STORE_CLOSED");
    if (accountId.trim().length === 0 || !Number.isFinite(options.freshnessMs) || options.freshnessMs <= 0) {
      throw new Error("CATALOG_REVISION_PUBLICATION_INVALID");
    }
    if (options.snapshotState === "STALE") {
      // Invalidation may carry the last published snapshot while a newer one
      // is still queued. Mark the latest retained data stale and retire that
      // queued freshness, so its timer cannot resurrect the invalidated feed.
      let latest = catalog;
      for (const retained of [this.#entries.get(accountId)?.catalog, this.#pending.get(accountId)?.catalog]) {
        if (retained !== undefined && retained.observedAtMs >= latest.observedAtMs) latest = retained;
      }
      this.#pending.delete(accountId);
      this.publish(accountId, latest, options);
      return;
    }
    if (!this.#entries.has(accountId)) {
      this.publish(accountId, catalog, options);
      return;
    }
    const latest = this.#pending.get(accountId)?.catalog ?? this.#entries.get(accountId)!.catalog;
    if (catalog.observedAtMs < latest.observedAtMs) return;
    this.#pending.set(accountId, { catalog, freshUntilMs: this.#now() + options.freshnessMs });
    if (this.#publicationTimer === undefined) {
      this.#publicationTimer = setTimeout(() => {
        this.#publicationTimer = undefined;
        this.#flushPending();
      }, 20);
      this.#publicationTimer.unref?.();
    }
  }

  publish(accountId: string, catalog: ObservedProviderCatalog, options: PublicationOptions): StoredCatalogRevision {
    return this.#publishBefore(accountId, catalog, options, this.#now() + options.freshnessMs);
  }

  #publishBefore(accountId: string, catalog: ObservedProviderCatalog, options: PublicationOptions,
    freshUntilMs: number): StoredCatalogRevision {
    if (this.#closed) throw new Error("CATALOG_REVISION_STORE_CLOSED");
    if (accountId.trim().length === 0 || !Number.isFinite(options.freshnessMs) || options.freshnessMs <= 0) {
      throw new Error("CATALOG_REVISION_PUBLICATION_INVALID");
    }
    const pending = this.#pending.get(accountId);
    if (pending !== undefined && catalog.observedAtMs >= pending.catalog.observedAtMs) this.#pending.delete(accountId);
    const current = this.#entries.get(accountId);
    if (current !== undefined && catalog.observedAtMs < current.observedAtMs) return current;
    let snapshotState = options.snapshotState;
    let revision = this.#hasher.revisionFor(catalog, snapshotState);
    if (snapshotState === "FRESH" && freshUntilMs <= this.#now()) {
      snapshotState = "STALE";
      revision = this.#hasher.revisionFor(catalog, snapshotState);
    }
    if (current?.revision === revision && catalog.observedAtMs === current.observedAtMs) return current;
    if (current?.revision === revision) {
      const renewed: StoredCatalogRevision = {
        ...current,
        catalog,
        observedAtMs: catalog.observedAtMs,
        snapshotState,
        freshUntilMs: snapshotState === "FRESH" ? freshUntilMs : null
      };
      this.#entries.set(accountId, renewed);
      this.#scheduleExpiry();
      return renewed;
    }
    const entry: StoredCatalogRevision = {
      accountId, catalog, revision, observedAtMs: catalog.observedAtMs,
      snapshotState, sequence: ++this.#sequence,
      freshUntilMs: snapshotState === "FRESH" ? freshUntilMs : null
    };
    this.#entries.set(accountId, entry);
    for (const listener of this.#listeners) listener(entry);
    this.#scheduleExpiry();
    return entry;
  }

  get(accountId: string): StoredCatalogRevision | undefined {
    this.expire();
    return this.#entries.get(accountId);
  }

  baseline(): CatalogRevisionBaseline {
    this.expire();
    return { sequence: this.#sequence, entries: [...this.#entries.values()]
      .sort((left, right) => left.accountId.localeCompare(right.accountId)).map(publicEntry) };
  }

  subscribe(listener: Listener): () => void {
    if (this.#closed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  expire(): void {
    if (this.#closed) return;
    this.#flushPending();
    const now = this.#now();
    const expired = [...this.#entries.values()].filter((entry) =>
      entry.snapshotState === "FRESH" && entry.freshUntilMs !== null && entry.freshUntilMs <= now);
    for (const current of expired) {
      const entry: StoredCatalogRevision = {
        ...current, revision: this.#hasher.revisionFor(current.catalog, "STALE"),
        snapshotState: "STALE", sequence: ++this.#sequence, freshUntilMs: null
      };
      this.#entries.set(entry.accountId, entry);
      for (const listener of this.#listeners) listener(entry);
    }
    this.#scheduleExpiry();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#expiryTimer !== undefined) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = undefined;
    if (this.#publicationTimer !== undefined) clearTimeout(this.#publicationTimer);
    this.#publicationTimer = undefined;
    this.#pending.clear();
    this.#listeners.clear();
  }

  #flushPending(): void {
    if (this.#publicationTimer !== undefined) clearTimeout(this.#publicationTimer);
    this.#publicationTimer = undefined;
    for (const [accountId, pending] of this.#pending) {
      this.#pending.delete(accountId);
      const remainingMs = pending.freshUntilMs - this.#now();
      this.#publishBefore(accountId, pending.catalog, { snapshotState: remainingMs > 0 ? "FRESH" : "STALE",
        freshnessMs: Math.max(1, remainingMs) }, pending.freshUntilMs);
    }
  }

  #scheduleExpiry(): void {
    if (this.#closed) return;
    if (this.#expiryTimer !== undefined) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = undefined;
    const deadline = [...this.#entries.values()].reduce<number | null>((earliest, entry) =>
      entry.snapshotState !== "FRESH" || entry.freshUntilMs === null ? earliest
        : Math.min(earliest ?? entry.freshUntilMs, entry.freshUntilMs), null);
    if (deadline === null) return;
    this.#expiryTimer = setTimeout(() => {
      this.#expiryTimer = undefined;
      this.expire();
    }, Math.max(1, deadline - this.#now()));
    this.#expiryTimer.unref?.();
  }
}
