import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceLaunchMemory } from "./source-launch-memory.js";
import { SourceTabRecovery } from "./source-tab-recovery.js";

afterEach(() => vi.unstubAllGlobals());

describe("SourceLaunchMemory", () => {
  it("keeps one in-memory launch slot for every recognized lobby", () => {
    const memory = new SourceLaunchMemory();
    const launches = [
      ["IM", "https://imsports.directsb.net/live?token=im"],
      ["BTI", "https://prod20091.fxf774.com/live?token=bti"],
      ["TSPORT", "https://pacific.agenate.com/live?token=tsport"],
      ["KSPORT", "https://zenandfe.com/sportsbook?token=ksport"],
      ["SABA", "https://c0z0oa.bpd3a3fn.com/live?token=saba"],
      ["CMD", "https://cgnew.fts368.com/live?token=cmd"],
      ["SBO", "https://sports-sbomaind-play.jjsskktt.com/live?token=sbo"]
    ] as const;

    launches.forEach(([lobby, url], index) => memory.rememberRecognized({ id: index + 1, url }));
    memory.rememberRecognized({ id: 99, url: "https://unrecognized.example/?token=ignore" });

    launches.forEach(([lobby, url]) => expect(memory.load(lobby)).toBe(url));
  });

  it("keeps a signed recognized KSPORT launch out of Chrome storage while feeding same-worker recovery", async () => {
    const sessionGet = vi.fn();
    const sessionSet = vi.fn();
    const sessionRemove = vi.fn();
    const localGet = vi.fn();
    const localSet = vi.fn();
    const localRemove = vi.fn();
    vi.stubGlobal("chrome", {
      storage: {
        session: { get: sessionGet, set: sessionSet, remove: sessionRemove },
        local: { get: localGet, set: localSet, remove: localRemove }
      }
    });
    const memory = new SourceLaunchMemory();
    const signedUrl = "https://zenandfe.com/sportsbook?token=one-time-secret";
    const update = vi.fn(async (tabId: number, url: string) => ({ id: tabId, url, title: "Sportsbook" }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [],
      query: async () => [],
      create: async (url) => ({ id: 8, url }),
      update,
      remove: async () => undefined,
      attach: async () => undefined,
      attachBootstrap: async () => undefined,
      usePortalLaunch: false,
      loadRemembered: async (lobby) => memory.load(lobby)
    });

    memory.rememberRecognized({ id: 7, url: signedUrl, title: "Sportsbook" });
    await recovery.restore("KSPORT");

    expect(memory.load("KSPORT")).toBe(signedUrl);
    expect(update).toHaveBeenCalledWith(8, expect.stringContaining("token=one-time-secret"));
    expect(sessionGet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    expect(sessionRemove).not.toHaveBeenCalled();
    expect(localGet).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    expect(localRemove).not.toHaveBeenCalled();
  });

  it("starts empty after a worker restart and fails closed when no provider tab remains", async () => {
    const beforeRestart = new SourceLaunchMemory();
    beforeRestart.rememberRecognized({ id: 7,
      url: "https://zenandfe.com/sportsbook?token=one-time-secret", title: "Sportsbook" });
    const afterRestart = new SourceLaunchMemory();
    const recovery = new SourceTabRecovery({
      listAttached: () => [],
      query: async () => [],
      create: async (url) => ({ id: 8, url }),
      update: async (tabId, url) => ({ id: tabId, url }),
      remove: async () => undefined,
      attach: async () => undefined,
      loadRemembered: async (lobby) => afterRestart.load(lobby)
    });

    expect(beforeRestart.load("KSPORT")).toContain("one-time-secret");
    expect(afterRestart.load("KSPORT")).toBeNull();
    await expect(recovery.restore("KSPORT")).rejects.toThrow("SOURCE_RESTORE_UNAVAILABLE:KSPORT");
  });
});
