import { chromium } from "playwright";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clickSafeStructuralCategories,
  clickSafeStructuralCategory,
  collectCmdCatalogShapes,
  extractCmdCatalogRecords,
  collectCmdCatalogNavigation,
  findCmdCatalogPage,
  collectCmdIdentitySignals,
  waitForCmdIdentitySignals,
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

  it("can select one exact sport without clicking the other category", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <button id="football"><i class="c-iconcolor-sport1">Football</i></button>
      <button id="esports"><i class="c-iconcolor-sport43">Esports</i></button>
      <script>window.clicked = []; football.onclick = () => clicked.push('1'); esports.onclick = () => clicked.push('43')</script>
    `);
    expect(await clickSafeStructuralCategory(page, "43", 0)).toBe(true);
    expect(await page.evaluate(() => (globalThis as unknown as { clicked: string[] }).clicked)).toEqual(["43"]);
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

  it("collects only public catalog structure inside football and esports odds tables", async () => {
    const page = await browser.newPage();
    await page.goto(testOrigin);
    await page.setContent(`
      <section class="c-odds-table--sport1">
        <div class="c-league" data-league-id="league-1">Premier Test</div>
        <div class="c-match" data-event-id="event-1">
          <span class="c-team">Alpha FC</span><button class="c-odds" data-selection-id="home">2.10</button>
        </div>
      </section>
      <section class="c-odds-table--sport43"><div class="c-event">Blue vs Red</div></section>
      <aside class="c-side-account">private account text</aside>
    `);
    const shapes = await collectCmdCatalogShapes(page);
    expect(shapes).toEqual(expect.arrayContaining([
      expect.objectContaining({ sportId: "1", classTokens: ["c-league"], text: "Premier Test", dataKeys: ["data-league-id"] }),
      expect.objectContaining({ sportId: "1", classTokens: ["c-team"], text: "Alpha FC" }),
      expect.objectContaining({ sportId: "1", classTokens: ["c-odds"], text: "2.10", dataKeys: ["data-selection-id"] }),
      expect.objectContaining({ sportId: "43", classTokens: ["c-event"], text: "Blue vs Red" })
    ]));
    expect(JSON.stringify(shapes)).not.toContain("private account text");
    await page.close();
  });

  it("extracts compact read-only CMD match and odds records", async () => {
    const page = await browser.newPage();
    await page.goto(testOrigin);
    await page.setContent(`
      <section class="c-odds-table--sport1">
        <div class="c-league" data-leagueid="league-1">
          <div class="c-league__name">Premier Test</div>
          <div class="c-match" data-matchid="event-1">
            <div class="c-match-time">08/17 02:30AM</div>
            <span class="c-team-name">Alpha FC</span><span class="c-team-name">Beta FC</span>
            <div class="c-match__odds-group">
              <div data-bt="1">FT 1X2
                <div class="c-odds-button" data-odds-status="running" data-grey-out="false">
                  <span class="c-odds" data-moid="home-1">2.10</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `);
    expect(await extractCmdCatalogRecords(page, 100)).toEqual([{
      sportId: "1",
      leagueId: "league-1",
      leagueName: "Premier Test",
      matchId: "event-1",
      timeText: "08/17 02:30AM",
      teamNames: ["Alpha FC", "Beta FC"],
      groups: [{
        betTypeIds: ["1"], labels: ["FT 1X2"],
        odds: [{ marketOddsId: "home-1", priceText: "2.10", status: "running", greyedOut: "false" }]
      }]
    }]);
    await page.close();
  });

  it("collects catalog navigation labels only from the event side navigation", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <nav class="c-side-nav--event"><div class="c-side-nav__btn" data-view="upcoming">Sắp diễn ra</div></nav>
      <div class="c-side-account">private account</div>
    `);
    expect(await collectCmdCatalogNavigation(page)).toEqual([{
      tagName: "div", classTokens: ["c-side-nav__btn"], dataKeys: ["data-view"], text: "Sắp diễn ra"
    }]);
    await page.close();
  });

  it("selects the provider sports popup instead of the launcher shell", async () => {
    const launcher = await browser.newPage();
    const sports = await browser.newPage();
    await launcher.setContent("<main>launcher shell</main>");
    await sports.setContent("<button><i class='c-iconcolor-sport1'>Football</i></button>");
    expect(await findCmdCatalogPage([launcher, sports])).toBe(sports);
    await launcher.close();
    await sports.close();
  });

  it("collects CMD identity signals from the child sports frame", async () => {
    const page = await browser.newPage();
    await page.goto(testOrigin);
    await page.setContent(`<iframe srcdoc="
      <i class='c-iconcolor-sport1'>Football</i><i class='c-iconcolor-sport43'>Esports</i>
      <script src='https://cdn.test/MS2L/Js/dt/main.js'></script>
      <script>sessionStorage.setItem('at','unit-test'); UtilPack={accountStore:{attrs:{Bal:{}}},siteInfoStore:{attrs:{ApiBackendUrl:'https://api.test/api'}},SyncServer:{json(){}}}</script>
    "></iframe>`);
    await page.waitForTimeout(50);
    expect(await collectCmdIdentitySignals(page)).toEqual({
      runtime: true, football: true, esports: true, cmdBundle: true
    });
    await page.close();
  });

  it("waits for a navigating sports frame to expose all CMD identity signals", async () => {
    const page = await browser.newPage();
    await page.goto(testOrigin);
    await page.setContent("<main>loading</main>");
    await page.evaluate(() => setTimeout(() => {
      document.body.innerHTML = `<i class='c-iconcolor-sport1'>Football</i><i class='c-iconcolor-sport43'>Esports</i><script src='https://cdn.test/MS2L/Js/dt/main.js'></script>`;
      sessionStorage.setItem("at", "unit-test");
      (globalThis as unknown as { UtilPack: unknown }).UtilPack = {
        accountStore: { attrs: { Bal: {} } }, siteInfoStore: { attrs: { ApiBackendUrl: "https://api.test/api" } },
        SyncServer: { json() { return undefined; } }
      };
    }, 100));
    expect(await waitForCmdIdentitySignals(page, 1_000, 25)).toEqual({
      runtime: true, football: true, esports: true, cmdBundle: true
    });
    await page.close();
  });
});
