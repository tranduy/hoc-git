import { chromium } from "playwright";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clickSafeStructuralCategories,
  collectSafeControlShapes,
  discoverApiOriginFromFrame,
  findApiOriginFromPage,
  findAccessTokenFrame,
  findProviderRuntimeFrame,
  probeReadOnlyProfileThroughRuntime,
  readProviderAccountStore
} from "./browser-protocol-inspector.js";

describe("browser protocol inspector", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let server: Server;
  let testOrigin: string;

  beforeAll(async () => {
    server = createServer((_request, response) => { response.end("<!doctype html><main>provider shell</main>"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    testOrigin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

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
    await page.goto(testOrigin);
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

  it("uses the provider runtime helper for an allowlisted read-only profile request", async () => {
    const page = await browser.newPage();
    await page.goto(testOrigin);
    await page.evaluate(() => {
      sessionStorage.setItem("at", "unit-test-credential");
      (globalThis as unknown as { UtilPack: unknown }).UtilPack = {
        siteInfoStore: { attrs: { ApiBackendUrl: "https://api.cmd.test/api" } },
        accountStore: { attrs: { balanceContent: { cashBalance: "100000" }, Currency: "VND" } },
        SyncServer: {
          json: (url: string, _data: unknown, success: (body: unknown) => void, _async: boolean,
            _failure: (body: unknown) => void, method: string) => {
            if (url === "https://api.cmd.test/api/CashMember/GetUserInfo" && method === "GET") {
              success({ balanceContent: { cashBalance: "100000" } });
            }
          }
        }
      };
    });
    expect(await findProviderRuntimeFrame(page)).toBe(page.mainFrame());
    expect(await probeReadOnlyProfileThroughRuntime(page.mainFrame(), {
      endpoint: "/CashMember/GetUserInfo", method: "GET", timeoutMs: 500
    })).toEqual({ status: "OK", httpStatus: null, body: { balanceContent: { cashBalance: "100000" } } });
    expect(await readProviderAccountStore(page.mainFrame())).toEqual({
      balanceContent: { cashBalance: "100000" }, Currency: "VND"
    });
    await page.close();
  });
});
