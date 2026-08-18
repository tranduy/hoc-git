import type { Page } from "playwright";
import type { CmdCatalogInputRecord } from "@tool-chenh/adapters";
import { describe, expect, it, vi } from "vitest";
import { JitCmdFootballCatalogSource } from "./cmd-football-jit-source.js";

describe("JitCmdFootballCatalogSource", () => {
  it("clicks the current Fabet CMD Football card and reads its authenticated page", async () => {
    const page = {} as Page;
    const calls: Array<readonly [string, string]> = [];
    const fabet = { async withProviderPage<T>(provider: "CMD", category: "FOOTBALL",
      consume: (value: Page) => Promise<T>): Promise<T> {
      calls.push([provider, category]);
      return consume(page);
    } };
    const snapshot = { records: [], observedAtMs: 1, receivedMonotonicMs: 2 };
    const readCatalogFromPage = vi.fn(async () => snapshot);
    const source = new JitCmdFootballCatalogSource({ fabet, browser: { readCatalogFromPage } });

    await expect(source.readCatalogFromFabet()).resolves.toBe(snapshot);
    expect(calls).toEqual([["CMD", "FOOTBALL"]]);
    expect(readCatalogFromPage).toHaveBeenCalledWith(page);
  });

  it("coalesces a missing CMD card and backs off before probing the lobby again", async () => {
    let nowMs = 100;
    const withProviderPage = vi.fn(async () => { throw new Error("FABET_PROVIDER_LAUNCH_UNAVAILABLE"); });
    const source = new JitCmdFootballCatalogSource({ fabet: { withProviderPage },
      browser: { readCatalogFromPage: vi.fn() }, clock: { nowMs: () => nowMs }, retryBackoffMs: 60_000 });

    await Promise.allSettled([source.readCatalogFromFabet(), source.readCatalogFromFabet()]);
    await expect(source.readCatalogFromFabet()).rejects.toThrow("CMD_FABET_SOURCE_BACKOFF");
    expect(withProviderPage).toHaveBeenCalledTimes(1);

    nowMs += 60_000;
    await expect(source.readCatalogFromFabet()).rejects.toThrow("FABET_PROVIDER_LAUNCH_UNAVAILABLE");
    expect(withProviderPage).toHaveBeenCalledTimes(2);
  });

  it("falls back to the newest active direct CMD Football launch", async () => {
    const records = [{ sportId: "1", leagueId: "l", leagueName: "League", matchId: "m",
      timeText: "1H10'", teamNames: ["A", "B"], groups: [] }] satisfies readonly CmdCatalogInputRecord[];
    const readCatalog = vi.fn(async () => records);
    const source = new JitCmdFootballCatalogSource({
      fabet: { withProviderPage: async () => { throw new Error("FABET_PROVIDER_LAUNCH_UNAVAILABLE"); } },
      browser: { readCatalogFromPage: vi.fn(), readCatalog },
      sessionAccess: {
        listStatuses: async () => ({ sessions: [{ id: "direct-cmd", provider: "CMD", category: "FOOTBALL",
          source: "MANUAL_PROVIDER_SESSION", state: "ACTIVE", acquiredAtMs: 200 }] }),
        getActiveSecretHandle: async () => ({ sessionId: "direct-cmd", provider: "CMD",
          withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://cmd.example/launch" }) })
      },
      clock: { nowMs: () => 300 }
    });

    await expect(source.readCatalogFromFabet()).resolves.toMatchObject({ records, observedAtMs: 300 });
    expect(readCatalog).toHaveBeenCalledWith({ sessionId: "direct-cmd", launchUrl: "https://cmd.example/launch" });
  });

  it("reads a uniquely verified CMD Football page from the managed TK88 profile before direct launch fallback", async () => {
    const page = {} as Page;
    const snapshot = { records: [], observedAtMs: 10, receivedMonotonicMs: 20 };
    const readCatalogFromPage = vi.fn(async () => snapshot);
    const source = new JitCmdFootballCatalogSource({
      fabet: { withProviderPage: async () => { throw new Error("FABET_PROVIDER_LAUNCH_UNAVAILABLE"); } },
      tk88: { withProviderPage: async (consume) => consume(page) },
      browser: { readCatalogFromPage, readCatalog: vi.fn(async () => []) },
      sessionAccess: {
        listStatuses: async () => ({ sessions: [{ id: "direct-cmd", provider: "CMD", category: "FOOTBALL",
          source: "MANUAL_PROVIDER_SESSION", state: "ACTIVE", acquiredAtMs: 200 }] }),
        getActiveSecretHandle: async () => ({ sessionId: "direct-cmd", provider: "CMD",
          withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://cmd.example/launch" }) })
      }
    });

    await expect(source.readCatalogFromFabet()).resolves.toBe(snapshot);
    expect(readCatalogFromPage).toHaveBeenCalledWith(page);
  });

  it("continues from TK88 to a direct launch when no verified TK88 CMD page exists", async () => {
    const records = [] satisfies readonly CmdCatalogInputRecord[];
    const readCatalog = vi.fn(async () => records);
    const source = new JitCmdFootballCatalogSource({
      fabet: { withProviderPage: async () => { throw new Error("FABET_PROVIDER_LAUNCH_UNAVAILABLE"); } },
      tk88: { withProviderPage: async () => { throw new Error("TK88_PROVIDER_PAGE_UNAVAILABLE"); } },
      browser: { readCatalogFromPage: vi.fn(), readCatalog },
      sessionAccess: {
        listStatuses: async () => ({ sessions: [{ id: "direct-cmd", provider: "CMD", category: "FOOTBALL",
          source: "MANUAL_PROVIDER_SESSION", state: "ACTIVE", acquiredAtMs: 200 }] }),
        getActiveSecretHandle: async () => ({ sessionId: "direct-cmd", provider: "CMD",
          withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://cmd.example/launch" }) })
      }
    });

    await expect(source.readCatalogFromFabet()).resolves.toMatchObject({ records });
    expect(readCatalog).toHaveBeenCalledTimes(1);
  });
});
