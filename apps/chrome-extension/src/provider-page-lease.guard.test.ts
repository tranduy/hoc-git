import { describe, expect, it, vi } from "vitest";
import { ProviderPageLeaseCoordinator, renewExactProviderTab } from "./provider-page-lease.js";

describe("queued provider recovery identity", () => {
  it("cancels a recovery queued behind another provider when native capture returns", async () => {
    let needed = true;
    let finish!: () => void;
    const renew = vi.fn(async (): Promise<void> => undefined);
    renew.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const coordinator = new ProviderPageLeaseCoordinator({ listAttached: () => [],
      isLoading: async () => false, loadState: async () => null, saveState: async () => undefined, renew });
    const bti = coordinator.renewNow({ lobby: "BTI", sourceId: "chrome:BTI:8", tabId: 8 });
    await vi.waitFor(() => expect(renew).toHaveBeenCalledTimes(1));
    const ap = coordinator.renewNow({ lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7,
      recoveryGuard: { isCurrent: () => needed, captureIdentity: () => () => true } });
    needed = false;
    finish();
    await Promise.all([bti, ap]);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it.each(["before-epoch", "during-bootstrap", "own-epoch"])("checks %s without cancelling its own claimed epoch", async phase => {
    let generation = 0;
    let reads = 0;
    const tab = { id: 7, url: "https://pacific.agenate.com/?agentId=4&periodId=2" };
    const update = vi.fn(async () => tab);
    const beginSourceEpoch = vi.fn(() => { generation++; });
    await renewExactProviderTab({ lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7,
      recoveryGuard: { isCurrent: () => generation === 0, captureIdentity: () => {
        const claimed = generation;
        return () => generation === claimed;
      } } }, {
      isAttached: () => true,
      get: async () => { if (++reads === 2 && phase === "before-epoch") generation++; return tab; },
      beginSourceEpoch,
      attachBootstrap: async () => { if (phase === "during-bootstrap") generation++; },
      update, waitForReady: async () => tab
    });
    expect(beginSourceEpoch).toHaveBeenCalledTimes(phase === "before-epoch" ? 0 : 1);
    expect(update).toHaveBeenCalledTimes(phase === "own-epoch" ? 1 : 0);
  });
});
