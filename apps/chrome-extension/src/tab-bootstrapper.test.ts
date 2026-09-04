import { describe, expect, it, vi } from "vitest";
import { TabBootstrapper } from "./tab-bootstrapper.js";

describe("TabBootstrapper", () => {
  it("does not hard-reload an attached tab without an explicit reset authorization", async () => {
    const reload = vi.fn(async () => undefined);
    const bootstrapper = new TabBootstrapper({
      has: async () => false,
      mark: async () => undefined,
      reload
    });

    await bootstrapper.ensure({ lobby: "CMD", tabId: 8, hostname: "cgnew.fts368.com", state: "ATTACHED" });

    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads an attached tab once when an explicit reset authorizes it", async () => {
    const values = new Set<string>();
    const reload = vi.fn(async () => undefined);
    const bootstrapper = new TabBootstrapper({
      has: async (key) => values.has(key),
      mark: async (key) => { values.add(key); },
      reload
    });

    await bootstrapper.ensure({ lobby: "IM", tabId: 7, hostname: "imsports.directsb.net", state: "ATTACHED" }, "EXPLICIT_RESET");
    await bootstrapper.ensure({ lobby: "IM", tabId: 7, hostname: "imsports.directsb.net", state: "ATTACHED" }, "EXPLICIT_RESET");

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(7);
  });

  it("isolates a failed reload and retries it later", async () => {
    const values = new Set<string>();
    const reload = vi.fn().mockRejectedValueOnce(new Error("tab gone")).mockResolvedValue(undefined);
    const bootstrapper = new TabBootstrapper({
      has: async (key) => values.has(key), mark: async (key) => { values.add(key); }, reload
    });

    await expect(bootstrapper.ensure({ lobby: "SABA", tabId: 8, hostname: "sports.example", state: "ATTACHED" }, "EXPLICIT_RESET"))
      .resolves.toBeUndefined();
    await bootstrapper.ensure({ lobby: "SABA", tabId: 8, hostname: "sports.example", state: "ATTACHED" }, "EXPLICIT_RESET");
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
