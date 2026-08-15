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
});
