import { describe, expect, it, vi } from "vitest";
import { SourceTabRecovery } from "./source-tab-recovery.js";

describe("SourceTabRecovery", () => {
  const navigate = async (tabId: number, url: string) => ({ id: tabId, url });

  it("attaches the observer before navigating a one-time provider launch", async () => {
    const operations: string[] = [];
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "BTI", tabId: 7 }],
      query: async () => [{ id: 7, url: "https://prod20091.fxf774.com/old" }],
      create: async (url: string) => {
        operations.push(`create:${url}`);
        return { id: 8, url };
      },
      attach: async (tab) => { operations.push(`attach:${tab.url}`); },
      update: async (tabId, url) => {
        operations.push(`update:${tabId}:${url}`);
        return { id: tabId, url };
      },
      remove: async (tabId) => { operations.push(`remove:${tabId}`); }
    });

    await recovery.ensure("BTI", "https://prod20091.fxf774.com/fresh");

    expect(operations).toEqual([
      "create:about:blank",
      "attach:https://prod20091.fxf774.com/fresh",
      "update:8:https://prod20091.fxf774.com/fresh",
      "remove:7"
    ]);
  });

  it("replaces the attached lobby on repeated resets without accumulating source tabs", async () => {
    let nextTabId = 8;
    let tabs = [{ id: 7, url: "https://cgnew.fts368.com/old" }];
    let attached = [{ lobby: "CMD" as const, tabId: 7 }];
    const operations: string[] = [];
    const recovery = new SourceTabRecovery({
      listAttached: () => attached,
      query: async () => tabs,
      update: async (tabId, url) => {
        tabs = tabs.map((tab) => tab.id === tabId ? { id: tabId, url } : tab);
        operations.push(`update:${tabId}`);
        return { id: tabId, url };
      },
      create: async (url: string) => {
        const tab = { id: nextTabId++, url };
        tabs = [...tabs, tab];
        operations.push(`create:${tab.id}`);
        return tab;
      },
      attach: async (tab) => {
        attached = [...attached, { lobby: "CMD", tabId: tab.id! }];
        operations.push(`attach:${tab.id}`);
      },
      remove: async (tabId) => {
        tabs = tabs.filter((tab) => tab.id !== tabId);
        attached = attached.filter((tab) => tab.tabId !== tabId);
        operations.push(`remove:${tabId}`);
      }
    });

    await recovery.ensure("CMD", "https://cgnew.fts368.com/sports?generation=1");
    await recovery.ensure("CMD", "https://cgnew.fts368.com/sports?generation=2");

    expect(tabs).toEqual([{ id: 9, url: "https://cgnew.fts368.com/sports?generation=2" }]);
    expect(attached).toEqual([{ lobby: "CMD", tabId: 9 }]);
    expect(operations).toEqual([
      "create:8", "attach:8", "update:8", "remove:7",
      "create:9", "attach:9", "update:9", "remove:8"
    ]);
  });

  it("keeps the existing source tab when attaching its replacement fails", async () => {
    const removed: number[] = [];
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "CMD", tabId: 7 }],
      query: async () => [{ id: 7, url: "https://cgnew.fts368.com/old" }],
      update: navigate,
      create: async (url: string) => ({ id: 8, url }),
      attach: async () => { throw new Error("ATTACH_FAILED"); },
      remove: async (tabId) => { removed.push(tabId); }
    });

    await expect(recovery.ensure("CMD", "https://cgnew.fts368.com/fresh"))
      .rejects.toThrow("ATTACH_FAILED");

    expect(removed).toEqual([8]);
  });

  it("replaces an existing recognized lobby tab even when it was not attached", async () => {
    const remove = vi.fn(async () => undefined);
    const attach = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [{ id: 8, url: "https://cgnew.fts368.com/old" }],
      update: navigate, create: async (url: string) => ({ id: 9, url }), attach, remove
    });

    await recovery.ensure("CMD", "https://cgnew.fts368.com/fresh");

    expect(attach).toHaveBeenCalledWith({ id: 9, url: "https://cgnew.fts368.com/fresh" });
    expect(remove).toHaveBeenCalledWith(8);
  });

  it("creates an inactive tab and attaches it when the source tab was closed", async () => {
    const attach = vi.fn(async () => undefined);
    const create = vi.fn(async (url: string) => ({ id: 9, url }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], update: navigate, create, attach
    });

    await recovery.ensure("CMD", "https://cgnew.fts368.com/fresh");

    expect(create).toHaveBeenCalledWith("about:blank", false);
    expect(attach).toHaveBeenCalledWith({ id: 9, url: "https://cgnew.fts368.com/fresh" });
  });

  it("waits for a newly created Chrome tab to receive its provider URL before attaching", async () => {
    const attach = vi.fn(async () => undefined);
    const get = vi.fn()
      .mockResolvedValueOnce({ id: 13 })
      .mockResolvedValueOnce({ id: 13, url: "https://cgnew.fts368.com/fresh" });
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], update: async (tabId) => ({ id: tabId }),
      create: async () => ({ id: 13 }), attach, get,
      delay: async () => undefined
    });

    await recovery.ensure("CMD", "https://cgnew.fts368.com/fresh");

    expect(get).toHaveBeenCalledTimes(2);
    expect(attach).toHaveBeenCalledWith({ id: 13, url: "https://cgnew.fts368.com/fresh" });
  });

  it("rejects a URL that does not match the requested lobby", async () => {
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], update: vi.fn(), create: vi.fn(), attach: vi.fn()
    });
    await expect(recovery.ensure("CMD", "https://imsports.directsb.net/live"))
      .rejects.toThrow("UNTRUSTED_LAUNCH_URL");
  });

  it("restores and attaches a recently closed source tab", async () => {
    const attach = vi.fn(async () => undefined);
    const restore = vi.fn(async () => ({ id: 10, url: "https://cgnew.fts368.com/live" }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], update: vi.fn(), create: vi.fn(), attach,
      recentlyClosed: async () => [{ sessionId: "closed-cmd", tab: { id: 9, url: "https://cgnew.fts368.com/live" } }],
      restore, loadRemembered: async () => null
    });

    await recovery.restore("CMD");

    expect(restore).toHaveBeenCalledWith("closed-cmd");
    expect(attach).toHaveBeenCalledWith({ id: 10, url: "https://cgnew.fts368.com/live" });
  });

  it("replaces an attached source during restore so CMD reset also releases its old renderer", async () => {
    const operations: string[] = [];
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "CMD", tabId: 7 }],
      query: async () => [{ id: 7, url: "https://cgnew.fts368.com/live" }],
      update: async (tabId, url) => { operations.push("update:8"); return { id: tabId, url }; },
      create: async (url: string) => { operations.push("create:8"); return { id: 8, url }; },
      attach: async () => { operations.push("attach:8"); },
      remove: async (tabId) => { operations.push(`remove:${tabId}`); }
    });

    await recovery.restore("CMD");

    expect(operations).toEqual(["create:8", "attach:8", "update:8", "remove:7"]);
  });

  it("creates a tab from the session-only remembered launch when recently closed history is unavailable", async () => {
    const create = vi.fn(async (url: string) => ({ id: 11, url }));
    const attach = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], update: navigate, create, attach,
      recentlyClosed: async () => [], restore: vi.fn(),
      loadRemembered: async () => "https://cgnew.fts368.com/remembered"
    });

    await recovery.restore("CMD");

    expect(create).toHaveBeenCalledWith("about:blank", false);
    expect(attach).toHaveBeenCalled();
  });

  it("opens the canonical source entry when neither Chrome recovery path is available", async () => {
    const create = vi.fn(async (url: string) => ({ id: 12, url }));
    const attach = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], update: navigate, create, attach,
      recentlyClosed: async () => [], restore: vi.fn(), loadRemembered: async () => null,
      fallbackUrl: (lobby) => lobby === "CMD"
        ? "https://cgnew.fts368.com/DomainNames/cgnew/home.aspx"
        : null
    });

    await recovery.restore("CMD");

    expect(create).toHaveBeenCalledWith("about:blank", false);
    expect(attach).toHaveBeenCalled();
  });
});
