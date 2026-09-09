import { createHash } from "node:crypto";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

type SnapshotState = "FRESH" | "STALE";

/** Published catalogs and their records are readonly. Adapters replace changed
 * records; unchanged records can therefore reuse a digest without retaining a
 * second JSON copy of the catalog. Weak keys also release retired records.
 *
 * Revision v2 is an opaque ETag: native observations and BTI records contribute
 * SHA-256 digests. Other provider rows are often rebuilt on every update, so
 * hashing those individually would add work without useful cache reuse.
 */
export class CatalogRevisionHasher {
  readonly #records = new WeakMap<object, string>();
  readonly #quotes = new WeakMap<object, string>();
  readonly #native = new WeakMap<object, string>();
  readonly #catalogs = new WeakMap<ObservedProviderCatalog, Record<SnapshotState, string>>();

  revisionFor(catalog: ObservedProviderCatalog, snapshotState: SnapshotState): string {
    const cached = this.#catalogs.get(catalog);
    if (cached !== undefined) return cached[snapshotState];
    const { observedAtMs: _observedAtMs, quotes, ...semanticCatalog } = catalog;
    const hash = createHash("sha256").update('{"revisionFormat":2,"catalog":{');
    let first = true;
    // Keep field/row order and the existing clock projections. The v2 domain
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
        : catalog.provider !== "BTI" ? undefined : key === "quotes" ? this.#quotes : this.#records;
      hash.update("[");
      for (let index = 0; index < value.length; index += 128) {
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
        if (index > 0) hash.update(",");
        hash.update(JSON.stringify(group).slice(1, -1));
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
