import type { Page } from "playwright";
import type { ImEsportsMarketRecord } from "@tool-chenh/adapters";
import { describe, expect, it, vi } from "vitest";
import { JitImEsportsCatalogSource } from "./im-esports-jit-source.js";

describe("JitImEsportsCatalogSource", () => {
  it("clicks the current Fabet Esports card instead of replaying an expired launch URL", async () => {
    const page = {} as Page;
    const calls: Array<readonly [string, string]> = [];
    const fabet = { async withProviderPage<T>(provider: "IM", category: "LOL",
      consume: (value: Page) => Promise<T>): Promise<T> {
      calls.push([provider, category]);
      return consume(page);
    } };
    const records: readonly ImEsportsMarketRecord[] = [{
      sportId: 45, sportName: "LOL", leagueId: 7, leagueName: "LCK", parentMatchNo: 10,
      parentHomeId: 1, parentHomeName: "T1", parentAwayId: 2, parentAwayName: "G2",
      parentDate: "2026-08-13", matchNo: 11, gameTypeCode: "SeriesWin", gameTypeName: "Winner",
      marketGroup: "Series", gameOrder: 0, status: 1, isLive: true, matchDate: "2026-08-13",
      selections: []
    }];
    const readCatalogFromPage = vi.fn(async () => records);
    const source = new JitImEsportsCatalogSource({ fabet, browser: { readCatalogFromPage } });

    await expect(source.readCatalog({ sessionId: "stored-session", launchUrl: "https://expired.invalid/once" }))
      .resolves.toBe(records);
    expect(calls).toEqual([["IM", "LOL"]]);
    expect(readCatalogFromPage).toHaveBeenCalledWith(page);
  });
});
