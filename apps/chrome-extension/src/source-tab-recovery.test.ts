import { describe, expect, it, vi } from "vitest";
import { SourceTabRecovery } from "./source-tab-recovery.js";

describe("SourceTabRecovery", () => {
  it("navigates the attached lobby without creating a duplicate tab", async () => {
    const update = vi.fn(async (tabId: number, url: string) => ({ id: tabId, url }));
    const create = vi.fn();
    const attach = vi.fn();
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "CMD", tabId: 7 }], query: async () => [], update, create, attach
    });

    await recovery.ensure("CMD", "https://cgnew.fts368.com/sports?opaque=1");

    expect(update).toHaveBeenCalledWith(7, "https://cgnew.fts368.com/sports?opaque=1");
    expect(create).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it("adopts and navigates an existing recognized lobby tab", async () => {
    const update = vi.fn(async (tabId: number, url: string) => ({ id: tabId, url }));
    const attach = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [{ id: 8, url: "https://cgnew.fts368.com/old" }],
      update, create: vi.fn(), attach
    });

    await recovery.ensure("CMD", "https://cgnew.fts368.com/fresh");

    expect(update).toHaveBeenCalledWith(8, "https://cgnew.fts368.com/fresh");
    expect(attach).toHaveBeenCalledWith({ id: 8, url: "https://cgnew.fts368.com/fresh" });
  });

  it("creates an inactive tab and attaches it when the source tab was closed", async () => {
    const attach = vi.fn(async () => undefined);
    const create = vi.fn(async (url: string) => ({ id: 9, url }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], update: vi.fn(), create, attach
    });

    await recovery.ensure("CMD", "https://cgnew.fts368.com/fresh");

    expect(create).toHaveBeenCalledWith("https://cgnew.fts368.com/fresh", false);
    expect(attach).toHaveBeenCalledWith({ id: 9, url: "https://cgnew.fts368.com/fresh" });
  });

  it("waits for a newly created Chrome tab to receive its provider URL before attaching", async () => {
    const attach = vi.fn(async () => undefined);
    const get = vi.fn()
      .mockResolvedValueOnce({ id: 13 })
      .mockResolvedValueOnce({ id: 13, url: "https://cgnew.fts368.com/fresh" });
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], update: vi.fn(),
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

  it("creates a tab from the session-only remembered launch when recently closed history is unavailable", async () => {
    const create = vi.fn(async (url: string) => ({ id: 11, url }));
    const attach = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], update: vi.fn(), create, attach,
      recentlyClosed: async () => [], restore: vi.fn(),
      loadRemembered: async () => "https://cgnew.fts368.com/remembered"
    });

    await recovery.restore("CMD");

    expect(create).toHaveBeenCalledWith("https://cgnew.fts368.com/remembered", false);
    expect(attach).toHaveBeenCalled();
  });

  it("opens the canonical source entry when neither Chrome recovery path is available", async () => {
    const create = vi.fn(async (url: string) => ({ id: 12, url }));
    const attach = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], update: vi.fn(), create, attach,
      recentlyClosed: async () => [], restore: vi.fn(), loadRemembered: async () => null,
      fallbackUrl: (lobby) => lobby === "CMD"
        ? "https://cgnew.fts368.com/DomainNames/cgnew/home.aspx"
        : null
    });

    await recovery.restore("CMD");

    expect(create).toHaveBeenCalledWith("https://cgnew.fts368.com/DomainNames/cgnew/home.aspx", false);
    expect(attach).toHaveBeenCalled();
  });
});
