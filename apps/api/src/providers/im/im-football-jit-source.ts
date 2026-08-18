import type { Page } from "playwright";
import type { ImFootballCatalogSnapshot } from "./im-football-browser-manager.js";

interface FabetImPageAccess {
  withProviderPage<T>(provider: "IM", category: "FOOTBALL", consume: (page: Page) => Promise<T>): Promise<T>;
}

interface ImFootballPageReader {
  readCatalogFromPage(page: Page): Promise<ImFootballCatalogSnapshot>;
  readCatalogDirect(): Promise<ImFootballCatalogSnapshot>;
}

export class JitImFootballCatalogSource {
  readonly #fabet: FabetImPageAccess;
  readonly #browser: ImFootballPageReader;

  constructor(options: { readonly fabet: FabetImPageAccess; readonly browser: ImFootballPageReader }) {
    this.#fabet = options.fabet;
    this.#browser = options.browser;
  }

  async readCatalogFromFabet(): Promise<ImFootballCatalogSnapshot> {
    try {
      return await this.#browser.readCatalogDirect();
    } catch {
      return this.#fabet.withProviderPage("IM", "FOOTBALL", async (page) => this.#browser.readCatalogFromPage(page));
    }
  }
}
