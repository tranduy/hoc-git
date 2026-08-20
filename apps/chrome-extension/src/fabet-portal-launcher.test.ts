import { describe, expect, it, vi } from "vitest";
import { FabetPortalLauncher } from "./fabet-portal-launcher.js";

describe("FabetPortalLauncher", () => {
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
        return { id: tabId, url, title: "Fabet - Trang Cá Độ" };
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
    expect(operations.at(-1)).toBe("detach:3");
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
      .resolves.toMatchObject({ id: 9, title: "Sportsbook" });
    expect(attached).toEqual([9]);
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
      .resolves.toMatchObject({ id: 12, title: "Sportsbook" });
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
