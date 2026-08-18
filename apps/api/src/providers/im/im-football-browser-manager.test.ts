import type { Page, Response } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { isImFootballCatalogResponse, PlaywrightImFootballBrowserManager,
  validateImFootballLaunchUrl } from "./im-football-browser-manager.js";
import { ImFootballDirectTransport } from "./im-football-direct-transport.js";

describe("I-Sports Football identity", () => {
  it("accepts only the verified Sunflower host family", () => {
    expect(validateImFootballLaunchUrl("https://imsports.directsb.net/?language=vi"))
      .toBe("https://imsports.directsb.net/?language=vi");
    expect(() => validateImFootballLaunchUrl("https://imesports.techplay.com/esportsitev2/index.html"))
      .toThrow("IM_FOOTBALL_LAUNCH_REJECTED");
    expect(() => validateImFootballLaunchUrl("https://imsports.directsb.net.evil.test/"))
      .toThrow("IM_FOOTBALL_LAUNCH_REJECTED");
  });

  it("requires a successful EventV6 envelope instead of trusting the hostname alone", () => {
    expect(isImFootballCatalogResponse("https://imsports.directsb.net/api/EventV6/GetSE",
      { sel: [], StatusCode: 100 })).toBe(true);
    expect(isImFootballCatalogResponse("https://imsports.directsb.net/api/EventV6/GetSEDelta",
      { dc: [], StatusCode: 100 })).toBe(true);
    expect(isImFootballCatalogResponse("https://imsports.directsb.net/api/HomeV6/GetSP",
      { mn: "TECHPLAY", StatusCode: 100 })).toBe(false);
    expect(isImFootballCatalogResponse("https://evil.test/api/EventV6/GetALE",
      { sel: [], StatusCode: 100 })).toBe(false);
    expect(isImFootballCatalogResponse("https://imsports.directsb.net/api/EventV6/GetALE",
      { sel: [], StatusCode: 500 })).toBe(false);
  });

  it("captures a focused snapshot from the already authenticated Fabet provider page", async () => {
    let responseHandler: ((response: Response) => void) | null = null;
    const body = { StatusCode: 100, sel: [{ eid: 20, htn: "Home", atn: "Away", cn: "League",
      edt: "2026-08-13T10:00:00+07:00", isrbt: false, iscyb: false, mls: [{ mi: 30, bti: 1, gp: 1, ws: [
        { wsi: 31, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8 },
        { wsi: 32, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9 }
      ] }] }] };
    const response = {
      url: () => "https://imsports.directsb.net/api/EventV6/GetSE",
      ok: () => true,
      json: async () => body,
      request: () => ({ method: () => "POST", postDataJSON: () => ({ Market: 2 }),
        allHeaders: async () => ({ "content-type": "application/json", cookie: "provider-session=private" }) })
    } as unknown as Response;
    const page = {
      on: vi.fn((event: string, handler: (value: Response) => void) => { if (event === "response") responseHandler = handler; }),
      reload: vi.fn(async () => { responseHandler?.(response); }),
      waitForTimeout: vi.fn(async () => undefined),
      isClosed: () => false
    } as unknown as Page;
    const manager = new PlaywrightImFootballBrowserManager({ profilesRoot: "unused", startupTimeoutMs: 100 });

    const snapshot = await manager.readCatalogFromPage(page);

    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]?.markets[0]?.selections.map((item) => item.priceText)).toEqual(["0.8", "-0.9"]);
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it("uses the learned authenticated request directly on warm reads without reloading the page", async () => {
    let responseHandler: ((response: Response) => void) | null = null;
    const event = (homeOdds: number, awayOdds: number) => ({ StatusCode: 100, sel: [{
      eid: 20, htn: "Home", atn: "Away", cn: "League", edt: "2026-08-13T10:00:00+07:00",
      isrbt: true, rbt: "1H 10:00", hs: 0, as: 0, iscyb: false, mls: [{ mi: 30, bti: 1, gp: 1, ws: [
        { wsi: 31, si: 1, hdp: -0.5, dih: "+0.5", o: homeOdds },
        { wsi: 32, si: 2, hdp: -0.5, dih: "-0.5", o: awayOdds }
      ] }]
    }] });
    const response = {
      url: () => "https://imsports.directsb.net/api/EventV6/GetSE",
      ok: () => true,
      json: async () => event(0.8, -0.9),
      request: () => ({ method: () => "POST", postDataJSON: () => ({ SportId: 1, Market: 2 }),
        allHeaders: async () => ({ "content-type": "application/json", cookie: "provider-session=private" }) })
    } as unknown as Response;
    const page = {
      on: vi.fn((name: string, handler: (value: Response) => void) => { if (name === "response") responseHandler = handler; }),
      reload: vi.fn(async () => { responseHandler?.(response); }),
      waitForTimeout: vi.fn(async () => undefined),
      isClosed: () => false
    } as unknown as Page;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(event(0.95, -0.99)), { status: 200 }));
    const manager = new PlaywrightImFootballBrowserManager({ profilesRoot: "unused", startupTimeoutMs: 100,
      directTransport: new ImFootballDirectTransport({ fetchImpl, timeoutMs: 100 }) });

    await manager.readCatalogFromPage(page);
    const warm = await manager.readCatalogFromPage(page);

    expect(page.reload).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(warm.records[0]?.markets[0]?.selections.map((item) => item.priceText)).toEqual(["0.95", "-0.99"]);
  });

  it("invalidates an expired direct lease and reloads the retained provider page to renew it", async () => {
    let responseHandler: ((response: Response) => void) | null = null;
    const body = { StatusCode: 100, sel: [{ eid: 20, htn: "Home", atn: "Away", cn: "League",
      edt: "2026-08-13T10:00:00+07:00", isrbt: false, iscyb: false, mls: [{ mi: 30, bti: 1, gp: 1, ws: [
        { wsi: 31, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8 },
        { wsi: 32, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9 }
      ] }] }] };
    let cookieGeneration = 0;
    const response = {
      url: () => "https://imsports.directsb.net/api/EventV6/GetSE",
      ok: () => true,
      json: async () => body,
      request: () => ({ method: () => "POST", postDataJSON: () => ({ SportId: 1, Market: 2 }),
        allHeaders: async () => ({ "content-type": "application/json", cookie: `provider-session=${++cookieGeneration}` }) })
    } as unknown as Response;
    const page = {
      on: vi.fn((name: string, handler: (value: Response) => void) => { if (name === "response") responseHandler = handler; }),
      reload: vi.fn(async () => { responseHandler?.(response); }),
      waitForTimeout: vi.fn(async () => undefined), isClosed: () => false
    } as unknown as Page;
    const manager = new PlaywrightImFootballBrowserManager({ profilesRoot: "unused", startupTimeoutMs: 100,
      directTransport: new ImFootballDirectTransport({
        fetchImpl: async () => new Response(JSON.stringify({ StatusCode: 500, sel: [] }), { status: 200 }),
        timeoutMs: 100
      }) });

    await manager.readCatalogFromPage(page);
    await expect(manager.readCatalogDirect()).rejects.toThrow("IM_FOOTBALL_DIRECT_UNAVAILABLE");
    await expect(manager.readCatalogFromPage(page)).resolves.toMatchObject({ records: [expect.any(Object)] });

    expect(page.reload).toHaveBeenCalledTimes(2);
    expect(cookieGeneration).toBe(2);
  });
});
