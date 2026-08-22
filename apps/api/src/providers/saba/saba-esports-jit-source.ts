import type { Page } from "playwright";

type RawRecord = Readonly<Record<string, unknown>>;
interface FabetPageAccess {
  withProviderPage<T>(provider: "SABA", category: "LOL", consume: (page: Page) => Promise<T>): Promise<T>;
}
interface SabaEsportsPageReader { readCatalogFromPage(page: Page): Promise<readonly RawRecord[]> }

export class JitSabaEsportsCatalogSource {
  readonly #fabet: FabetPageAccess;
  readonly #browser: SabaEsportsPageReader;

  constructor(options: {
    readonly fabet: FabetPageAccess;
    readonly browser: SabaEsportsPageReader;
  }) {
    this.#fabet = options.fabet;
    this.#browser = options.browser;
  }

  readCatalog(_input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly RawRecord[]> {
    return this.#fabet.withProviderPage("SABA", "LOL", async (page) => this.#browser.readCatalogFromPage(page));
  }
}
