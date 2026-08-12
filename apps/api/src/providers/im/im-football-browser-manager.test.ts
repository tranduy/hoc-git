import type { Page, Response } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { isImFootballCatalogResponse, PlaywrightImFootballBrowserManager,
  validateImFootballLaunchUrl } from "./im-football-browser-manager.js";

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
      request: () => ({ method: () => "POST", postDataJSON: () => ({ Market: 2 }) })
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
});
