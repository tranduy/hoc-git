import { describe, expect, it, vi } from "vitest";
import { AutomaticSourceRecovery } from "./automatic-source-recovery.js";

describe("AutomaticSourceRecovery", () => {
  const launchReader = async <T>(provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
    _category: "FOOTBALL", consume: (url: string) => Promise<T>): Promise<T> =>
    consume(`https://${provider.toLowerCase()}.provider.test/fresh`);

  it("restores only CMD instead of starting a global maintenance reset", async () => {
    const restoreLobby = vi.fn(() => 1);
    const ensureLobby = vi.fn(() => 1);
    const refreshFabetLaunches = vi.fn(async () => undefined);
    const recovery = new AutomaticSourceRecovery({
      controlPlane: { ensureLobby, restoreLobby },
      refreshFabetLaunches,
      withLatestFabetLaunch: launchReader
    });

    await recovery.recover("catalog-source:CMD:FOOTBALL");

    expect(restoreLobby).toHaveBeenCalledExactlyOnceWith("CMD");
    expect(ensureLobby).not.toHaveBeenCalled();
    expect(refreshFabetLaunches).not.toHaveBeenCalled();
  });

  it("renews launches without restarting healthy readers and replaces only the stalled Fabet provider", async () => {
    const restoreLobby = vi.fn(() => 1);
    const ensureLobby = vi.fn(() => 1);
    const refreshFabetLaunches = vi.fn(async () => undefined);
    const recovery = new AutomaticSourceRecovery({
      controlPlane: { ensureLobby, restoreLobby },
      refreshFabetLaunches,
      withLatestFabetLaunch: launchReader,
      now: () => 123
    });

    await recovery.recover("catalog-source:BTI:FOOTBALL");

    expect(refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(ensureLobby).toHaveBeenCalledExactlyOnceWith("BTI", "https://bti.provider.test/fresh");
    expect(restoreLobby).not.toHaveBeenCalled();
  });

  it("falls back to reloading the existing SABA tab when no Fabet launch exists", async () => {
    const reloadLobby = vi.fn(() => 1);
    const errors: unknown[] = [];
    const recovery = new AutomaticSourceRecovery({
      controlPlane: { ensureLobby: vi.fn(() => 1), restoreLobby: vi.fn(() => 1), reloadLobby },
      refreshFabetLaunches: vi.fn(async () => { throw new Error("SESSION_NOT_FOUND"); }),
      withLatestFabetLaunch: launchReader,
      onError: (_accountId, error) => errors.push(error)
    });

    await recovery.recover("catalog-source:SABA:FOOTBALL");
    expect(reloadLobby).toHaveBeenCalledExactlyOnceWith("SABA");
    expect(errors).toEqual([]);

    // BTI holds a one-time launch URL: reloading its tab would burn it, so the
    // failure must surface instead.
    await recovery.recover("catalog-source:BTI:FOOTBALL");
    expect(reloadLobby).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
  });

  it("ignores unknown catalog identities instead of resetting every source", async () => {
    const restoreLobby = vi.fn(() => 1);
    const ensureLobby = vi.fn(() => 1);
    const refreshFabetLaunches = vi.fn(async () => undefined);
    const recovery = new AutomaticSourceRecovery({
      controlPlane: { ensureLobby, restoreLobby },
      refreshFabetLaunches,
      withLatestFabetLaunch: launchReader
    });

    await recovery.recover("catalog-source:UNKNOWN:FOOTBALL");

    expect(refreshFabetLaunches).not.toHaveBeenCalled();
    expect(ensureLobby).not.toHaveBeenCalled();
    expect(restoreLobby).not.toHaveBeenCalled();
  });

  it("coalesces repeated stall notifications for the same source", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const refreshFabetLaunches = vi.fn(async () => pending);
    const ensureLobby = vi.fn(() => 1);
    const recovery = new AutomaticSourceRecovery({
      controlPlane: { ensureLobby, restoreLobby: vi.fn(() => 1) },
      refreshFabetLaunches,
      withLatestFabetLaunch: launchReader
    });

    const first = recovery.recover("catalog-source:IM:FOOTBALL");
    const second = recovery.recover("catalog-source:IM:FOOTBALL");
    release();
    await Promise.all([first, second]);

    expect(refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(ensureLobby).toHaveBeenCalledOnce();
  });
});
