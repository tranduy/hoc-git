import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBtiSelectionPriceExpression, buildCmdSelectionPriceExpression, buildGenericSelectionPriceExpression,
  buildImSelectionPriceExpression,
  buildSbobetSelectionPriceExpression } from "./selection-price.js";

describe("visible provider price probe", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("reads the exact generic selection price rendered by the bookmaker without clicking it", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section data-event-id="event-1"><div data-market-id="market-1">
      <button id="selection-1"><span class="team">Away</span><strong class="odds-value">0.17</strong></button>
    </div></section>`);
    await page.evaluate(() => {
      (window as unknown as { clicks: number }).clicks = 0;
      document.querySelector("button")?.addEventListener("click", () => {
        (window as unknown as { clicks: number }).clicks += 1;
      });
    });

    const value = await page.evaluate(buildGenericSelectionPriceExpression({ providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "2.5" })) as
      { ok: boolean; rawOdds?: string; observedAtMs?: number };

    expect(value).toMatchObject({ ok: true, rawOdds: "0.17" });
    expect(value.observedAtMs).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(0);
    await page.close();
  });

  it("reads APSPORT's exact odd-item selection ID instead of another price in the match", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section><h3>Alpha vs Beta</h3>
      <button id="odd-item-other"><span class="match__odd-type">o 4.5</span><b class="match__odd-value">0.81</b></button>
      <button id="odd-item-56029030050009925a"><span class="match__odd-type">u 4.5</span>
        <b class="match__odd-value">0.17</b></button></section>`);

    const value = await page.evaluate(buildGenericSelectionPriceExpression({ providerEventId: "5602903",
      providerMarketId: "5602903:FT_TOTAL:4.5:0", providerSelectionId: "56029030050009925a",
      eventLabel: "Alpha vs Beta", participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME",
      selection: "UNDER", line: "4.5" })) as { ok: boolean; rawOdds?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.17" }));
    await page.close();
  });

  it("reads BTI's latest exact event-detail selection instead of requiring the ticket to be rendered", async () => {
    const page = await browser.newPage();
    await page.route("https://bti.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>No BTI ticket is rendered here</p>" }));
    await page.route("https://bti.example/api/eventpage/events/877857668386287616**", async (route) => {
      const selection = (id: string, price: string) => {
        const value: unknown[] = [];
        value[0] = id;
        value[8] = [null, null, null, null, null, price];
        return value;
      };
      const market: unknown[] = [];
      market[0] = "0OU877857669225148454";
      market[13] = [
        selection("wrong-selection", "0.91"),
        selection("0OU877857669225148454OMM", "-0.29")
      ];
      const event: unknown[] = [];
      event[0] = "877857668386287616";
      event[20] = [market];
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [event] }) });
    });
    await page.goto("https://bti.example/");

    const value = await page.evaluate(buildBtiSelectionPriceExpression({
      providerEventId: "877857668386287616",
      providerMarketId: "0OU877857669225148454:2.5",
      providerSelectionId: "0OU877857669225148454OMM",
      eventLabel: "Polisi Tanzania vs JKT Tanzania", participantA: "Polisi Tanzania",
      participantB: "JKT Tanzania", marketType: "FT_TOTAL", scope: "FULL_TIME",
      selection: "OVER", line: "2.5"
    })) as { ok: boolean; rawOdds?: string; reason?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "-0.29" }));
    await page.close();
  });

  it("refetches SBOBET's current event feed and reads the exact market selection", async () => {
    const page = await browser.newPage();
    let requests = 0;
    await page.route("https://sbobet.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>No SBOBET ticket is rendered here</p>" }));
    await page.route("https://sbobet.example/api/v2/getEvent**", async (route) => {
      requests += 1;
      if (requests === 2) expect(route.request().headers()["x-session-proof"]).toBe("current-tab-session");
      const price = requests === 1 ? "0.96" : "0.17";
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ payload: [{
        "8": "wrong-event", "7": { "3": ["0.75 9.99*56434230030000075h 0.95*x wrong-market"] }
      }, {
        "8": "5643423", "2": "El Daklyeh", "3": "Mega Sport Club",
        "7": { "3": [
          "0.75 8.88*56434230030000075h 0.95*x wrong-market",
          `0.75 ${price}*56434230030000075h 0.95*56434230030000075a 7307800681810075`
        ] }
      }] }) });
    });
    await page.goto("https://sbobet.example/");
    await page.evaluate(() => fetch("/api/v2/getEvent?live=1", { credentials: "include" }));

    const value = await page.evaluate(buildSbobetSelectionPriceExpression({
      providerEventId: "5643423", providerMarketId: "7307800681810075",
      providerSelectionId: "56434230030000075h", eventLabel: "El Daklyeh vs Mega Sport Club",
      participantA: "El Daklyeh", participantB: "Mega Sport Club",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "0.75"
    }, { url: "https://sbobet.example/api/v2/getEvent?live=1",
      headers: { "x-session-proof": "current-tab-session" } })) as
      { ok: boolean; rawOdds?: string; reason?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.17" }));
    expect(requests).toBe(2);
    await page.close();
  });

  it("uses SBOBET's same-origin getEvent endpoint when Chrome no longer retains the initial request entry", async () => {
    const page = await browser.newPage();
    await page.route("https://sbobet.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>The initial resource timing buffer is empty</p>" }));
    await page.route("https://sbobet.example/api/v2/getEvent", async (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ payload: { "8": "event-1",
        "7": { "3": ["2.5 0.17*selection-1 0.95*selection-2 market-1"] } } })
    }));
    await page.goto("https://sbobet.example/");

    const value = await page.evaluate(buildSbobetSelectionPriceExpression({ providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5"
    })) as { ok: boolean; rawOdds?: string; reason?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.17" }));
    await page.close();
  });

  it("reads IM's current DOM odds by exact event, market and opposing side", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section><h3>KaPa</h3><h3>JIPPO</h3>
      <button class="odds" id="112738921_1_1_-075_0_2503913473">0.98</button>
      <button class="odds" id="112738921_1_2_-075_0_2503913473">0.88</button>
      <button class="odds" id="112738921_1_2_0_0_2503913474">0.64</button></section>`);

    const value = await page.evaluate(buildImSelectionPriceExpression({ providerEventId: "112738921",
      providerMarketId: "2503913473", providerSelectionId: "32394906714", eventLabel: "KaPa vs JIPPO",
      participantA: "KaPa", participantB: "JIPPO",
      marketType: "FT_AH", scope: "FULL_TIME", selection: "AWAY", line: "0.75" })) as
      { ok: boolean; rawOdds?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.88" }));
    await page.close();
  });

  it("opens IM's exact collapsed event row before reading the direct visible price", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="match-row-title"><h3>KaPa</h3><h3>JIPPO</h3></section>`);
    await page.evaluate(() => {
      document.querySelector(".match-row-title")?.addEventListener("click", () => {
        setTimeout(() => {
          document.body.innerHTML = `<h2>KaPa</h2><h2>JIPPO</h2>
            <span id="eventId-prematch-2060-5637918"></span>
            <button class="odd-item-detail" id="odd-detail-56379180050000075h">0.98</button>
            <button class="odd-item-detail" id="odd-detail-56379180050000075a">0.91</button>`;
        }, 25);
      });
    });

    const expression = buildImSelectionPriceExpression({ providerEventId: "112738921",
      providerMarketId: "2503913473", providerSelectionId: "32394906714", eventLabel: "KaPa vs JIPPO",
      participantA: "KaPa", participantB: "JIPPO",
      marketType: "FT_AH", scope: "FULL_TIME", selection: "AWAY", line: "0.75" });
    expect(await page.evaluate(expression)).toEqual({ ok: false, reason: "IM_NAVIGATION_REQUESTED" });
    await page.waitForTimeout(50);
    const value = await page.evaluate(expression) as { ok: boolean; rawOdds?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.91" }));
    await page.close();
  });

  it("finds one visible semantic event, market line and opposing selection without using network IDs", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="event"><h3>Beta - Alpha</h3>
      <div class="market"><h4>Full Time Total</h4>
        <button class="selection"><span>Over 4.5</span><strong class="odds-value">0.41</strong></button>
        <button class="selection"><span>Under 4.5</span><strong class="odds-value">0.17</strong></button></div>
      <div class="market"><h4>Full Time Total</h4>
        <button class="selection"><span>Under 5.5</span><strong class="odds-value">0.88</strong></button></div>
    </section><section class="event" hidden><h3>Alpha Beta</h3>
      <button class="selection"><span>Under 4.5</span><strong class="odds-value">0.99</strong></button></section>`);

    const value = await page.evaluate(buildGenericSelectionPriceExpression({ providerEventId: "opaque-event",
      providerMarketId: "opaque-market", providerSelectionId: "opaque-selection", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "4.5" })) as
      { ok: boolean; rawOdds?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.17" }));
    await page.close();
  });

  it("fails closed when two visible semantic selections satisfy the same ticket identity", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section><h3>Alpha vs Beta</h3>
      <button class="selection"><span>Under 4.5</span><strong class="odds-value">0.17</strong></button>
      <button class="selection"><span>Under 4.5</span><strong class="odds-value">0.19</strong></button></section>`);

    const value = await page.evaluate(buildGenericSelectionPriceExpression({ providerEventId: "opaque-event",
      providerMarketId: "opaque-market", providerSelectionId: "opaque-selection", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "4.5" })) as
      { ok: boolean; reason?: string };

    expect(value).toEqual({ ok: false, reason: "VISIBLE_PRICE_AMBIGUOUS" });
    await page.close();
  });

  it("reads the requested CMD legacy side instead of the line or opposing price", async () => {
    const page = await browser.newPage();
    await page.setContent(`<div class="match default-match" id="R_25224742"></div>
      <div class="match" id="R_25252758"><div class="Dbox_b5"><span>0/0.5</span>
        <i class="odds">-0.67</i><i class="odds">0.53</i></div></div>`);
    const marketId = "legacy:25252758:7:0/0.5";

    const value = await page.evaluate(buildCmdSelectionPriceExpression({ providerEventId: "25224742",
      providerMarketId: marketId, providerSelectionId: `${marketId}:away` })) as
      { ok: boolean; rawOdds?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.53" }));
    await page.close();
  });

  it("reads SABA's exact visible c-odds after removing only the event namespace", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="c-match" data-matchid="132625615">
      <i class="c-odds" data-moid="1052392272">1.00</i>
      <i class="c-odds" data-moid="1052392272">-0.88</i></section>`);
    const marketId = "132625615__1052392272";

    const value = await page.evaluate(buildCmdSelectionPriceExpression({ providerEventId: "132625615",
      providerMarketId: marketId, providerSelectionId: `${marketId}:home` })) as
      { ok: boolean; rawOdds?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "1.00" }));
    await page.close();
  });

  it("reads SABA's exact visible c-odds when the DOM retains the full namespaced market id", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="c-match" data-matchid="132735111">
      <i class="c-odds" data-moid="132735111__1050292846">-0.92</i>
      <i class="c-odds" data-moid="132735111__1050292846">0.76</i></section>`);
    const marketId = "132735111__1050292846";

    const value = await page.evaluate(buildCmdSelectionPriceExpression({ providerEventId: "132735111",
      providerMarketId: marketId, providerSelectionId: `${marketId}:home` })) as
      { ok: boolean; rawOdds?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "-0.92" }));
    await page.close();
  });

  it("fails closed when the rendered node does not contain one unambiguous price", async () => {
    const page = await browser.newPage();
    await page.setContent(`<div id="selection-1">Line 0.5 Price 0.91</div>`);

    const value = await page.evaluate(buildGenericSelectionPriceExpression({ providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME", line: "0.5" })) as
      { ok: boolean; reason?: string };

    expect(value).toEqual({ ok: false, reason: "VISIBLE_PRICE_AMBIGUOUS" });
    await page.close();
  });
});
