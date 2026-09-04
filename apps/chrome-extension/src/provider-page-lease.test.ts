import { describe, expect, it, vi } from "vitest";

describe("provider page renewal URL policy", () => {
  it("never schedules IM or SABA for destructive tokenless page renewal", async () => {
    const { isRenewableLobby } = await import("./provider-page-lease.js");

    expect(isRenewableLobby("IM")).toBe(false);
    expect(isRenewableLobby("SABA")).toBe(false);
  });

  it.each([
    ["BTI", "https://prod20091.fxf774.com/old?operatorToken=secret", 1_000,
      "https://prod20091.fxf774.com/vi/asian-view/today/B%C3%B3ng-%C4%91%C3%A1?operatorToken=logout"],
    ["IM", "https://imsports.directsb.net/live?token=secret", 1_000,
      "https://imsports.directsb.net/?languageCode=vi&t=1000"],
    ["TSPORT", "https://pacific.agenate.com/?agentId=4&lng=vi&loginUrl=x&registerUrl=y&t=7&sportType=1_1&sportId=1&periodId=2&token=secret", 9_000,
      "https://pacific.agenate.com/?agentId=4&lng=vi&t=9000&sportType=1_1&sportId=1&periodId=2"],
    ["KSPORT", "https://zenandfe.com/?agentId=4&sportId=9&lng=en&t=7&token=secret", 9_001,
      "https://zenandfe.com/?agentId=4&sportId=1&lng=vi&t=9001"],
    ["SABA", "https://c0z0oa.bpd3a3fn.com/(S(expired))/NewIndex?lang=vn&webskintype=3&scmt=tab02&ssmt=tab02&matchid=42&leaguekey=9&token=secret", 9_002,
      "https://c0z0oa.bpd3a3fn.com/NewIndex?lang=vn&webskintype=3&scmt=tab02&ssmt=tab02"]
  ] as const)("builds a tokenless %s renewal URL", async (lobby, currentUrl, nowMs, expected) => {
    const { providerRenewalUrl } = await import("./provider-page-lease.js");

    expect(providerRenewalUrl(lobby, currentUrl, nowMs)).toBe(expected);
  });

  it("defaults the public APSPORT and KSPORT parameters without preserving arbitrary query data", async () => {
    const { providerRenewalUrl } = await import("./provider-page-lease.js");

    expect(providerRenewalUrl("TSPORT", "https://pacific.agenate.com/?junk=secret&periodId=4", 12))
      .toBe("https://pacific.agenate.com/?agentId=4&lng=vi&t=12&sportType=1_1&sportId=1&periodId=4");
    expect(providerRenewalUrl("KSPORT", "https://zenandfe.com/?junk=secret", 13))
      .toBe("https://zenandfe.com/?agentId=4&sportId=1&lng=vi&t=13");
  });

  it("rejects a provider URL whose trusted host does not match the requested lobby", async () => {
    const { providerRenewalUrl } = await import("./provider-page-lease.js");

    expect(() => providerRenewalUrl("BTI", "https://imsports.directsb.net/", 1))
      .toThrow("UNTRUSTED_PROVIDER_RENEWAL_URL");
  });
});

describe("exact provider tab renewal", () => {
  it("rearms the observer before navigating the exact tab and confirms it after the redirect", async () => {
    const { renewExactProviderTab } = await import("./provider-page-lease.js");
    const source = { lobby: "TSPORT" as const, sourceId: "chrome:TSPORT:7", tabId: 7 };
    const calls: string[] = [];
    const update = vi.fn(async (tabId: number, url: string) => {
      calls.push(`update:${tabId}:${url}`);
      return { id: tabId, url };
    });

    await renewExactProviderTab(source, {
      now: () => 9_000,
      isAttached: (candidate) => candidate === source,
      get: async (tabId) => ({ id: tabId,
        url: "https://pacific.agenate.com/?agentId=4&lng=vi&periodId=2&t=1" }),
      attachBootstrap: async (tab, lobby) => { calls.push(`attach:${lobby}:${tab.id}`); },
      beginSourceEpoch: (sourceId) => { calls.push(`epoch:${sourceId}`); },
      update,
      waitForReady: async (tabId, lobby) => {
        calls.push(`ready:${lobby}:${tabId}`);
        return { id: tabId, url: "https://pacific.agenate.com/?agentId=4&lng=vi&t=9000" };
      }
    });

    expect(calls).toEqual([
      "epoch:chrome:TSPORT:7",
      "attach:TSPORT:7",
      "update:7:https://pacific.agenate.com/?agentId=4&lng=vi&t=9000&sportType=1_1&sportId=1&periodId=2",
      "ready:TSPORT:7",
      "attach:TSPORT:7"
    ]);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the source is replaced during post-navigation observer bootstrap", async () => {
    const { renewExactProviderTab } = await import("./provider-page-lease.js");
    const source = { lobby: "IM" as const, sourceId: "chrome:IM:7", tabId: 7 };
    let attached = true;
    let attachCalls = 0;
    const update = vi.fn(async () => ({ id: 7, url: "https://imsports.directsb.net/?languageCode=vi" }));

    await expect(renewExactProviderTab(source, {
      isAttached: () => attached,
      get: async () => ({ id: 7, url: "https://imsports.directsb.net/" }),
      attachBootstrap: async () => { if (++attachCalls === 2) attached = false; },
      beginSourceEpoch: vi.fn(),
      update,
      waitForReady: async () => ({ id: 7, url: "https://imsports.directsb.net/?languageCode=vi" })
    })).rejects.toThrow("PROVIDER_SOURCE_REPLACED");

    expect(update).toHaveBeenCalledOnce();
  });

  it("restores a SABA source that Chrome detached while creating its redirected session URL", async () => {
    const { renewExactProviderTab } = await import("./provider-page-lease.js");
    const source = { lobby: "SABA" as const, sourceId: "chrome:SABA:9", tabId: 9 };
    let attached = true;
    const attachBootstrap = vi.fn(async () => { attached = true; });

    await renewExactProviderTab(source, {
      now: () => 9_002,
      isAttached: () => attached,
      get: async () => ({ id: 9,
        url: "https://c0z0oa.bpd3a3fn.com/(S(expired))/NewIndex?lang=vn&webskintype=3" }),
      attachBootstrap,
      beginSourceEpoch: vi.fn(),
      update: async (tabId, url) => {
        attached = false;
        return { id: tabId, url };
      },
      waitForReady: async (tabId) => ({ id: tabId,
        url: "https://c0z0oa.bpd3a3fn.com/(S(fresh))/NewIndex?lang=vn&webskintype=3" })
    });

    expect(attached).toBe(true);
    expect(attachBootstrap).toHaveBeenCalledWith(expect.objectContaining({
      id: 9, url: expect.stringContaining("/(S(fresh))/NewIndex")
    }), "SABA");
  });
});

describe("provider page lease coordinator", () => {
  const BTI = { lobby: "BTI" as const, sourceId: "chrome:BTI:7", tabId: 7 };
  const IM = { lobby: "IM" as const, sourceId: "chrome:IM:8", tabId: 8 };

  it("strictly parses one persisted schedule for every renewable lobby", async () => {
    const { parseProviderPageLeaseState } = await import("./provider-page-lease.js");
    const valid = {
      BTI: { lastCompletedAtMs: 1, nextAttemptAtMs: 2 },
      IM: { lastCompletedAtMs: 1, nextAttemptAtMs: 2 },
      TSPORT: { lastCompletedAtMs: 1, nextAttemptAtMs: 2 },
      KSPORT: { lastCompletedAtMs: 1, nextAttemptAtMs: 2 },
      SABA: { lastCompletedAtMs: 1, nextAttemptAtMs: 2 }
    };

    expect(parseProviderPageLeaseState(valid)).toEqual(valid);
    expect(parseProviderPageLeaseState({ ...valid,
      SABA: { lastCompletedAtMs: 2, nextAttemptAtMs: 1 } })).toBeNull();
    expect(parseProviderPageLeaseState({ ...valid, IM: null })).toBeNull();
  });

  it("seeds staggered first renewals and performs no immediate navigation", async () => {
    const { ProviderPageLeaseCoordinator } = await import("./provider-page-lease.js");
    let stored: unknown = null;
    const renew = vi.fn(async () => undefined);
    const coordinator = new ProviderPageLeaseCoordinator({
      now: () => 1_000,
      listAttached: () => [BTI, IM],
      isLoading: async () => false,
      loadState: async () => null,
      saveState: async (state) => { stored = state; },
      renew
    });

    await coordinator.tick();

    expect(stored).toEqual({
      BTI: { lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_321_000 },
      IM: { lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_441_000 },
      TSPORT: { lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_561_000 },
      KSPORT: { lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_681_000 },
      SABA: { lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_801_000 }
    });
    expect(renew).not.toHaveBeenCalled();
  });

  it("renews only the oldest due attached lobby in one tick", async () => {
    const { ProviderPageLeaseCoordinator } = await import("./provider-page-lease.js");
    const schedules = leaseSchedules(1_000);
    schedules.BTI.nextAttemptAtMs = 2_000;
    schedules.IM.nextAttemptAtMs = 3_000;
    const renew = vi.fn(async () => undefined);
    const coordinator = new ProviderPageLeaseCoordinator({
      now: () => 4_000,
      listAttached: () => [IM, BTI],
      isLoading: async () => false,
      loadState: async () => schedules,
      saveState: async () => undefined,
      renew
    });

    await coordinator.tick();

    expect(renew).toHaveBeenCalledExactlyOnceWith(BTI);
    expect(schedules.BTI).toEqual({ lastCompletedAtMs: 4_000, nextAttemptAtMs: 1_204_000 });
    expect(schedules.IM.nextAttemptAtMs).toBe(3_000);
  });

  it("defers a loading tab for thirty seconds without blocking another tick forever", async () => {
    const { ProviderPageLeaseCoordinator } = await import("./provider-page-lease.js");
    const schedules = leaseSchedules(1_000);
    schedules.BTI.nextAttemptAtMs = 2_000;
    const renew = vi.fn(async () => undefined);
    const coordinator = new ProviderPageLeaseCoordinator({
      now: () => 4_000,
      listAttached: () => [BTI],
      isLoading: async () => true,
      loadState: async () => schedules,
      saveState: async () => undefined,
      renew
    });

    await coordinator.tick();

    expect(renew).not.toHaveBeenCalled();
    expect(schedules.BTI).toEqual({ lastCompletedAtMs: 1_000, nextAttemptAtMs: 34_000 });
  });

  it("persists a five-minute cooldown after a scheduled renewal failure", async () => {
    const { ProviderPageLeaseCoordinator } = await import("./provider-page-lease.js");
    const schedules = leaseSchedules(1_000);
    schedules.BTI.nextAttemptAtMs = 2_000;
    const coordinator = new ProviderPageLeaseCoordinator({
      now: () => 4_000,
      listAttached: () => [BTI],
      isLoading: async () => false,
      loadState: async () => schedules,
      saveState: async () => undefined,
      renew: async () => { throw new Error("RENEW_FAILED"); }
    });

    await expect(coordinator.tick()).resolves.toBeUndefined();
    expect(schedules.BTI).toEqual({ lastCompletedAtMs: 1_000, nextAttemptAtMs: 304_000 });
  });

  it("coalesces a manual renewal with the same already-running scheduled source", async () => {
    const { ProviderPageLeaseCoordinator } = await import("./provider-page-lease.js");
    const schedules = leaseSchedules(1_000);
    schedules.BTI.nextAttemptAtMs = 2_000;
    let release!: () => void;
    const renew = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const coordinator = new ProviderPageLeaseCoordinator({
      now: () => 4_000,
      listAttached: () => [BTI],
      isLoading: async () => false,
      loadState: async () => schedules,
      saveState: async () => undefined,
      renew
    });

    const scheduled = coordinator.tick();
    await vi.waitFor(() => expect(renew).toHaveBeenCalledOnce());
    const manual = coordinator.renewNow(BTI);
    release();
    await Promise.all([scheduled, manual]);

    expect(renew).toHaveBeenCalledOnce();
  });
});

function leaseSchedules(lastCompletedAtMs: number): Record<"BTI" | "IM" | "TSPORT" | "KSPORT" | "SABA",
  { lastCompletedAtMs: number; nextAttemptAtMs: number }> {
  return {
    BTI: { lastCompletedAtMs, nextAttemptAtMs: Number.MAX_SAFE_INTEGER },
    IM: { lastCompletedAtMs, nextAttemptAtMs: Number.MAX_SAFE_INTEGER },
    TSPORT: { lastCompletedAtMs, nextAttemptAtMs: Number.MAX_SAFE_INTEGER },
    KSPORT: { lastCompletedAtMs, nextAttemptAtMs: Number.MAX_SAFE_INTEGER },
    SABA: { lastCompletedAtMs, nextAttemptAtMs: Number.MAX_SAFE_INTEGER }
  };
}
