import { describe, expect, it, vi } from "vitest";
import { FabetPortalLauncher } from "./fabet-portal-launcher.js";

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
