import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { JitSabaEsportsCatalogSource } from "./saba-esports-jit-source.js";

describe("JitSabaEsportsCatalogSource", () => {
  it("clicks the current Fabet LoL card instead of reusing its one-time launch URL", async () => {
    const page = {} as Page;
    const calls: Array<readonly [string, string]> = [];
    const fabet = { async withProviderPage<T>(provider: "SABA", category: "LOL",
      consume: (value: Page) => Promise<T>): Promise<T> {
      calls.push([provider, category]);
      return consume(page);
    } };
    const readCatalogFromPage = vi.fn(async () => [{ providerEventId: "live" }]);
    const source = new JitSabaEsportsCatalogSource({ fabet, browser: { readCatalogFromPage } });

    await expect(source.readCatalog({ sessionId: "stored-session", launchUrl: "https://expired.invalid/once" }))
      .resolves.toEqual([{ providerEventId: "live" }]);
    expect(calls).toEqual([["SABA", "LOL"]]);
    expect(readCatalogFromPage).toHaveBeenCalledWith(page);
  });
});
