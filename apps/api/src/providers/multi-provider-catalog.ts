import type { Category, ProviderId } from "@tool-chenh/contracts";
import type { CatalogSourceIdentity } from "../accounts/account-registry.js";
import type { ObservedProviderCatalog } from "./cmd/cmd-observed-catalog.js";

export interface ProviderCatalogReader {
  readonly provider: ProviderId;
  read(accountId: string): Promise<ObservedProviderCatalog>;
}

interface CatalogSourceResolver {
  resolveCatalogSource(accountId: string): Promise<CatalogSourceIdentity>;
}

export interface ProviderCatalogReaderRegistration {
  readonly provider: ProviderId;
  readonly category: Category;
  readonly reader: ProviderCatalogReader;
}

export class MultiProviderCatalogReader {
  readonly #sources: CatalogSourceResolver;
  readonly #readers: ReadonlyMap<string, ProviderCatalogReader>;

  constructor(options: {
    readonly sources: CatalogSourceResolver;
    readonly readers: readonly ProviderCatalogReaderRegistration[];
  }) {
    this.#sources = options.sources;
    this.#readers = new Map(options.readers.map((registration) => [
      `${registration.provider}|${registration.category}`, registration.reader
    ]));
  }

  async sourceKey(accountId: string): Promise<string> {
    return (await this.#sources.resolveCatalogSource(accountId)).key;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    try {
      const source = await this.#sources.resolveCatalogSource(accountId);
      const reader = this.#readers.get(`${source.provider}|${source.category}`);
      if (reader === undefined || reader.provider !== source.provider) throw new Error("CATALOG_UNAVAILABLE");
      const catalog = await reader.read(accountId);
      if (catalog.provider !== source.provider || catalog.category !== source.category || catalog.accountId !== accountId) {
        throw new Error("CATALOG_UNAVAILABLE");
      }
      return catalog;
    } catch {
      throw new Error("CATALOG_UNAVAILABLE");
    }
  }
}
