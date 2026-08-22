import { describe, expect, it, vi } from "vitest";
import type { ActiveSecretHandle, ProviderSecret } from "../../sessions/types.js";
import { CmdPollingCatalogSource } from "./cmd-catalog-source.js";

function handle(secret: ProviderSecret): ActiveSecretHandle {
  return { sessionId: "cmd-session", provider: "CMD", withSecret: async (consume) => consume(secret) };
}

describe("CmdPollingCatalogSource", () => {
  it("polls the read-only browser catalog with increasing full-snapshot sequences", async () => {
    const controller = new AbortController();
    const readCatalog = vi.fn(async () => [{
      sportId: "1" as const, leagueId: "l", leagueName: "League", matchId: "m",
      timeText: "08/17 02:30AM", teamNames: ["A", "B"], groups: []
    }]);
    let wall = 1_000;
    const source = new CmdPollingCatalogSource({
      handle: handle({ kind: "LAUNCH_URL", value: "https://provider.test/launch?unit=1" }),
      reader: { readCatalog },
      clock: { now: () => ({ wallClockNowMs: wall++, monotonicNowMs: wall * 10 }) },
      scheduler: { wait: async () => undefined },
      pollingIntervalMs: 250,
      timezoneOffsetMinutes: 420
    });
    const snapshots = [];
    for await (const snapshot of source.snapshots(controller.signal)) {
      snapshots.push(snapshot);
      if (snapshots.length === 2) controller.abort();
    }
    expect(snapshots.map((snapshot) => snapshot.sequence)).toEqual([1, 2]);
    expect(readCatalog).toHaveBeenCalledTimes(2);
    expect(readCatalog).toHaveBeenCalledWith({
      sessionId: "cmd-session", launchUrl: "https://provider.test/launch?unit=1"
    });
  });

  it("rejects non-CMD or non-launch session material without exposing it", async () => {
    const privateToken = "private-token-canary";
    const source = new CmdPollingCatalogSource({
      handle: handle({ kind: "TOKEN", value: privateToken }),
      reader: { readCatalog: vi.fn() },
      clock: { now: () => ({ wallClockNowMs: 1, monotonicNowMs: 1 }) },
      scheduler: { wait: async () => undefined }, pollingIntervalMs: 250, timezoneOffsetMinutes: 420
    });
    const consume = async () => { for await (const _snapshot of source.snapshots(new AbortController().signal)) break; };
    await expect(consume()).rejects.toThrow("CMD_CATALOG_UNAVAILABLE");
    await expect(consume()).rejects.not.toThrow(privateToken);
  });
});
