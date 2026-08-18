import { describe, expect, it, vi } from "vitest";
import { TabBootstrapper } from "./tab-bootstrapper.js";

describe("TabBootstrapper", () => {
  it("reloads an attached tab once per extension session after observation starts", async () => {
    const values = new Set<string>();
    const reload = vi.fn(async () => undefined);
    const bootstrapper = new TabBootstrapper({
      has: async (key) => values.has(key),
      mark: async (key) => { values.add(key); },
      reload
    });

    await bootstrapper.ensure({ lobby: "IM", tabId: 7, hostname: "imsports.directsb.net", state: "ATTACHED" });
    await bootstrapper.ensure({ lobby: "IM", tabId: 7, hostname: "imsports.directsb.net", state: "ATTACHED" });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(7);
  });

  it("isolates a failed reload and retries it later", async () => {
    const values = new Set<string>();
    const reload = vi.fn().mockRejectedValueOnce(new Error("tab gone")).mockResolvedValue(undefined);
    const bootstrapper = new TabBootstrapper({
      has: async (key) => values.has(key), mark: async (key) => { values.add(key); }, reload
    });

    await expect(bootstrapper.ensure({ lobby: "SABA", tabId: 8, hostname: "sports.example", state: "ATTACHED" }))
      .resolves.toBeUndefined();
    await bootstrapper.ensure({ lobby: "SABA", tabId: 8, hostname: "sports.example", state: "ATTACHED" });
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
