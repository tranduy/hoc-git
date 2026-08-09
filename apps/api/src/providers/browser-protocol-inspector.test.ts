import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clickSafeStructuralCategories,
  collectSafeControlShapes,
  discoverApiOriginFromFrame,
  findApiOriginFromPage,
  findAccessTokenFrame
} from "./browser-protocol-inspector.js";

describe("browser protocol inspector", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;

  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("collects redacted read-only control shapes from top page and child frames", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <button class="c-side-account">Show Balance</button>
      <iframe srcdoc='<button class="sports-upcoming">Football</button>'></iframe>
    `);
    await expect.poll(() => page.frames().length).toBe(2);
    expect(await collectSafeControlShapes(page)).toEqual([
      { tagName: "button", classTokens: ["c-side-account"], label: "show balance" },
      { tagName: "button", classTokens: ["sports-upcoming"], label: "football" }
    ]);
    await page.close();
  });

  it("clicks only the clickable ancestor of allowlisted category icons", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <a id="football" onclick="window.safeClicks += 1"><i class="c-iconcolor-sport1" style="display:block;width:10px;height:10px"></i></a>
      <a id="odds" onclick="window.unsafeClicks += 1"><i class="c-match__odds" style="display:block;width:10px;height:10px"></i></a>
      <script>window.safeClicks = 0; window.unsafeClicks = 0;</script>
    `);
    expect(await clickSafeStructuralCategories(page, 0)).toBe(1);
    expect(await page.evaluate(() => ({
      safe: (window as unknown as { safeClicks: number }).safeClicks,
      unsafe: (window as unknown as { unsafeClicks: number }).unsafeClicks
    }))).toEqual({ safe: 1, unsafe: 0 });
    await page.close();
  });

  it("includes redacted navigation ancestors around category icons", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="secret-canary c-side-nav__item"><span><i class="c-iconcolor-sport43" style="display:block;width:10px;height:10px"></i></span></div>
    `);
    expect(await collectSafeControlShapes(page)).toEqual([
      { tagName: "i", classTokens: ["c-iconcolor-sport43"] },
      { tagName: "div", classTokens: ["c-side-nav__item"] }
    ]);
    await page.close();
  });

  it("clicks React-delegated side navigation category buttons", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div id="category" class="c-side-nav__btn"><i class="c-iconcolor-sport43" style="display:block;width:10px;height:10px"></i></div>
      <script>window.safeClicks = 0; document.querySelector('#category').addEventListener('click', () => window.safeClicks += 1);</script>
    `);
    expect(await clickSafeStructuralCategories(page, 0)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { safeClicks: number }).safeClicks)).toBe(1);
    await page.close();
  });

  it("clicks the exact balance refresh control without touching a bet control", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <button id="refreshBtn">Refresh</button><button data-bet>Bet</button>
      <script>window.refreshClicks = 0; window.betClicks = 0;
        document.querySelector('#refreshBtn').addEventListener('click', () => window.refreshClicks += 1);
        document.querySelector('[data-bet]').addEventListener('click', () => window.betClicks += 1);
      </script>
    `);
    expect(await clickSafeStructuralCategories(page, 0)).toBe(1);
    expect(await page.evaluate(() => ({
      refresh: (window as unknown as { refreshClicks: number }).refreshClicks,
      bet: (window as unknown as { betClicks: number }).betClicks
    }))).toEqual({ refresh: 1, bet: 0 });
    await page.close();
  });

  it("selects the child frame that owns the provider access token", async () => {
    const withoutToken = { evaluate: async () => false };
    const withToken = { evaluate: async () => true };
    const page = { frames: () => [withoutToken, withToken] };
    expect(await findAccessTokenFrame(page)).toBe(withToken);
  });

  it("discovers only a clean HTTPS API origin from the provider runtime store", async () => {
    const page = await browser.newPage();
    await page.setContent("<main>provider shell</main>");
    await page.evaluate(() => {
      (globalThis as unknown as { UtilPack: unknown }).UtilPack = {
        siteInfoStore: { attrs: { ApiBackendUrl: "https://api.cmd.test/api/" } }
      };
    });
    expect(await discoverApiOriginFromFrame(page.mainFrame())).toBe("https://api.cmd.test/api");
    expect(await findApiOriginFromPage(page)).toBe("https://api.cmd.test/api");
    await page.evaluate(() => {
      (globalThis as unknown as { UtilPack: unknown }).UtilPack = {
        siteInfoStore: { attrs: { ApiBackendUrl: "https://user:pass@api.cmd.test/?token=secret" } }
      };
    });
    expect(await discoverApiOriginFromFrame(page.mainFrame())).toBeNull();
    await page.close();
  });
});
