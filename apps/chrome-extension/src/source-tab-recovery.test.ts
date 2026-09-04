import { describe, expect, it, vi } from "vitest";
import { BTI_DIRECT_LOBBY_URL, SABA_DIRECT_LOBBY_URL, SourceTabRecovery } from "./source-tab-recovery.js";

describe("SourceTabRecovery", () => {
  const navigate = async (tabId: number, url: string) => ({ id: tabId, url });

  it("attaches the observer before navigating an existing provider tab", async () => {
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
      "attach:https://prod20091.fxf774.com/fresh",
      "update:7:https://prod20091.fxf774.com/fresh"
    ]);
  });

  it("begins a new observer epoch before navigating an existing IM tab", async () => {
    const operations: string[] = [];
    const fresh = "https://imsports.directsb.net/?languageCode=vi&token=4-fresh";
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "IM", tabId: 7 }],
      query: async () => [{ id: 7,
        url: "https://imsports.directsb.net/?languageCode=vi&token=4-expired" }],
      create: async (url) => ({ id: 8, url }),
      attach: async () => { operations.push("attach"); },
      update: async (tabId, url) => {
        operations.push(`update:${tabId}`);
        return { id: tabId, url };
      },
      beginSourceEpoch: (sourceId) => { operations.push(`epoch:${sourceId}`); }
    });

    await recovery.ensure("IM", fresh);

    expect(operations).toEqual(["epoch:chrome:IM:7", "attach", "update:7"]);
  });

  it("marks an existing source as bootstrapping before the observer is attached", async () => {
    const operations: string[] = [];
    const options = {
      listAttached: () => [{ lobby: "BTI" as const, tabId: 7 }],
      query: async () => [{ id: 7, url: "https://prod20091.fxf774.com/old" }],
      create: async (url: string) => ({ id: 8, url }),
      attach: async () => { operations.push("attach"); },
      update: async (tabId: number, url: string) => {
        operations.push("update");
        return { id: tabId, url };
      },
      remove: async () => undefined,
      onBootstrapStart: (tabId: number) => { operations.push(`bootstrap:${tabId}`); },
      onBootstrapFailure: (tabId: number) => { operations.push(`failed:${tabId}`); }
    };
    const recovery = new SourceTabRecovery(options);

    await recovery.ensure("BTI", "https://prod20091.fxf774.com/fresh");

    expect(operations).toEqual(["bootstrap:7", "attach", "update"]);
  });

  it("uses the trusted bootstrap attachment before navigating a one-time KSPORT launch", async () => {
    const operations: string[] = [];
    const create = vi.fn(async () => ({ id: 8, url: "about:blank" }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [],
      query: async () => [],
      create,
      attach: async () => { operations.push("normal-attach"); },
      attachBootstrap: async (_tab, lobby) => { operations.push(`bootstrap-attach:${lobby}`); },
      update: async (_tabId, url) => {
        operations.push("update");
        return { id: 8, url, title: "Sportsbook" };
      },
      remove: async () => undefined
    });

    await recovery.ensure("KSPORT", "https://zenandfe.com/?token=one-time");

    expect(create).toHaveBeenCalledWith("about:blank", true);
    expect(operations).toEqual(["bootstrap-attach:KSPORT", "update"]);
  });

  it("creates only the missing KSPORT target and preserves every non-KSPORT tab", async () => {
    vi.setSystemTime(1_000);
    const operations: string[] = [];
    const tabs = [
      { id: 3, url: "https://cgnew.fts368.com/live" },
      { id: 4, url: "https://imsports.directsb.net/live" }
    ];
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "CMD", tabId: 3 }, { lobby: "IM", tabId: 4 }],
      query: async () => tabs,
      create: async (url) => { operations.push(`create:${url}`); return { id: 8, url }; },
      attachBootstrap: async (_tab, lobby) => { operations.push(`attach:${lobby}`); },
      attach: async () => { operations.push("unexpected-normal-attach"); },
      update: async (tabId, url) => {
        operations.push(`navigate:${tabId}`);
        return { id: tabId, url, title: "Sportsbook" };
      },
      remove: async (tabId) => { operations.push(`remove:${tabId}`); },
      usePortalLaunch: false
    });

    await recovery.ensure("KSPORT", "https://zenandfe.com/?token=fresh");

    expect(operations).toEqual(["create:about:blank", "attach:KSPORT", "navigate:8"]);
    expect(tabs.map((tab) => tab.id)).toEqual([3, 4]);
  });

  it("consumes a K-Sports launch once and never schedules periodic bootstrap navigation", async () => {
    vi.setSystemTime(1_000);
    const navigations: string[] = [];
    let current = { id: 8, url: "about:blank", title: "Sportsbook" };
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "KSPORT", tabId: 8 }],
      query: async () => current.url === "about:blank" ? [] : [current],
      create: async () => current,
      attach: async () => undefined,
      update: async (tabId, url) => {
        navigations.push(url);
        current = { id: tabId, url, title: "Sportsbook" };
        return current;
      },
      remove: async () => undefined,
      usePortalLaunch: false,
      validateReady: async () => true,
      delay: async () => undefined
    });

    await recovery.ensure("KSPORT", "https://zenandfe.com/?agentId=4&token=manual");
    expect(navigations).toEqual([
      "https://zenandfe.com/?agentId=4&token=manual&sportId=1&lng=vi&t=1000"
    ]);
  });

  it("clears the bootstrap marker when replacement navigation fails", async () => {
    const operations: string[] = [];
    const options = {
      listAttached: () => [{ lobby: "BTI" as const, tabId: 7 }],
      query: async () => [{ id: 7, url: "https://prod20091.fxf774.com/old" }],
      create: async (url: string) => ({ id: 8, url }),
      attach: async () => undefined,
      update: async () => { throw new Error("NAVIGATION_FAILED"); },
      remove: async () => undefined,
      onBootstrapStart: (tabId: number) => { operations.push(`bootstrap:${tabId}`); },
      onBootstrapFailure: (tabId: number) => { operations.push(`failed:${tabId}`); }
    };
    const recovery = new SourceTabRecovery(options);

    await expect(recovery.ensure("BTI", "https://prod20091.fxf774.com/fresh"))
      .rejects.toThrow("NAVIGATION_FAILED");

    expect(operations).toEqual(["bootstrap:7", "failed:7"]);
  });

  it("keeps the attached lobby tab id across repeated resets", async () => {
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
        if (!attached.some((candidate) => candidate.tabId === tab.id)) {
          attached = [...attached, { lobby: "CMD", tabId: tab.id! }];
        }
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

    expect(tabs).toEqual([{ id: 7, url: "https://cgnew.fts368.com/sports?generation=2" }]);
    expect(attached).toEqual([{ lobby: "CMD", tabId: 7 }]);
    expect(operations).toEqual([
      "attach:7", "update:7", "attach:7", "update:7"
    ]);
  });

  it("keeps the attached K-Sports tab instead of opening a portal replacement", async () => {
    const operations: string[] = [];
    const create = vi.fn(async (url: string) => {
      operations.push(`create:${url}`);
      return { id: 10, url };
    });
    const launchFromPortal = vi.fn(async (_lobby, url) => {
      operations.push("launch:portal");
      return { id: 11, url, title: "Sportsbook" };
    });
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "KSPORT", tabId: 7 }],
      query: async () => [
        { id: 7, url: "https://zenandfe.com/?token=old", title: "Sportsbook" },
        { id: 9, url: "https://zenandfe.com/?token=failed", title: "zenandfe.com/?token=failed" }
      ],
      create,
      launchFromPortal,
      usePortalLaunch: true,
      attach: async (tab) => { operations.push(`attach:${tab.id}`); },
      update: async (tabId, url) => {
        operations.push(`update:${tabId}`);
        return { id: tabId, url, title: "Sportsbook" };
      },
      remove: async (tabId) => { operations.push(`remove:${tabId}`); }
    });

    await recovery.ensure("KSPORT", "https://zenandfe.com/?token=fresh");

    expect(launchFromPortal).not.toHaveBeenCalled();
    expect(operations).toEqual(["attach:7", "update:7"]);
    expect(create).not.toHaveBeenCalled();
  });

  it("prefers the stable Fabet portal handoff for K-Sports by default", async () => {
    const operations: string[] = [];
    const launchFromPortal = vi.fn(async () => ({ id: 11, url: "https://zenandfe.com/?token=fresh",
      title: "Sportsbook" }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], launchFromPortal,
      create: async (url) => { operations.push(`create:${url}`); return { id: 8, url }; },
      attach: async (tab) => { operations.push(`attach:${tab.id}:${tab.url}`); },
      update: async (tabId, url) => {
        operations.push(`update:${tabId}:${url}`);
        return { id: tabId, url, title: "Sportsbook" };
      },
      remove: async () => undefined
    });

    await recovery.ensure("KSPORT", "https://zenandfe.com/?token=fresh");

    expect(launchFromPortal).toHaveBeenCalledWith(
      "KSPORT", expect.stringContaining("?token=fresh&sportId=1&lng=vi&t=")
    );
    expect(operations).toEqual([]);
  });

  it.each(["FABET_PORTAL_TAB_UNAVAILABLE", "FABET_KSPORT_POPUP_UNAVAILABLE"])(
    "uses the fresh K-Sports launch directly when portal bootstrap fails with %s", async (portalError) => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_787_312_596_274);
    const operations: string[] = [];
    const recovery = new SourceTabRecovery({
      listAttached: () => [],
      query: async () => [],
      create: async (url) => {
        operations.push(`create:${url}`);
        return { id: 8, url };
      },
      attach: async (tab) => { operations.push(`attach:${tab.id}:${tab.url}`); },
      update: async (tabId, url) => {
        operations.push(`update:${tabId}:${url}`);
        return { id: tabId, url, title: "Sportsbook" };
      },
      remove: async (tabId) => { operations.push(`remove:${tabId}`); },
      launchFromPortal: async () => { throw new Error(portalError); }, usePortalLaunch: true
    });

    await recovery.ensure("KSPORT", "https://zenandfe.com/?token=fresh");

    expect(operations).toEqual([
      "create:about:blank",
      "attach:8:https://zenandfe.com/?token=fresh&sportId=1&lng=vi&t=1787312596274",
      "update:8:https://zenandfe.com/?token=fresh&sportId=1&lng=vi&t=1787312596274"
    ]);
    now.mockRestore();
    });

  it("removes a portal shell leaked by a failed K-Sports popup before direct fallback", async () => {
    let portalFailed = false;
    const removed: number[] = [];
    const recovery = new SourceTabRecovery({
      listAttached: () => portalFailed ? [{ lobby: "KSPORT", tabId: 11 }] : [],
      query: async () => portalFailed
        ? [{ id: 11, url: "https://zenandfe.com/?token=portal-shell", title: "Sportsbook" }] : [],
      create: async () => ({ id: 12, url: "about:blank" }),
      attach: async () => undefined,
      update: async (_tabId, url) => ({ id: 12, url, title: "Sportsbook" }),
      remove: async (tabId) => { removed.push(tabId); },
      launchFromPortal: async () => {
        portalFailed = true;
        throw new Error("FABET_KSPORT_POPUP_UNAVAILABLE");
      },
      usePortalLaunch: true
    });

    await recovery.ensure("KSPORT", "https://zenandfe.com/?token=fresh");

    expect(removed).toEqual([11]);
  });

  it("reuses the exact K-Sports tab with a tokenless public football launch", async () => {
    vi.setSystemTime(9_000);
    const remove = vi.fn(async () => undefined);
    const launchFromPortal = vi.fn(async () => ({ id: 11, url: "https://zenandfe.com/", title: "Sportsbook" }));
    const create = vi.fn();
    const update = vi.fn(async (tabId: number, url: string) => ({ id: tabId, url, title: "Sportsbook" }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "KSPORT", tabId: 7 }],
      query: async () => [{ id: 7, url: "https://zenandfe.com/?token=old", title: "Sportsbook" }],
      create, update, attach: vi.fn(), remove, launchFromPortal,
      validateReady: async () => true
    });

    await expect(recovery.ensure("KSPORT", "https://zenandfe.com/?agentId=4"))
      .resolves.toBeUndefined();
    expect(update).toHaveBeenCalledExactlyOnceWith(7,
      "https://zenandfe.com/?agentId=4&sportId=1&lng=vi&t=9000");
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(launchFromPortal).not.toHaveBeenCalled();
  });

  it("waits for the K-Sports sportsbook instead of accepting a Volta page on the same host", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ id: 10, url: "https://zenandfe.com/volta", title: "Volta" })
      .mockResolvedValueOnce({ id: 10, url: "https://zenandfe.com/sports", title: "Sportsbook" });
    const recovery = new SourceTabRecovery({
      listAttached: () => [],
      query: async () => [],
      create: vi.fn(),
      attach: vi.fn(),
      update: vi.fn(),
      remove: async () => undefined,
      launchFromPortal: async () => ({ id: 10, url: "https://zenandfe.com/volta", title: "Volta" }),
      usePortalLaunch: true,
      get,
      delay: async () => undefined
    });

    await recovery.ensure("KSPORT", "https://zenandfe.com/?token=fresh");

    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not accept a K-Sports shell until its sportsbook OOPIF is ready", async () => {
    const validateReady = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const get = vi.fn(async () => ({ id: 10, url: "https://zenandfe.com/sports", title: "Sportsbook" }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], create: vi.fn(), attach: vi.fn(), update: vi.fn(),
      remove: async () => undefined,
      launchFromPortal: async () => ({ id: 10, url: "https://zenandfe.com/sports", title: "Sportsbook" }),
      usePortalLaunch: true,
      validateReady, get, delay: async () => undefined
    });

    await recovery.ensure("KSPORT", "https://zenandfe.com/?token=fresh");

    expect(validateReady).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("allows the K-Sports live and today baseline to finish beyond the generic five-second window", async () => {
    let checks = 0;
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [],
      create: async () => ({ id: 10, url: "about:blank" }), attach: async () => undefined,
      update: async (_tabId, url) => ({ id: 10, url, title: "Sportsbook" }),
      remove: async () => undefined, get: async () => ({ id: 10,
        url: "https://zenandfe.com/?token=fresh", title: "Sportsbook" }),
      validateReady: async () => ++checks >= 80,
      delay: async () => undefined
    });

    await expect(recovery.ensure("KSPORT", "https://zenandfe.com/?token=fresh")).resolves.toBeUndefined();
    expect(checks).toBe(80);
  });

  it("keeps a valid K-Sports sportsbook tab when only its baseline readiness times out", async () => {
    const remove = vi.fn(async () => undefined);
    const onBootstrapFailure = vi.fn();
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [],
      create: async () => ({ id: 10, url: "about:blank" }),
      attach: async () => undefined,
      update: async (_tabId, url) => ({ id: 10, url, title: "Sportsbook" }),
      remove,
      get: async () => ({ id: 10, url: "https://zenandfe.com/sports", title: "Sportsbook" }),
      validateReady: async () => false,
      onBootstrapFailure,
      delay: async () => undefined
    });

    await expect(recovery.ensure("KSPORT", "https://zenandfe.com/?token=fresh"))
      .rejects.toThrow("SOURCE_TAB_RECOVERY_FAILED");

    expect(onBootstrapFailure).toHaveBeenCalledWith(10);
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps the existing source when its in-place bootstrap fails", async () => {
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

    expect(removed).toEqual([]);
  });

  it("reuses an existing recognized lobby tab even when it was not attached", async () => {
    const remove = vi.fn(async () => undefined);
    const attach = vi.fn(async () => undefined);
    const create = vi.fn(async (url: string) => ({ id: 9, url }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [{ id: 8, url: "https://cgnew.fts368.com/old" }],
      update: navigate, create, attach, remove
    });

    await recovery.ensure("CMD", "https://cgnew.fts368.com/fresh");

    expect(attach).toHaveBeenCalledWith({ id: 8, url: "https://cgnew.fts368.com/fresh" });
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
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

  it("keeps the existing provider tab id when a fresh launch is delivered", async () => {
    const operations: string[] = [];
    const create = vi.fn(async (url: string) => ({ id: 9, url }));
    const remove = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "BTI", tabId: 7 }],
      query: async () => [{ id: 7, url: "https://prod20091.fxf774.com/old" }],
      create,
      remove,
      attach: async () => { operations.push("attach"); },
      attachBootstrap: async (tab, lobby) => { operations.push(`bootstrap:${lobby}:${tab.id}`); },
      update: async (tabId, url) => {
        operations.push(`update:${tabId}`);
        return { id: tabId, url };
      }
    });

    await recovery.ensure("BTI", "https://prod20091.fxf774.com/fresh");

    expect(operations).toEqual(["bootstrap:BTI:7", "update:7"]);
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
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

  it("consumes an API-expected SABA launch on an otherwise ambiguous SBO host", async () => {
    const attachBootstrap = vi.fn(async () => undefined);
    const launch = "https://c0z0ob.bpb7jrm5.com/session/NewIndex?token=opaque";
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [],
      create: async () => ({ id: 18, url: "about:blank" }),
      update: async () => ({ id: 18, url: launch, title: "SABA Sports" }),
      attach: vi.fn(), attachBootstrap,
      validateReady: async () => true
    });

    await expect(recovery.ensure("SABA", launch)).resolves.toBeUndefined();
    expect(attachBootstrap).toHaveBeenCalledWith({ id: 18, url: launch }, "SABA");
  });

  it("restores missing SABA through the direct tokenless lobby instead of replaying an expired URL", async () => {
    const stale = "https://c0z0ob.bpd3a3fn.com/(S(expired))/NewIndex";
    const launchFromPortal = vi.fn();
    const create = vi.fn(async () => ({ id: 19, url: "about:blank" }));
    const update = vi.fn(async () => ({ id: 19, url: SABA_DIRECT_LOBBY_URL, title: "Sports" }));
    const attach = vi.fn();
    const attachBootstrap = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], create, update, attach,
      attachBootstrap, launchFromPortal, recentlyClosed: async () => [],
      loadRemembered: async () => stale,
      validateReady: async () => true
    });

    await expect(recovery.restore("SABA")).resolves.toBeUndefined();
    expect(launchFromPortal).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledExactlyOnceWith("about:blank", false);
    expect(update).toHaveBeenCalledExactlyOnceWith(19, SABA_DIRECT_LOBBY_URL);
    expect(attachBootstrap).toHaveBeenCalledExactlyOnceWith(
      { id: 19, url: SABA_DIRECT_LOBBY_URL }, "SABA");
    expect(attach).not.toHaveBeenCalled();
  });

  it("restores a missing BTI source through its public direct lobby", async () => {
    const create = vi.fn(async () => ({ id: 24, url: "about:blank" }));
    const update = vi.fn(async () => ({ id: 24, url: BTI_DIRECT_LOBBY_URL, title: "BTI Football" }));
    const attachBootstrap = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], create, update, attach: vi.fn(), attachBootstrap,
      recentlyClosed: async () => [], loadRemembered: async () => null
    });

    await expect(recovery.restore("BTI")).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledExactlyOnceWith("about:blank", false);
    expect(update).toHaveBeenCalledExactlyOnceWith(24, BTI_DIRECT_LOBBY_URL);
    expect(attachBootstrap).toHaveBeenCalledExactlyOnceWith(
      { id: 24, url: BTI_DIRECT_LOBBY_URL }, "BTI"
    );
  });

  it("preserves an existing authenticated IM page without navigating it", async () => {
    const current = "https://imsports.directsb.net/?languageCode=vi&token=4-current";
    const create = vi.fn();
    const update = vi.fn();
    const reload = vi.fn();
    const attachBootstrap = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "IM", tabId: 23 }],
      query: async () => [{ id: 23, url: current, title: "IM" }],
      create, update, reload, attach: vi.fn(), attachBootstrap,
      loadRemembered: async () => "https://imsports.directsb.net/?token=4-spent"
    });

    await expect(recovery.restore("IM")).resolves.toBeUndefined();

    expect(attachBootstrap).toHaveBeenCalledExactlyOnceWith(
      { id: 23, url: current, title: "IM" }, "IM"
    );
    expect(update).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not replay a remembered or tokenless IM URL when its authenticated tab is missing", async () => {
    const stale = "https://imsports.directsb.net/?languageCode=vi&token=4-expired";
    const create = vi.fn();
    const update = vi.fn();
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], create, update, attach: vi.fn(),
      recentlyClosed: async () => [], loadRemembered: async () => stale
    });

    await expect(recovery.restore("IM")).rejects.toThrow("SOURCE_RESTORE_UNAVAILABLE:IM");
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("restores SABA directly after extension session memory is cleared", async () => {
    const launchFromPortal = vi.fn();
    const create = vi.fn(async () => ({ id: 19, url: "about:blank" }));
    const update = vi.fn(async () => ({ id: 19, url: SABA_DIRECT_LOBBY_URL, title: "Sports" }));
    const attachBootstrap = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], create, update, attach: vi.fn(), attachBootstrap,
      launchFromPortal, recentlyClosed: async () => [], loadRemembered: async () => null,
      validateReady: async () => true
    });

    await expect(recovery.restore("SABA")).resolves.toBeUndefined();
    expect(launchFromPortal).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledExactlyOnceWith("about:blank", false);
    expect(update).toHaveBeenCalledExactlyOnceWith(19, SABA_DIRECT_LOBBY_URL);
  });

  it("does not reload an exact SABA session whose bootstrap observer already recovered", async () => {
    const stale = "https://c0z0ob.bpd3a3fn.com/(S(stale))/NewIndex";
    const launchFromPortal = vi.fn();
    const reload = vi.fn(async () => ({ id: 18, url: stale, title: "Sports" }));
    const update = vi.fn(async () => ({ id: 18, url: SABA_DIRECT_LOBBY_URL, title: "Sports" }));
    const attachBootstrap = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "SABA", tabId: 18 }],
      query: async () => [{ id: 18, url: stale, title: "Sports" }],
      create: vi.fn(), update, reload, attach: vi.fn(), attachBootstrap, launchFromPortal,
      loadRemembered: async () => stale,
      validateReady: async () => true
    });

    await expect(recovery.restore("SABA")).resolves.toBeUndefined();
    expect(attachBootstrap).toHaveBeenCalledExactlyOnceWith(
      { id: 18, url: stale, title: undefined }, "SABA");
    expect(launchFromPortal).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("reuses a visible SABA detail tab instead of opening another provider tab", async () => {
    const detail = "https://c0z0oa.bpy6vurb.com/(S(live))/NewIndex?lang=vn&matchid=132645303&leaguekey=43&scmt=tab02&ssmt=tab02";
    const lobby = "https://c0z0oa.bpy6vurb.com/(S(live))/NewIndex?lang=vn";
    const launchFromPortal = vi.fn(async () => ({ id: 20, url: lobby, title: "Sports" }));
    const update = vi.fn(async (tabId: number, url: string) => ({ id: tabId, url, title: "Sports" }));
    const create = vi.fn();
    const attachBootstrap = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [],
      query: async () => [{ id: 18, url: detail, title: "Sports" }],
      create,
      update,
      attach: vi.fn(),
      attachBootstrap,
      launchFromPortal,
      loadRemembered: async () => null,
      validateReady: async () => true
    });

    await expect(recovery.restore("SABA")).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledExactlyOnceWith(18, lobby);
    expect(attachBootstrap).toHaveBeenCalledExactlyOnceWith(
      { id: 18, url: lobby, title: undefined }, "SABA");
    expect(launchFromPortal).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps the attached SABA tab and removes duplicate SABA tabs during recovery", async () => {
    const detail = "https://c0z0oa.bpy6vurb.com/(S(live))/NewIndex?lang=vn&matchid=132645303&leaguekey=43";
    const lobby = "https://c0z0oa.bpy6vurb.com/(S(live))/NewIndex?lang=vn";
    const remove = vi.fn(async (_tabId: number) => undefined);
    const update = vi.fn(async (tabId: number, url: string) => ({ id: tabId, url, title: "Sports" }));
    const launchFromPortal = vi.fn(async () => ({ id: 20, url: lobby, title: "Sports" }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "SABA", tabId: 18 }],
      query: async () => [
        { id: 19, url: lobby, title: "Sports" },
        { id: 18, url: detail, title: "Sports" },
        { id: 21, url: detail, title: "Sports" }
      ],
      create: vi.fn(),
      update,
      remove,
      attach: vi.fn(),
      attachBootstrap: vi.fn(async () => undefined),
      launchFromPortal,
      loadRemembered: async () => null,
      validateReady: async () => true
    });

    await recovery.restore("SABA");

    expect(update).toHaveBeenCalledExactlyOnceWith(18, lobby);
    expect(remove.mock.calls.map(([tabId]) => tabId).sort()).toEqual([19, 21]);
    expect(launchFromPortal).not.toHaveBeenCalled();
  });

  it("recovers an expired SABA error tab through the direct tokenless lobby without Fabet", async () => {
    const failed = "https://c0z0ob.bpd3a3fn.com/(S(expired))/VendorGame/ErrorPage?Game=DepositLogin&ErrCode=SPA-1008";
    const recovered = "https://c0z0oa.bpd3a3fn.com/NewIndex?lang=vn&webskintype=3&scmt=tab02&ssmt=tab02";
    const update = vi.fn(async () => ({ id: 18, url: recovered, title: "Sports" }));
    const reload = vi.fn(async () => ({ id: 18, url: failed, title: "SPA-1008 - Authentication failed" }));
    const attachBootstrap = vi.fn(async () => undefined);
    const launchFromPortal = vi.fn(async () => ({ id: 20, url: recovered, title: "Sports" }));
    const remove = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [],
      query: async () => [{ id: 18, url: failed, title: "SPA-1008 - Authentication failed" }],
      create: vi.fn(),
      update,
      reload,
      remove,
      attach: vi.fn(),
      attachBootstrap,
      launchFromPortal,
      loadRemembered: async () => null,
      validateReady: async () => true
    });

    await recovery.restore("SABA");

    expect(update).toHaveBeenCalledExactlyOnceWith(18, recovered);
    expect(attachBootstrap).toHaveBeenCalledExactlyOnceWith({ id: 18, url: recovered,
      title: undefined }, "SABA");
    expect(launchFromPortal).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("lets a temporarily late SABA bootstrap recover before deciding to reload", async () => {
    const stale = "https://c0z0ob.bpd3a3fn.com/(S(stale))/NewIndex";
    const launchFromPortal = vi.fn();
    const update = vi.fn(async () => ({ id: 18, url: SABA_DIRECT_LOBBY_URL, title: "Sports" }));
    const reload = vi.fn(async () => ({ id: 18, url: stale, title: "Sports" }));
    let checks = 0;
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "SABA", tabId: 18 }],
      query: async () => [{ id: 18, url: stale, title: "Sports" }],
      create: vi.fn(), update, reload, attach: vi.fn(),
      attachBootstrap: vi.fn(), launchFromPortal,
      loadRemembered: async () => stale,
      get: async () => ({ id: 18, url: SABA_DIRECT_LOBBY_URL, title: "Sports" }),
      validateReady: async (tab) => tab.id === 18 && ++checks >= 3,
      delay: async () => undefined
    });

    await expect(recovery.restore("SABA")).resolves.toBeUndefined();
    expect(launchFromPortal).not.toHaveBeenCalled();
    expect(checks).toBe(3);
    expect(reload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("abandons a dead SABA session path and mints a new direct session when no baseline returns", async () => {
    const deadSession = "https://c0z0oa.bpd3a3fn.com/(S(dead))/NewIndex?lang=vn";
    let current = { id: 18, url: deadSession, title: "Sports" };
    const update = vi.fn(async (tabId: number, url: string) => {
      current = { id: tabId, url, title: "Sports" };
      return current;
    });
    const reload = vi.fn(async () => current);
    const beginSourceEpoch = vi.fn();
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "SABA", tabId: 18 }],
      query: async () => [current], create: vi.fn(), update, reload, attach: vi.fn(),
      attachBootstrap: vi.fn(async () => undefined), loadRemembered: async () => deadSession,
      get: async () => current,
      validateReady: async (tab) => tab.url === SABA_DIRECT_LOBBY_URL,
      delay: async () => undefined, beginSourceEpoch
    });

    await expect(recovery.restore("SABA")).resolves.toBeUndefined();

    expect(reload).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledExactlyOnceWith(18, SABA_DIRECT_LOBBY_URL);
    expect(beginSourceEpoch).toHaveBeenCalledTimes(2);
  });

  it("allows a recovered SABA page sixty seconds to publish its complete baseline", async () => {
    let checks = 0;
    const create = vi.fn(async () => ({ id: 20, url: "about:blank" }));
    const update = vi.fn(async () => ({ id: 20, url: SABA_DIRECT_LOBBY_URL, title: "Sports" }));
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], create, update, attach: vi.fn(),
      recentlyClosed: async () => [],
      loadRemembered: async () => "https://c0z0ob.bpd3a3fn.com/(S(expired))/NewIndex",
      get: async () => ({ id: 20, url: SABA_DIRECT_LOBBY_URL, title: "Sports" }),
      validateReady: async () => ++checks >= 21,
      delay: async () => undefined
    });

    await expect(recovery.restore("SABA")).resolves.toBeUndefined();
    expect(checks).toBe(21);
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

  it("never restores a recently closed window and uses the exact remembered provider instead", async () => {
    const restore = vi.fn(async () => ({ id: 10, url: "https://cgnew.fts368.com/live" }));
    const create = vi.fn(async (url: string) => ({ id: 11, url }));
    const update = vi.fn(navigate);
    const attach = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [], query: async () => [], create, update, attach,
      recentlyClosed: async () => [{
        sessionId: "closed-window",
        window: { tabs: [
          { id: 9, url: "https://cgnew.fts368.com/live" },
          { id: 12, url: "https://unrelated.example/account" }
        ] }
      }],
      restore,
      loadRemembered: async () => "https://cgnew.fts368.com/remembered"
    });

    await recovery.restore("CMD");

    expect(restore).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith("about:blank", false);
    expect(update).toHaveBeenCalledWith(11, "https://cgnew.fts368.com/remembered");
    expect(attach).toHaveBeenCalledWith({ id: 11, url: "https://cgnew.fts368.com/remembered" });
  });

  it("falls back to in-place navigation during restore when reload is unavailable", async () => {
    const operations: string[] = [];
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "CMD", tabId: 7 }],
      query: async () => [{ id: 7, url: "https://cgnew.fts368.com/live" }],
      update: async (tabId, url) => { operations.push(`update:${tabId}`); return { id: tabId, url }; },
      create: async (url: string) => { operations.push("create:8"); return { id: 8, url }; },
      attach: async (tab) => { operations.push(`attach:${tab.id}`); },
      remove: async (tabId) => { operations.push(`remove:${tabId}`); }
    });

    await recovery.restore("CMD");

    expect(operations).toEqual(["attach:7", "update:7"]);
  });

  it("reloads an existing source in place during restore without closing its tab", async () => {
    const operations: string[] = [];
    const create = vi.fn(async (url: string) => ({ id: 8, url }));
    const remove = vi.fn(async () => undefined);
    const recovery = new SourceTabRecovery({
      listAttached: () => [{ lobby: "CMD", tabId: 7 }],
      query: async () => [{ id: 7, url: "https://cgnew.fts368.com/live" }],
      create,
      remove,
      update: navigate,
      attach: async () => { operations.push("attach"); },
      attachBootstrap: async (tab, lobby) => { operations.push(`bootstrap:${lobby}:${tab.id}`); },
      reload: async (tabId) => {
        operations.push(`reload:${tabId}`);
        return { id: tabId, url: "https://cgnew.fts368.com/live" };
      }
    });

    await recovery.restore("CMD");

    expect(operations).toEqual(["bootstrap:CMD:7", "reload:7"]);
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
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
