import type { CatalogSourceStatus } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import type { CatalogReaderLike } from "../routes/catalog.js";
import type { CatalogSourceRegistryLike } from "../routes/catalog-sources.js";

interface ChromeCatalogAccess {
  owns(accountId: string): boolean;
  read(accountId: string): Promise<ObservedProviderCatalog>;
  overlayStatuses(statuses: readonly CatalogSourceStatus[]): Promise<readonly CatalogSourceStatus[]>;
}

export function createChromeCatalogOverlay(options: {
  readonly sources: CatalogSourceRegistryLike;
  readonly reader: CatalogReaderLike;
  readonly chrome: ChromeCatalogAccess;
}): { readonly sources: CatalogSourceRegistryLike; readonly reader: CatalogReaderLike } {
  const sources: CatalogSourceRegistryLike = {
    listStatuses: async () => options.chrome.overlayStatuses(await options.sources.listStatuses())
  };
  const reader: CatalogReaderLike = {
    ...copyReaderTimings(options.reader),
    // Chrome-owned sources are intentionally exclusive. Falling through on a
    // stale/missing catalog launches legacy Playwright readers, multiplies
    // browser processes and hides the actual bridge failure.
    read: (accountId) => options.chrome.owns(accountId)
      ? options.chrome.read(accountId)
      : options.reader.read(accountId),
    ...(options.reader.sourceKey === undefined ? {} : {
      sourceKey: async (accountId: string) =>
        `chrome-or-legacy|${accountId}|${await options.reader.sourceKey!(accountId)}`
    }),
    ...(options.reader.cancel === undefined ? {} : {
      cancel: (accountId: string) => options.reader.cancel!(accountId)
    })
  };
  return { sources, reader };
}

function copyReaderTimings(reader: CatalogReaderLike): Partial<CatalogReaderLike> {
  return {
    requestTimeoutMs: Math.min(reader.requestTimeoutMs ?? 3_000, 3_000),
    responseCacheMaxAgeMs: 1_000,
    snapshotFreshnessMaxAgeMs: 20_000,
    failureRetryBaseMs: 1_000,
    failureRetryMaxMs: 5_000,
    ...(reader.collectionTimeoutMs === undefined ? {} : { collectionTimeoutMs: reader.collectionTimeoutMs }),
    ...(reader.collectorLeaseMs === undefined ? {} : { collectorLeaseMs: reader.collectorLeaseMs })
  };
}
