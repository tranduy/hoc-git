import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { PlaywrightImEsportsBrowserManager } from "./im-esports-browser-manager.js";

describe("PlaywrightImEsportsBrowserManager", () => {
  it("reads the catalog from the current Fabet-launched IM page", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route("https://imesports.techplay.com/**", async (route) => {
      const request = route.request();
      if (request.url().endsWith("/api/GetIndexMatchV2") && request.method() === "POST") {
        await route.fulfill({ status: 200, contentType: "application/json", json: { StatusCode: 0, Sport: [{
          SportId: 45, SportName: "LOL", LG: [{ LGId: 7, LGName: "LCK", ParentMatch: [{
            PMatchNo: 10, PHTId: 1, PHTName: "T1", PATId: 2, PATName: "G2", PMCDate: "2026-08-13",
            Match: [{ MatchNo: 11, GTCode: "SeriesWin", GTName: "Winner", GTMarketGroup: "Series",
              GameOrder: 0, Status: 1, IsLive: true, MCDate: "2026-08-13", Odds: [{ SEL: [
                { SCode: 1, SName: "T1", Odds: 1.8, HDP: 0, IsLock: false },
                { SCode: 2, SName: "G2", Odds: 2.1, HDP: 0, IsLock: false }
              ] }] }]
          }] }]
        }] } });
        return;
      }
      await route.fulfill({ status: 200, contentType: "text/html", body:
        "<!doctype html><script>fetch('/api/GetIndexMatchV2',{method:'POST'})</script>" });
    });
    await page.goto("https://imesports.techplay.com/esportsitev2/index.html");
    const manager = new PlaywrightImEsportsBrowserManager({ profilesRoot: ".", headless: true, startupTimeoutMs: 3_000 });
    try {
      await expect(manager.readCatalogFromPage(page)).resolves.toEqual([
        expect.objectContaining({ sportId: 45, gameTypeCode: "SeriesWin", parentHomeName: "T1", parentAwayName: "G2" })
      ]);
    } finally {
      await manager.close();
      await browser.close();
    }
  }, 10_000);
});
