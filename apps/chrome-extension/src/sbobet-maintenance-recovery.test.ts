import { describe, expect, it, vi } from "vitest";
import { SourceTabRecovery } from "./source-tab-recovery.js";
import { renewExactProviderTab } from "./provider-page-lease.js";

const tab = { id: 14, url: "https://zenandfe.com/?agentId=4&sportId=1" };
describe("SBO recovery respects a pause started during asynchronous attachment", () => {
  it.each(["ensure", "restore"] as const)("stops %s before navigation", async action => {
    let allowed = true;
    const update = vi.fn(async () => tab), reload = vi.fn(async () => tab);
    const recovery = new SourceTabRecovery({ canRecover: () => allowed,
      listAttached: () => [{ lobby: "KSPORT", tabId: tab.id }], query: async () => [tab],
      create: async () => tab, attach: async () => { allowed = false; }, update, reload });
    await expect(action === "ensure" ? recovery.ensure("KSPORT", tab.url) : recovery.restore("KSPORT"))
      .rejects.toThrow("SOURCE_REQUEST_BACKOFF");
    expect(update).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  });
  it("stops renewal after attach when another lane has failed", async () => {
    let allowed = true;
    const update = vi.fn(async () => tab);
    await expect(renewExactProviderTab({ lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 }, {
      canRenew: () => allowed, isAttached: () => true, get: async () => tab,
      attachBootstrap: async () => { allowed = false; }, beginSourceEpoch: () => undefined,
      update, waitForReady: async () => tab
    })).rejects.toThrow("SOURCE_REQUEST_BACKOFF");
    expect(update).not.toHaveBeenCalled();
  });
});
