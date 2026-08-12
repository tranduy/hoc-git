import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type { CmdCatalogInputRecord } from "@tool-chenh/adapters";
import { FabetSabaBrowserManager } from "./fabet-saba-browser-manager.js";

const catalog = [{ matchId: "match-1", sportId: "1", leagueId: "league-1", leagueName: "League",
  timeText: "Live", teamNames: ["Home", "Away"] as const, groups: [] }] satisfies readonly CmdCatalogInputRecord[];

describe("Fabet SABA browser manager", () => {
  it("uses the live Fabet popup for Fabet-issued SABA sessions instead of reopening the saved launch URL", async () => {
    const fallback = { readCatalog: vi.fn(async () => []), readAccountStore: vi.fn(),
      readTicketConstraint: vi.fn(), close: vi.fn(async () => undefined) };
    const manager = new FabetSabaBrowserManager({
      fabet: { withProviderPage: async (_provider, _category, consume) => consume({} as Page) },
      fallback,
      pageReader: { readCatalog: async () => catalog, readRawCatalog: async () => catalog,
        readAccountStore: async () => ({ balance: 100 }),
        readTicketConstraint: async () => null }
    });

    await expect(manager.readCatalog({ sessionId: "fabet-launch-saba-football-host", launchUrl: "https://expired.test" }))
      .resolves.toEqual(catalog);
    expect(fallback.readCatalog).not.toHaveBeenCalled();
  });

  it("retains direct launch behavior for a manually configured SABA token", async () => {
    const fallback = { readCatalog: vi.fn(async () => catalog), readAccountStore: vi.fn(),
      readTicketConstraint: vi.fn(), close: vi.fn(async () => undefined) };
    const manager = new FabetSabaBrowserManager({
      fabet: { withProviderPage: vi.fn() }, fallback,
      pageReader: { readCatalog: vi.fn(), readRawCatalog: vi.fn(), readAccountStore: vi.fn(), readTicketConstraint: vi.fn() }
    });

    await expect(manager.readCatalog({ sessionId: "manual-saba", launchUrl: "https://direct.test" }))
      .resolves.toEqual(catalog);
  });

  it("coalesces concurrent live raw-catalog reads so browser tabs cannot relaunch SABA repeatedly", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let providerPageCalls = 0;
    const fabet = { withProviderPage: async <T>(_provider: "SABA", _category: "FOOTBALL" | "LOL",
      consume: (page: Page) => Promise<T>): Promise<T> => { providerPageCalls += 1; return consume({} as Page); } };
    const readRawCatalog = vi.fn(async () => { await gate; return catalog; });
    const manager = new FabetSabaBrowserManager({
      fabet,
      fallback: { readCatalog: vi.fn(async () => []), readAccountStore: vi.fn(),
        readTicketConstraint: vi.fn(), close: vi.fn(async () => undefined) },
      pageReader: { readCatalog: vi.fn(), readRawCatalog, readAccountStore: vi.fn(), readTicketConstraint: vi.fn() }
    });
    const input = { sessionId: "fabet-launch-saba-football-host", launchUrl: "https://expired.test" };

    const first = manager.readRawCatalog(input);
    const second = manager.readRawCatalog(input);
    expect(providerPageCalls).toBe(1);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([catalog, catalog]);
    expect(readRawCatalog).toHaveBeenCalledTimes(1);
  });
});
