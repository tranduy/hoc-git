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
      pageReader: { readCatalog: async () => catalog, readAccountStore: async () => ({ balance: 100 }),
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
      pageReader: { readCatalog: vi.fn(), readAccountStore: vi.fn(), readTicketConstraint: vi.fn() }
    });

    await expect(manager.readCatalog({ sessionId: "manual-saba", launchUrl: "https://direct.test" }))
      .resolves.toEqual(catalog);
  });
});
