import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { JitBtiEsportsCatalogSource } from "./bti-esports-jit-source.js";

describe("JitBtiEsportsCatalogSource", () => {
  it("clicks the exact current BTI Esports card and reads in the Fabet-authenticated page", async () => {
    const page = {} as Page;
    const calls: Array<readonly [string, string]> = [];
    const fabet = { async withProviderPage<T>(provider: "BTI", category: "LOL",
      consume: (value: Page) => Promise<T>): Promise<T> {
      calls.push([provider, category]);
      return consume(page);
    } };
    const snapshot = { records: [], observedAtMs: 1, receivedMonotonicMs: 2 };
    const readCatalogFromPage = vi.fn(async () => snapshot);
    const source = new JitBtiEsportsCatalogSource({ fabet, browser: { readCatalogFromPage } });

    await expect(source.readCatalogFromFabet()).resolves.toBe(snapshot);
    expect(calls).toEqual([["BTI", "LOL"]]);
    expect(readCatalogFromPage).toHaveBeenCalledWith(page);
  });
});
