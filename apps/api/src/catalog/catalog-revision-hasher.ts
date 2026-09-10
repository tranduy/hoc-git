import { createHash } from "node:crypto";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

type SnapshotState = "FRESH" | "STALE";
const MAX_RETAINED_BLOCKS = 8_192;

/** Published catalogs and their records are readonly. Adapters replace changed
 * records; unchanged records can therefore reuse a digest without retaining a
 * second JSON copy of the catalog. Weak keys also release retired records.
 *
 * Revision v3 also hashes ordered blocks of 128 rows. A delta reuses unchanged
 * blocks after checking every row identity, avoiding whole-catalog serialization.
 * The block cache is bounded and retains digests, never a second JSON catalog.
 */
export class CatalogRevisionHasher {
  readonly #records = new WeakMap<object, string>();
  readonly #quotes = new WeakMap<object, string>();
  readonly #native = new WeakMap<object, string>();
  readonly #catalogs = new WeakMap<ObservedProviderCatalog, Record<SnapshotState, string>>();
  readonly #blocks = new WeakMap<object, { readonly kind: string; readonly rows: readonly object[];
    readonly digest: string; readonly owner: WeakRef<object> }>();
  // Weak owners prevent the retention bound itself from keeping old catalogs
  // alive after source retirement. A live first row owns its cached block.
  readonly #blockOrder = new Set<WeakRef<object>>();

  revisionFor(catalog: ObservedProviderCatalog, snapshotState: SnapshotState): string {
    const cached = this.#catalogs.get(catalog);
    if (cached !== undefined) return cached[snapshotState];
    const { observedAtMs: _observedAtMs, quotes, ...semanticCatalog } = catalog;
    const hash = createHash("sha256").update('{"revisionFormat":3,"catalog":{');
    let first = true;
    // Keep field/row order and the existing clock projections. The v3 domain
    // separates this representation from the original full-JSON revision.
    for (const [key, value] of Object.entries({ ...semanticCatalog, quotes })) {
      if (value === undefined) continue;
      if (!first) hash.update(",");
      first = false;
      hash.update(JSON.stringify(key)).update(":");
      if (!Array.isArray(value)) {
        hash.update(JSON.stringify(value));
        continue;
      }
      const cache = key === "nativeMarketObservations" ? this.#native
        : catalog.provider !== "BTI" && catalog.provider !== "SBOBET" ? undefined
          : key === "quotes" ? this.#quotes : this.#records;
      hash.update("[");
      const kind = `${catalog.provider}:${key}`;
      for (let index = 0; index < value.length; index += 128) {
        const anchor = value[index] as object;
        const cachedBlock = this.#blocks.get(anchor);
        if (cachedBlock?.kind === kind && cachedBlock.rows.length === Math.min(128, value.length - index) &&
          cachedBlock.rows.every((record, offset) => record === value[index + offset])) {
          this.#blockOrder.delete(cachedBlock.owner); this.#blockOrder.add(cachedBlock.owner);
          if (index > 0) hash.update(",");
          hash.update(JSON.stringify(cachedBlock.digest));
          continue;
        }
        const group = value.slice(index, index + 128).map((record: object) => {
          const digest = cache?.get(record);
          if (digest !== undefined) return digest;
          let projected: object = record;
          if (key === "quotes") {
            const { receivedMonotonicMs, sequence, sourceTimestampMs: _sourceTimestampMs, ...quote } =
              record as ObservedProviderCatalog["quotes"][number];
            projected = catalog.provider === "APSPORT" ? { ...quote, receivedMonotonicMs, sequence } : quote;
          } else if (key === "nativeMarketObservations") {
            const { observedAtMs: _nativeObservedAtMs, ...observation } =
              record as NonNullable<ObservedProviderCatalog["nativeMarketObservations"]>[number];
            projected = observation;
          }
          if (cache === undefined) return projected;
          const next = createHash("sha256").update(JSON.stringify(projected)).digest("base64url");
          cache.set(record, next);
          return next;
        });
        const digest = createHash("sha256").update(JSON.stringify(group)).digest("base64url");
        if (cachedBlock !== undefined) this.#blockOrder.delete(cachedBlock.owner);
        if (this.#blockOrder.size >= MAX_RETAINED_BLOCKS) {
          const oldest = this.#blockOrder.values().next().value!;
          const retired = oldest.deref();
          if (retired !== undefined) this.#blocks.delete(retired);
          this.#blockOrder.delete(oldest);
        }
        const owner = cachedBlock?.owner ?? new WeakRef(anchor);
        this.#blockOrder.add(owner);
        this.#blocks.set(anchor, { kind, rows: value.slice(index, index + 128), digest, owner });
        if (index > 0) hash.update(",");
        hash.update(JSON.stringify(digest));
      }
      hash.update("]");
    }
    hash.update('},"snapshotState":');
    const revisions = {
      FRESH: hash.copy().update('"FRESH"}').digest("base64url"),
      STALE: hash.update('"STALE"}').digest("base64url")
    };
    this.#catalogs.set(catalog, revisions);
    return revisions[snapshotState];
  }
}
