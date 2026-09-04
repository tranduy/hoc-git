import { describe, expect, it, vi } from "vitest";
import { reloadAttachedSourceTab } from "./source-tab-reload.js";

describe("reloadAttachedSourceTab", () => {
  it("reloads SABA through its already-attached CDP target", async () => {
    const operations: string[] = [];
    const reloadBrowserTab = vi.fn(async () => { operations.push("tabs.reload"); });

    await expect(reloadAttachedSourceTab(7, "SABA", {
      reloadDebugTarget: async (tabId) => { operations.push(`cdp.reload:${tabId}`); },
      reloadBrowserTab,
      get: async (tabId) => { operations.push(`get:${tabId}`); return { id: tabId, url: "https://saba.test" }; }
    })).resolves.toEqual({ id: 7, url: "https://saba.test" });

    expect(operations).toEqual(["cdp.reload:7", "get:7"]);
    expect(reloadBrowserTab).not.toHaveBeenCalled();
  });

  it("keeps normal Chrome tab reloads for providers other than SABA", async () => {
    const operations: string[] = [];
    const reloadDebugTarget = vi.fn(async () => { operations.push("cdp.reload"); });

    await reloadAttachedSourceTab(8, "CMD", {
      reloadDebugTarget,
      reloadBrowserTab: async (tabId) => { operations.push(`tabs.reload:${tabId}`); },
      get: async (tabId) => { operations.push(`get:${tabId}`); return { id: tabId }; }
    });

    expect(operations).toEqual(["tabs.reload:8", "get:8"]);
    expect(reloadDebugTarget).not.toHaveBeenCalled();
  });
});
