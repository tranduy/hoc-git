import { describe, expect, it, vi } from "vitest";
import { TabRegistry } from "./tab-registry.js";

function createRegistry() {
  const attach = vi.fn(async () => undefined);
  const detach = vi.fn(async () => undefined);
  return { registry: new TabRegistry({ attach, detach }), attach, detach };
}

describe("TabRegistry", () => {
  it("attaches an explicitly selected recognized tab once", async () => {
    const { registry, attach } = createRegistry();
    const tab = { id: 7, url: "https://imsports.directsb.net/live?token=secret", title: "IM" };
    expect(await registry.attachSelected(tab)).toMatchObject({ lobby: "IM", tabId: 7, state: "ATTACHED" });
    await registry.attachSelected(tab);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(registry.list())).not.toContain("secret");
  });

  it("never attaches an unmatched tab", async () => {
    const { registry, attach } = createRegistry();
    await expect(registry.attachSelected({ id: 7, url: "https://example.test/" })).rejects.toThrow("TAB_NOT_RECOGNIZED");
    expect(attach).not.toHaveBeenCalled();
  });

  it("detaches a removed tab and reattaches a recognized tab after navigation", async () => {
    const { registry, attach, detach } = createRegistry();
    await registry.attachSelected({ id: 7, url: "https://imsports.directsb.net/live" });
    await registry.handleNavigation({ id: 7, url: "https://example.test/" });
    expect(detach).toHaveBeenCalledWith(7);
    expect(registry.list()).toEqual([]);

    await registry.handleNavigation({ id: 7, url: "https://imsports.directsb.net/live" });
    expect(attach).toHaveBeenCalledTimes(2);
    await registry.handleRemoved(7);
    expect(registry.list()).toEqual([]);
  });

  it("preserves the explicit preference when Chrome detaches during navigation", async () => {
    const { registry, attach } = createRegistry();
    await registry.attachSelected({ id: 7, url: "https://imsports.directsb.net/live" });
    registry.handleDebuggerDetached(7);
    await registry.handleNavigation({ id: 7, url: "https://imsports.directsb.net/live" });
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it("restores only lobby-to-tab preferences and never persists a URL", async () => {
    const attach = vi.fn(async () => undefined);
    const save = vi.fn(async () => undefined);
    const registry = new TabRegistry(
      { attach, detach: vi.fn(async () => undefined) },
      { load: async () => ({ "7": "IM" }), save }
    );
    await registry.restore([{ id: 7, url: "https://imsports.directsb.net/live?token=secret" }]);
    expect(registry.list()).toMatchObject([{ lobby: "IM", tabId: 7 }]);
    expect(attach).toHaveBeenCalledWith(7);
    expect(JSON.stringify(save.mock.calls)).not.toContain("secret");
  });

  it("adopts a recognized provider tab on startup even when Chrome assigned it a new tab id", async () => {
    const { registry, attach } = createRegistry();

    await registry.restore([{ id: 99, url: "https://prod20091.fxf774.com/live" }]);

    expect(registry.list()).toMatchObject([{ lobby: "BTI", tabId: 99 }]);
    expect(attach).toHaveBeenCalledWith(99);
  });

  it("keeps one newest tab per lobby and closes older duplicates during startup restore", async () => {
    const attach = vi.fn(async () => undefined);
    const closed: number[] = [];
    const registry = new TabRegistry(
      { attach, detach: vi.fn(async () => undefined) },
      { load: async () => ({ "7": "IM", "9": "IM", "8": "CMD" }), save: vi.fn(async () => undefined) },
      { closeTab: async (tabId) => { closed.push(tabId); } }
    );

    await registry.restore([
      { id: 7, url: "https://imsports.directsb.net/old" },
      { id: 9, url: "https://imsports.directsb.net/new" },
      { id: 8, url: "https://cgnew.fts368.com/live" }
    ]);

    expect(registry.list()).toHaveLength(2);
    expect(registry.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ lobby: "CMD", tabId: 8 }),
      expect.objectContaining({ lobby: "IM", tabId: 9 })
    ]));
    expect(closed).toEqual([7]);
  });

  it("reclaims an orphaned debugger attachment after the extension worker restarts", async () => {
    let attachAttempts = 0;
    const attach = vi.fn(async () => {
      attachAttempts++;
      if (attachAttempts === 1) throw new Error("Another debugger is already attached");
    });
    const detach = vi.fn(async () => undefined);
    const registry = new TabRegistry(
      { attach, detach },
      { load: async () => ({ "7": "IM" }), save: vi.fn(async () => undefined) }
    );

    await expect(registry.restore([
      { id: 7, url: "https://imsports.directsb.net/live" }
    ])).resolves.toMatchObject([{ lobby: "IM", tabId: 7 }]);
    expect(detach).toHaveBeenCalledWith(7);
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it("continues restoring healthy preferred tabs when one debugger attachment fails", async () => {
    const attach = vi.fn(async (tabId: number) => {
      if (tabId === 7) throw new Error("Another debugger is already attached");
    });
    const registry = new TabRegistry(
      { attach, detach: vi.fn(async () => undefined) },
      { load: async () => ({ "7": "IM", "8": "CMD" }), save: vi.fn(async () => undefined) }
    );

    await expect(registry.restore([
      { id: 7, url: "https://imsports.directsb.net/live" },
      { id: 8, url: "https://cgnew.fts368.com/" }
    ])).resolves.toMatchObject([{ lobby: "CMD", tabId: 8 }]);
    expect(attach).toHaveBeenCalledWith(7);
    expect(attach).toHaveBeenCalledWith(8);
  });
});
