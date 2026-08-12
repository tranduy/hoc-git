import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { JitImFootballCatalogSource } from "./im-football-jit-source.js";

describe("JitImFootballCatalogSource", () => {
  it("clicks the current Fabet I-SPORTS card and reads inside that authenticated page", async () => {
    const page = {} as Page;
    const calls: Array<readonly [string, string]> = [];
    const fabet = { async withProviderPage<T>(provider: "IM", category: "FOOTBALL",
      consume: (value: Page) => Promise<T>): Promise<T> {
      calls.push([provider, category]);
      return consume(page);
    } };
    const snapshot = { records: [], observedAtMs: 1, receivedMonotonicMs: 2 };
    const readCatalogFromPage = vi.fn(async () => snapshot);
    const source = new JitImFootballCatalogSource({ fabet, browser: { readCatalogFromPage } });

    await expect(source.readCatalogFromFabet()).resolves.toBe(snapshot);
    expect(calls).toEqual([["IM", "FOOTBALL"]]);
    expect(readCatalogFromPage).toHaveBeenCalledWith(page);
  });
});
