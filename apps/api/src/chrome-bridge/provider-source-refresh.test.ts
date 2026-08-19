import { describe, expect, it, vi } from "vitest";
import { refreshBridgeProviderSources } from "./provider-source-refresh.js";

describe("refreshBridgeProviderSources", () => {
  it("ensures CMD and every Fabet-derived provider from newly acquired launches", async () => {
    const ensureLobby = vi.fn((_lobby: string, _url: string) => 1);
    const launchProviders: string[] = [];
    const withLatestFabetLaunch = async <T>(provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
      _category: "FOOTBALL", consume: (url: string) => Promise<T>, minAcquiredAtMs: number): Promise<T> => {
      launchProviders.push(provider);
      return consume(`https://${provider.toLowerCase()}.provider.test/fresh?opaque=1&after=${minAcquiredAtMs}`);
    };

    await expect(refreshBridgeProviderSources({
      controlPlane: { ensureLobby, restoreLobby: vi.fn(() => 1) },
      withLatestFabetLaunch,
      minAcquiredAtMs: 123
    })).resolves.toBe(6);

    expect(launchProviders).toEqual(["SABA", "IM", "SBOBET", "APSPORT", "BTI"]);
    expect(ensureLobby.mock.calls.map((call) => call[0])).toEqual([
      "SABA", "IM", "KSPORT", "TSPORT", "BTI"
    ]);
  });

  it("fails closed when one provider has no newly captured launch", async () => {
    const ensureLobby = vi.fn((_lobby: string, _url: string) => 1);
    const withLatestFabetLaunch = async <T>(provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
      _category: "FOOTBALL", consume: (url: string) => Promise<T>): Promise<T> => {
      if (provider === "IM") throw new Error("FABET_PROVIDER_LAUNCH_UNAVAILABLE");
      return consume(`https://${provider.toLowerCase()}.provider.test/fresh`);
    };

    await expect(refreshBridgeProviderSources({
      controlPlane: { ensureLobby, restoreLobby: vi.fn(() => 1) },
      withLatestFabetLaunch,
      minAcquiredAtMs: 123
    })).rejects.toThrow("FABET_PROVIDER_LAUNCH_UNAVAILABLE");
    expect(ensureLobby).not.toHaveBeenCalled();
  });

  it("fails when a fresh launch cannot be delivered to its attached lobby", async () => {
    const withLatestFabetLaunch = async <T>(provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
      _category: "FOOTBALL", consume: (url: string) => Promise<T>): Promise<T> =>
      consume(`https://${provider.toLowerCase()}.provider.test/fresh`);
    await expect(refreshBridgeProviderSources({
      controlPlane: { ensureLobby: (lobby) => lobby === "BTI" ? 0 : 1, restoreLobby: () => 1 },
      withLatestFabetLaunch,
      minAcquiredAtMs: 123
    })).rejects.toThrow("CHROME_BRIDGE_ENSURE_UNDELIVERED:BTI");
  });

  it("fails when the extension cannot receive the closed CMD restore request", async () => {
    const ensureLobby = vi.fn(() => 1);
    const withLatestFabetLaunch = async <T>(provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
      _category: "FOOTBALL", consume: (url: string) => Promise<T>): Promise<T> =>
      consume(`https://${provider.toLowerCase()}.provider.test/fresh`);
    await expect(refreshBridgeProviderSources({
      controlPlane: { ensureLobby, restoreLobby: () => 0 }, withLatestFabetLaunch, minAcquiredAtMs: 123
    })).rejects.toThrow("CHROME_BRIDGE_RESTORE_UNDELIVERED:CMD");
    expect(ensureLobby).toHaveBeenCalledTimes(5);
  });
});
