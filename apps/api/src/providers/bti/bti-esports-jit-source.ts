import type { Page } from "playwright";
import type { BtiEsportsCatalogSnapshot } from "./bti-esports-source.js";

interface FabetPageAccess {
  withProviderPage<T>(provider: "BTI", category: "LOL", consume: (page: Page) => Promise<T>): Promise<T>;
}

interface BtiEsportsPageReader {
  readCatalogFromPage(page: Page): Promise<BtiEsportsCatalogSnapshot>;
}

export class JitBtiEsportsCatalogSource {
  readonly #fabet: FabetPageAccess;
  readonly #browser: BtiEsportsPageReader;

  constructor(options: { readonly fabet: FabetPageAccess; readonly browser: BtiEsportsPageReader }) {
    this.#fabet = options.fabet;
    this.#browser = options.browser;
  }

  readCatalogFromFabet(): Promise<BtiEsportsCatalogSnapshot> {
    return this.#fabet.withProviderPage("BTI", "LOL", async (page) => this.#browser.readCatalogFromPage(page));
  }
}
