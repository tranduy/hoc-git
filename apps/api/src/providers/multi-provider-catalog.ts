import type { ProviderId } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "./cmd/cmd-observed-catalog.js";

export interface ProviderCatalogReader {
  readonly provider: ProviderId;
  read(accountId: string): Promise<ObservedProviderCatalog>;
}

export class MultiProviderCatalogReader {
  readonly #readers: readonly ProviderCatalogReader[];

  constructor(readers: readonly ProviderCatalogReader[]) {
    this.#readers = [...readers];
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    for (const reader of this.#readers) {
      try {
        const catalog = await reader.read(accountId);
        if (catalog.provider !== reader.provider || catalog.accountId !== accountId) continue;
        return catalog;
      } catch {
        // Account ownership and provider health are deliberately not exposed.
      }
    }
    throw new Error("CATALOG_UNAVAILABLE");
  }
}
