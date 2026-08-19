import { createHash } from "node:crypto";
import type { CatalogRevisionEntry } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

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

function revisionFor(catalog: ObservedProviderCatalog, snapshotState: "FRESH" | "STALE"): string {
  return createHash("sha256").update(JSON.stringify({ catalog, snapshotState })).digest("base64url");
}

function publicEntry(entry: StoredCatalogRevision): CatalogRevisionEntry {
  return { accountId: entry.accountId, revision: entry.revision,
    observedAtMs: entry.observedAtMs, snapshotState: entry.snapshotState };
}

export class CatalogRevisionStore {
  readonly #now: () => number;
  readonly #entries = new Map<string, StoredCatalogRevision>();
  readonly #listeners = new Set<Listener>();
  #sequence = 0;
  #expiryTimer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(options: { readonly now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  publish(accountId: string, catalog: ObservedProviderCatalog, options: {
    readonly snapshotState: "FRESH" | "STALE";
    readonly freshnessMs: number;
  }): StoredCatalogRevision {
    if (this.#closed) throw new Error("CATALOG_REVISION_STORE_CLOSED");
    if (accountId.trim().length === 0 || !Number.isFinite(options.freshnessMs) || options.freshnessMs <= 0) {
      throw new Error("CATALOG_REVISION_PUBLICATION_INVALID");
    }
    const current = this.#entries.get(accountId);
    if (current !== undefined && catalog.observedAtMs < current.observedAtMs) return current;
    const revision = revisionFor(catalog, options.snapshotState);
    if (current?.revision === revision) {
      this.#scheduleExpiry();
      return current;
    }
    const entry: StoredCatalogRevision = {
      accountId, catalog, revision, observedAtMs: catalog.observedAtMs,
      snapshotState: options.snapshotState, sequence: ++this.#sequence,
      freshUntilMs: options.snapshotState === "FRESH" ? this.#now() + options.freshnessMs : null
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
    const now = this.#now();
    const expired = [...this.#entries.values()].filter((entry) =>
      entry.snapshotState === "FRESH" && entry.freshUntilMs !== null && entry.freshUntilMs <= now);
    for (const current of expired) {
      const entry: StoredCatalogRevision = {
        ...current, revision: revisionFor(current.catalog, "STALE"),
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
    this.#listeners.clear();
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
