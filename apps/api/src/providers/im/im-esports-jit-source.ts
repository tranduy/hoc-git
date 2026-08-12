import type { ImEsportsMarketRecord } from "@tool-chenh/adapters";
import type { Page } from "playwright";

interface FabetPageAccess {
  withProviderPage<T>(provider: "IM", category: "LOL", consume: (page: Page) => Promise<T>): Promise<T>;
}

interface ImEsportsPageReader {
  readCatalogFromPage(page: Page): Promise<readonly ImEsportsMarketRecord[]>;
}

export class JitImEsportsCatalogSource {
  readonly #fabet: FabetPageAccess;
  readonly #browser: ImEsportsPageReader;

  constructor(options: { readonly fabet: FabetPageAccess; readonly browser: ImEsportsPageReader }) {
    this.#fabet = options.fabet;
    this.#browser = options.browser;
  }

  readCatalog(_input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly ImEsportsMarketRecord[]> {
    return this.#fabet.withProviderPage("IM", "LOL", async (page) => this.#browser.readCatalogFromPage(page));
  }
}
