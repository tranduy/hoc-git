import { describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { FabetPortalLauncher } from "./fabet-portal-launcher.js";

type ImTab = { id: number; url: string; openerTabId?: number; status?: "complete" | "loading" };
function imHarness(options: { login?: boolean; cards?: Array<{ label: string; image: string; x: number; highlight?: boolean }>;
  onClick?: (h: { create(tab: ImTab): void; change(tab: ImTab): void }) => void } = {}) {
  const portal = { id: 3, url: "https://fabet.monster/lobby-the-thao?type=livesports", status: "complete" as const };
  const tabs = new Map<number, ImTab>([[3, portal], [9, { id: 9, url: "https://imsports.directsb.net/?token=OLD_UNRELATED" }]]);
  let created: ((tab: ImTab) => void) | undefined;
  let updated: ((id: number, info: unknown, tab: ImTab) => void) | undefined;
  const rect = (x: number) => ({ left: x, top: 10, width: 20, height: 20 });
  const cards = (options.cards ?? [{ label: "I-Sports", image: "/game/im-sports.webp", x: 80 }]).map(card => {
    const control = { getBoundingClientRect: () => rect(card.x), focus() {} };
    return { textContent: card.label, getClientRects: () => [rect(card.x)], scrollIntoView() {},
      closest: (selector: string) => selector === ".sport-categories-container__content-highlight" && card.highlight ? {} : null,
      getBoundingClientRect: () => rect(card.x), querySelector: (selector: string) => selector.includes("name")
        ? { textContent: card.label } : selector.includes("img") ? { getAttribute: () => card.image } : control };
  });
  const document = { querySelectorAll: (selector: string) => selector.includes(".game-item.lobby") ? cards
    : selector.includes("button") && options.login ? [{ textContent: "Login", getClientRects: () => [rect(1)] }] : [] };
  const h = { create(tab: ImTab) { tabs.set(tab.id, tab); created?.(tab); },
    change(tab: ImTab) { tabs.set(tab.id, tab); updated?.(tab.id, { url: tab.url }, tab); } };
  const attachSource = vi.fn(async () => undefined);
  const update = vi.fn(async (id: number, url: string) => { const tab = { id, url }; tabs.set(id, tab); return tab; });
  const detachDebugger = vi.fn(async () => undefined);
  const sendCommand = vi.fn(async (_tabId: number, method: string, params: Record<string, unknown>) => {
    if (method === "Runtime.evaluate") return { result: { value: vm.runInNewContext(String(params.expression), {
      document, innerWidth: 1000, innerHeight: 1000,
      getComputedStyle: () => ({ visibility: "visible", display: "block" }) }) } };
    if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") options.onClick?.(h);
    return {};
  });
  const launcher = new FabetPortalLauncher({ query: async () => [...tabs.values()], update,
    focusWindow: async () => undefined, attachDebugger: async () => undefined, detachDebugger, sendCommand,
    addCreatedListener: listener => { created = listener; }, removeCreatedListener: () => { created = undefined; },
    addUpdatedListener: listener => { updated = listener; }, removeUpdatedListener: () => { updated = undefined; },
    attachSource, get: async id => { const tab = tabs.get(id); if (!tab) throw Error("MISSING"); return tab; },
    delay: async () => undefined });
  return { launcher, tabs, attachSource, update, sendCommand, detachDebugger,
    listenersGone: () => created === undefined && updated === undefined };
}

describe("FabetPortalLauncher IM", () => {
  it("clicks only the football I-Sports card and attaches its native child without rewriting its URL", async () => {
    const h = imHarness({ cards: [
      { label: "I-Sports", image: "/game/betradar_esportss_landscape.avif", x: 20 },
      { label: "I-Sports", image: "/game/im-sports.webp", x: 80 }
    ], onClick: h => h.create({ id: 12, openerTabId: 3, url: "https://imsports.directsb.net/?token=FRESH_NATIVE" }) });
    await expect(h.launcher.launchIm()).resolves.toMatchObject({ id: 12 });
    expect(h.attachSource).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 12 }), "IM");
    expect(h.update).not.toHaveBeenCalled();
    const clicks = h.sendCommand.mock.calls.filter(([, m, p]) => m === "Input.dispatchMouseEvent" && p.type === "mouseReleased");
    expect(clicks).toHaveLength(1); expect(clicks[0]![2]).toMatchObject({ x: 90 });
    expect(h.listenersGone()).toBe(true); expect(h.detachDebugger).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("rejects an unchanged old IM tab and a newly-created unrelated IM tab after one click", async () => {
    const h = imHarness({ onClick: h => h.create({ id: 14, openerTabId: 800, url: "https://imsports.directsb.net/" }) });
    await expect(h.launcher.launchIm()).rejects.toThrow("FABET_IM_POPUP_UNAVAILABLE");
    expect(h.attachSource).not.toHaveBeenCalled();
    expect(h.sendCommand.mock.calls.filter(([, m, p]) => m === "Input.dispatchMouseEvent" && p.type === "mouseReleased")).toHaveLength(1);
    expect(h.listenersGone()).toBe(true);
  });

  it("prefers the actual highlighted I-Sports card over the recently played duplicate", async () => {
    const h = imHarness({ cards: [
      { label: "I-Sports", image: "/coin.svg", x: 20 },
      { label: "I-Sports", image: "/game/im-sports.webp", x: 80, highlight: true },
      { label: "I-Sports", image: "/game/betradar_esportss_landscape.avif", x: 140, highlight: true }
    ], onClick: h => h.create({ id: 12, openerTabId: 3, url: "https://imsports.directsb.net/?token=FRESH_NATIVE" }) });
    await expect(h.launcher.launchIm()).resolves.toMatchObject({ id: 12 });
    const clicks = h.sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Input.dispatchMouseEvent" && params.type === "mouseReleased");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]![2]).toMatchObject({ x: 90 });
  });

  it("accepts a URL-changed named child only with the current portal opener", async () => {
    const h = imHarness({ onClick: h => h.change({ id: 13, openerTabId: 3, url: "https://imsports.directsb.net/?token=NEW" }) });
    h.tabs.set(13, { id: 13, openerTabId: 3, url: "about:blank" });
    await expect(h.launcher.launchIm()).resolves.toMatchObject({ id: 13 });
  });

  it("hands the debugger back before attaching IM when the native launch uses the portal tab", async () => {
    const h = imHarness({ onClick: h => h.change({ id: 3, url: "https://imsports.directsb.net/?token=NEW" }) });
    await expect(h.launcher.launchIm()).resolves.toMatchObject({ id: 3 });
    expect(h.detachDebugger.mock.invocationCallOrder[0]).toBeLessThan(h.attachSource.mock.invocationCallOrder[0]!);
    expect(h.detachDebugger).toHaveBeenCalledTimes(1);
  });

  it("cancels a retired launch before any click or source attachment", async () => {
    const h = imHarness(), controller = new AbortController(); controller.abort();
    await expect(h.launcher.launchIm(controller.signal)).rejects.toThrow("FABET_IM_LAUNCH_CANCELLED");
    expect(h.sendCommand).not.toHaveBeenCalled(); expect(h.attachSource).not.toHaveBeenCalled();
  });

  it.each(["http://imsports.directsb.net/", "https://other-provider.test/?token=WRONG"])("refuses a child at %s", async url => {
    const h = imHarness({ onClick: h => h.create({ id: 12, openerTabId: 3, url }) });
    await expect(h.launcher.launchIm()).rejects.toThrow("FABET_IM_POPUP_UNAVAILABLE");
    expect(h.attachSource).not.toHaveBeenCalled();
  });

  it("returns explicit authentication failure without clicking a provider", async () => {
    const h = imHarness({ login: true });
    await expect(h.launcher.launchIm()).rejects.toThrow("FABET_NOT_AUTHENTICATED");
    expect(h.sendCommand.mock.calls.some(([, m]) => m === "Input.dispatchMouseEvent")).toBe(false);
    expect(h.listenersGone()).toBe(true);
  });

  it("rejects ambiguous football cards before clicking", async () => {
    const h = imHarness({ cards: [{ label: "I-Sports", image: "/game/im.webp", x: 10 },
      { label: "I-Sports", image: "/game/other-im.webp", x: 100 }] });
    await expect(h.launcher.launchIm()).rejects.toThrow("FABET_IM_CONTROL_AMBIGUOUS");
    expect(h.sendCommand.mock.calls.some(([, m]) => m === "Input.dispatchMouseEvent")).toBe(false);
  });
});

describe("FabetPortalLauncher", () => {
  it("never reattaches an unchanged expired SABA tab when Chrome briefly clears its error title", async () => {
    const expired = "https://c0z0ob.bpd3a3fn.com/(S(expired))/VendorGame/ErrorPage?ErrCode=SPA-1";
    const remembered = "https://c0z0ob.bpd3a3fn.com/(S(expired))/NewIndex";
    let updated: ((tabId: number, changeInfo: unknown,
      tab: { id?: number; url?: string; title?: string }) => void) | null = null;
    const attachSource = vi.fn(async () => undefined);
    const launcher = new FabetPortalLauncher({
      query: async () => [
        { id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby" },
        { id: 21, url: expired, title: "SPA-1" }
      ],
      update: async (tabId, url) => ({ id: tabId, url, title: "Lobby" }),
      focusWindow: async () => undefined,
      attachDebugger: async () => undefined,
      detachDebugger: async () => undefined,
      sendCommand: async (_tabId, method, params) => {
        if (method === "Runtime.evaluate") return { result: { value: { x: 10, y: 20, ready: true } } };
        if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased" && updated !== null) {
          updated(21, {}, { id: 21, url: expired, title: "" });
        }
        return {};
      },
      addCreatedListener: () => undefined,
      removeCreatedListener: () => undefined,
      addUpdatedListener: (listener) => { updated = listener; },
      removeUpdatedListener: () => { updated = null; },
      attachSource,
      get: async () => ({ id: 21, url: expired, title: "" }),
      delay: async () => undefined
    });

    await expect(launcher.launchSaba(remembered)).rejects.toThrow("FABET_SABA_POPUP_UNAVAILABLE");
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("opens C-Sports from Fabet and keeps the fresh server-issued SABA session URL", async () => {
    let clicked = false;
    const attached: Array<{ tabId: number; expectedLobby: string | undefined }> = [];
    const fresh = "https://c0z0oa.bpy6vurb.com/(S(fresh))/NewIndex";
    const navigations: Array<{ tabId: number; url: string }> = [];
    const launcher = new FabetPortalLauncher({
      query: async () => clicked
        ? [
            { id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby" },
            { id: 21, url: fresh, title: "Sports" }
          ]
        : [{ id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby" }],
      update: async (tabId, url) => {
        navigations.push({ tabId, url });
        return { id: tabId, url, title: tabId === 21 ? "Sports" : "Lobby" };
      },
      focusWindow: async () => undefined,
      attachDebugger: async () => undefined,
      detachDebugger: async () => undefined,
      sendCommand: async (_tabId, method, params) => {
        if (method === "Runtime.evaluate") return { result: { value: { x: 10, y: 20, ready: true } } };
        if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") clicked = true;
        return {};
      },
      addCreatedListener: () => undefined,
      removeCreatedListener: () => undefined,
      attachSource: async (tab, expectedLobby) => { attached.push({ tabId: tab.id!, expectedLobby }); },
      get: async (tabId) => ({ id: tabId, url: fresh, title: "Sports" }),
      delay: async () => undefined
    });

    await expect(launcher.launchSaba(
      "https://c0z0ob.bpd3a3fn.com/(S(expired))/NewIndex"
    )).resolves.toMatchObject({ id: 21, url: fresh });
    expect(attached).toEqual([{ tabId: 21, expectedLobby: "SABA" }]);
    expect(navigations.filter(({ tabId }) => tabId === 21)).toEqual([]);
  });

  it("really reloads an already-open canonical sports portal before requesting SABA", async () => {
    let clicked = false;
    const fresh = "https://c0z0oa.bpy6vurb.com/(S(fresh))/NewIndex";
    const reload = vi.fn(async (tabId: number) => ({ id: tabId,
      url: "https://fabet.markets/lobby-the-thao?type=livesports", title: "Lobby", windowId: 9 }));
    const update = vi.fn(async (tabId: number, url: string) => ({ id: tabId, url, title: "Lobby" }));
    const launcher = new FabetPortalLauncher({
      query: async () => clicked
        ? [
            { id: 3, url: "https://fabet.markets/lobby-the-thao?type=livesports", title: "Lobby" },
            { id: 21, url: fresh, title: "Sports" }
          ]
        : [{ id: 3, url: "https://fabet.markets/lobby-the-thao?type=livesports", title: "Lobby" }],
      update,
      reload,
      focusWindow: async () => undefined,
      attachDebugger: async () => undefined,
      detachDebugger: async () => undefined,
      sendCommand: async (_tabId, method, params) => {
        if (method === "Runtime.evaluate") return { result: { value: { x: 10, y: 20, ready: true } } };
        if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") clicked = true;
        return {};
      },
      addCreatedListener: () => undefined,
      removeCreatedListener: () => undefined,
      attachSource: async () => undefined,
      get: async (tabId) => ({ id: tabId, url: fresh, title: "Sports" }),
      delay: async () => undefined
    });

    await expect(launcher.launchSaba()).resolves.toMatchObject({ id: 21, url: fresh });
    expect(reload).toHaveBeenCalledExactlyOnceWith(3);
    expect(update).not.toHaveBeenCalled();
  });

  it("never attaches the opaque zenandfe/Volta bootstrap tab as K-Sports", async () => {
    let clicked = false;
    const attachSource = vi.fn(async () => undefined);
    const launcher = new FabetPortalLauncher({
      query: async () => clicked
        ? [
            { id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" },
            { id: 12, url: "https://zenandfe.com/?agentId=4&token=opaque", title: "zenandfe.com/?agentId=4&token=opaque" }
          ]
        : [{ id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" }],
      update: async (tabId, url) => ({ id: tabId, url, title: "Lobby Thể Thao" }),
      focusWindow: async () => undefined,
      attachDebugger: async () => undefined,
      detachDebugger: async () => undefined,
      sendCommand: async (_tabId, method, params) => {
        if (method === "Runtime.evaluate") return { result: { value: { x: 10, y: 20, ready: true } } };
        if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") clicked = true;
        return {};
      },
      addCreatedListener: () => undefined,
      removeCreatedListener: () => undefined,
      attachSource,
      get: async (tabId) => ({
        id: tabId,
        url: "https://zenandfe.com/?agentId=4&token=opaque",
        title: "zenandfe.com/?agentId=4&token=opaque"
      }),
      delay: async () => undefined
    });

    await expect(launcher.launchKsport("https://zenandfe.com/?token=marker"))
      .rejects.toThrow("FABET_KSPORT_POPUP_UNAVAILABLE");
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("opens K-Sports from the portal and attaches before waiting for bootstrap stability", async () => {
    let created: ((tab: { id?: number; url?: string; title?: string; openerTabId?: number }) => void) | null = null;
    const operations: string[] = [];
    let inspected = false;
    let getCount = 0;
    let attachedAtGet = 0;
    let evaluations = 0;
    const launcher = new FabetPortalLauncher({
      query: async () => [{ id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" }],
      update: async (tabId, url, active) => {
        operations.push(`update:${tabId}:${active}`);
        return { id: tabId, url, title: tabId === 8 ? "Sportsbook" : "Fabet - Trang Cá Độ" };
      },
      focusWindow: async () => undefined,
      attachDebugger: async (tabId) => { operations.push(`debug:${tabId}`); },
      detachDebugger: async (tabId) => { operations.push(`detach:${tabId}`); },
      sendCommand: async (_tabId, method) => {
        operations.push(method);
        if (method === "Runtime.evaluate") {
          inspected = true;
          evaluations++;
          return { result: { value: { x: 120, y: 240, ready: evaluations > 1 } } };
        }
        if (method === "Input.dispatchMouseEvent" && created !== null) {
          if (created !== null) {
            const notify = created as (tab: { id?: number; url?: string; title?: string; openerTabId?: number }) => void;
            notify({ id: 8, openerTabId: 3 });
          }
        }
        return {};
      },
      addCreatedListener: (listener) => { created = listener; },
      removeCreatedListener: () => { created = null; },
      attachSource: async (tab) => { attachedAtGet = getCount; operations.push(`source:${tab.id}:${tab.url}`); },
      get: async () => { getCount++; return { id: 8, url: "https://zenandfe.com/?token=fresh", title: "Sportsbook" }; },
      delay: async () => undefined
    });

    await expect(launcher.launchKsport("https://zenandfe.com/?token=marker"))
      .resolves.toMatchObject({ id: 8, title: "Sportsbook" });
    expect(operations).toContain("source:8:https://zenandfe.com/?token=fresh");
    expect(attachedAtGet).toBe(1);
    expect(evaluations).toBe(2);
    expect(inspected).toBe(true);
    expect(operations).toContain("update:8:false");
    expect(operations.at(-1)).toBe("detach:3");
  });

  it("creates a fresh football launch URL from the Fabet-issued K-Sports token", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_787_312_596_274);
    const navigations: string[] = [];
    let clicked = false;
    const launcher = new FabetPortalLauncher({
      query: async () => clicked
        ? [
            { id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" },
            { id: 8, url: "https://zenandfe.com/?token=child", title: "Sportsbook" }
          ]
        : [{ id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" }],
      update: async (tabId, url) => {
        navigations.push(url);
        return { id: tabId, url, title: tabId === 8 ? "Sportsbook" : "Lobby Thể Thao" };
      },
      focusWindow: async () => undefined,
      attachDebugger: async () => undefined,
      detachDebugger: async () => undefined,
      sendCommand: async (_tabId, method, params) => {
        if (method === "Runtime.evaluate") return { result: { value: { x: 1, y: 2, ready: true } } };
        if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") clicked = true;
        return {};
      },
      addCreatedListener: () => undefined,
      removeCreatedListener: () => undefined,
      attachSource: async () => undefined,
      get: async (tabId) => ({ id: tabId, url: "https://zenandfe.com/?token=child", title: "Sportsbook" }),
      delay: async () => undefined
    });

    await launcher.launchKsport("https://zenandfe.com/?agentId=4&token=fresh");

    expect(navigations.at(-1)).toBe(
      "https://zenandfe.com/?agentId=4&token=fresh&sportId=1&lng=vi&t=1787312596274"
    );
    now.mockRestore();
  });

  it("fails closed when no signed-in Fabet portal tab exists", async () => {
    const launcher = new FabetPortalLauncher({
      query: async () => [{ id: 4, url: "https://example.test/", title: "Unrelated" }],
      update: vi.fn(), focusWindow: vi.fn(), attachDebugger: vi.fn(), detachDebugger: vi.fn(),
      sendCommand: vi.fn(), addCreatedListener: vi.fn(), removeCreatedListener: vi.fn(),
      attachSource: vi.fn(), get: vi.fn(), delay: async () => undefined
    });
    await expect(launcher.launchKsport("https://zenandfe.com/?token=marker"))
      .rejects.toThrow("FABET_PORTAL_TAB_UNAVAILABLE");
  });

  it("follows a provider child popup when the recognized launch tab closes itself", async () => {
    let created: ((tab: { id?: number; url?: string; title?: string; openerTabId?: number }) => void) | null = null;
    let delayCount = 0;
    const attached: number[] = [];
    const launcher = new FabetPortalLauncher({
      query: async () => [{ id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" }],
      update: async (tabId, url) => ({ id: tabId, url, title: "Lobby Thể Thao" }),
      focusWindow: async () => undefined,
      attachDebugger: async () => undefined,
      detachDebugger: async () => undefined,
      sendCommand: async (_tabId, method) => {
        if (method === "Runtime.evaluate") return { result: { value: { x: 1, y: 2, ready: true } } };
        if (method === "Input.dispatchMouseEvent" && created !== null) {
          if (created !== null) {
            const notify = created as (tab: { id?: number; openerTabId?: number }) => void;
            notify({ id: 8, openerTabId: 3 });
          }
        }
        return {};
      },
      addCreatedListener: (listener) => { created = listener; },
      removeCreatedListener: () => { created = null; },
      attachSource: async (tab) => { attached.push(tab.id!); },
      get: async (tabId) => {
        if (tabId === 8) throw new Error("TAB_CLOSED");
        return { id: 9, openerTabId: 8, url: "https://zenandfe.com/?token=child", title: "Sportsbook" };
      },
      delay: async () => {
        delayCount++;
        if (delayCount === 1 && created !== null) {
          const notify = created as (tab: { id?: number; openerTabId?: number }) => void;
          notify({ id: 9, openerTabId: 8 });
        }
      }
    });

    await expect(launcher.launchKsport("https://zenandfe.com/?token=marker"))
      .resolves.toMatchObject({ id: 9 });
    expect(attached).toEqual([9]);
  });

  it("does not accept a short-lived sportsbook bootstrap before its final child appears", async () => {
    let created: ((tab: { id?: number; url?: string; title?: string; openerTabId?: number }) => void) | null = null;
    let delayCount = 0;
    const attached: number[] = [];
    const launcher = new FabetPortalLauncher({
      query: async () => [{ id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" }],
      update: async (tabId, url) => ({ id: tabId, url, title: "Lobby Thể Thao" }),
      focusWindow: async () => undefined,
      attachDebugger: async () => undefined,
      detachDebugger: async () => undefined,
      sendCommand: async (_tabId, method) => {
        if (method === "Runtime.evaluate") return { result: { value: { x: 1, y: 2, ready: true } } };
        if (method === "Input.dispatchMouseEvent" && created !== null) {
          const notify = created as (tab: { id?: number; openerTabId?: number }) => void;
          notify({ id: 8, openerTabId: 3 });
        }
        return {};
      },
      addCreatedListener: (listener) => { created = listener; },
      removeCreatedListener: () => { created = null; },
      attachSource: async (tab) => { attached.push(tab.id!); },
      get: async (tabId) => {
        if (tabId === 8 && delayCount >= 9) throw new Error("TAB_CLOSED");
        return { id: tabId, openerTabId: tabId === 9 ? 8 : 3,
          url: "https://zenandfe.com/?token=fresh", title: "Sportsbook" };
      },
      delay: async () => {
        delayCount++;
        if (delayCount === 9 && created !== null) {
          const notify = created as (tab: { id?: number; openerTabId?: number }) => void;
          notify({ id: 9, openerTabId: 8 });
        }
      }
    });

    await expect(launcher.launchKsport("https://zenandfe.com/?token=marker"))
      .resolves.toMatchObject({ id: 9 });
    expect(attached).toEqual([8, 9]);
  });

  it("discovers a K-Sports popup that Chrome creates without an opener id", async () => {
    let clicked = false;
    const attached: number[] = [];
    const launcher = new FabetPortalLauncher({
      query: async () => clicked
        ? [
            { id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" },
            { id: 12, url: "https://zenandfe.com/?token=fresh", title: "Sportsbook" }
          ]
        : [{ id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" }],
      update: async (tabId, url) => ({ id: tabId, url, title: "Lobby Thể Thao" }),
      focusWindow: async () => undefined,
      attachDebugger: async () => undefined,
      detachDebugger: async () => undefined,
      sendCommand: async (_tabId, method) => {
        if (method === "Runtime.evaluate") return { result: { value: { x: 10, y: 20, ready: true } } };
        if (method === "Input.dispatchMouseEvent") clicked = true;
        return {};
      },
      addCreatedListener: () => undefined,
      removeCreatedListener: () => undefined,
      attachSource: async (tab) => { attached.push(tab.id!); },
      get: async (tabId) => ({ id: tabId, url: "https://zenandfe.com/?token=fresh", title: "Sportsbook" }),
      delay: async () => undefined
    });

    await expect(launcher.launchKsport("https://zenandfe.com/?token=marker"))
      .resolves.toMatchObject({ id: 12 });
    expect(attached).toEqual([12]);
  });

  it("retries the trusted K-Sports card when the first click creates no popup", async () => {
    let clicks = 0;
    const attached: number[] = [];
    const launcher = new FabetPortalLauncher({
      query: async () => clicks >= 2
        ? [
            { id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" },
            { id: 14, url: "https://zenandfe.com/?token=fresh", title: "Sportsbook" }
          ]
        : [{ id: 3, url: "https://fabet.monster/lobby-the-thao", title: "Lobby Thể Thao" }],
      update: async (tabId, url) => ({ id: tabId, url, title: "Lobby Thể Thao" }),
      focusWindow: async () => undefined,
      attachDebugger: async () => undefined,
      detachDebugger: async () => undefined,
      sendCommand: async (_tabId, method, params) => {
        if (method === "Runtime.evaluate") return { result: { value: { x: 10, y: 20, ready: true } } };
        if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") clicks++;
        return {};
      },
      addCreatedListener: () => undefined,
      removeCreatedListener: () => undefined,
      attachSource: async (tab) => { attached.push(tab.id!); },
      get: async (tabId) => ({ id: tabId, url: "https://zenandfe.com/?token=fresh", title: "Sportsbook" }),
      delay: async () => undefined
    });

    await expect(launcher.launchKsport("https://zenandfe.com/?token=marker"))
      .resolves.toMatchObject({ id: 14 });
    expect(clicks).toBe(2);
    expect(attached).toEqual([14]);
  });
});
