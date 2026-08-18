import { describe, expect, it, vi } from "vitest";
import { refreshBridgeProviderSources } from "./provider-source-refresh.js";

describe("refreshBridgeProviderSources", () => {
  it("navigates every Fabet-derived provider to its newly captured launch instead of reloading an old token", async () => {
    const reloadAllSources = vi.fn(() => 6);
    const navigateLobby = vi.fn((_lobby: string, _url: string) => 1);
    const launchProviders: string[] = [];
    const withLatestFabetLaunch = async <T>(provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
      _category: "FOOTBALL", consume: (url: string) => Promise<T>, minAcquiredAtMs: number): Promise<T> => {
      launchProviders.push(provider);
      return consume(`https://${provider.toLowerCase()}.provider.test/fresh?opaque=1&after=${minAcquiredAtMs}`);
    };

    await expect(refreshBridgeProviderSources({
      controlPlane: { reloadAllSources, navigateLobby },
      withLatestFabetLaunch,
      minAcquiredAtMs: 123
    })).resolves.toBe(11);

    expect(reloadAllSources).toHaveBeenCalledOnce();
    expect(launchProviders).toEqual(["SABA", "IM", "SBOBET", "APSPORT", "BTI"]);
    expect(navigateLobby.mock.calls.map((call) => call[0])).toEqual([
      "SABA", "IM", "KSPORT", "TSPORT", "BTI"
    ]);
  });

  it("fails closed when one provider has no newly captured launch", async () => {
    const navigateLobby = vi.fn((_lobby: string, _url: string) => 1);
    const withLatestFabetLaunch = async <T>(provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
      _category: "FOOTBALL", consume: (url: string) => Promise<T>): Promise<T> => {
      if (provider === "IM") throw new Error("FABET_PROVIDER_LAUNCH_UNAVAILABLE");
      return consume(`https://${provider.toLowerCase()}.provider.test/fresh`);
    };

    await expect(refreshBridgeProviderSources({
      controlPlane: { reloadAllSources: () => 6, navigateLobby },
      withLatestFabetLaunch,
      minAcquiredAtMs: 123
    })).rejects.toThrow("FABET_PROVIDER_LAUNCH_UNAVAILABLE");
    expect(navigateLobby).not.toHaveBeenCalledWith("IM", expect.any(String));
  });

  it("fails when a fresh launch cannot be delivered to its attached lobby", async () => {
    const withLatestFabetLaunch = async <T>(provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
      _category: "FOOTBALL", consume: (url: string) => Promise<T>): Promise<T> =>
      consume(`https://${provider.toLowerCase()}.provider.test/fresh`);
    await expect(refreshBridgeProviderSources({
      controlPlane: { reloadAllSources: () => 6, navigateLobby: (lobby) => lobby === "BTI" ? 0 : 1 },
      withLatestFabetLaunch,
      minAcquiredAtMs: 123
    })).rejects.toThrow("CHROME_BRIDGE_NAVIGATION_UNDELIVERED:BTI");
  });
});
