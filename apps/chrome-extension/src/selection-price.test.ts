import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBtiSelectionPriceExpression, buildCmdSelectionPriceExpression, buildGenericSelectionPriceExpression,
  buildImSelectionPriceExpression, buildSbobetCatalogRefreshExpression,
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
        value[2] = { VI: id.includes("OMM") ? "Over" : "Under" };
        value[5] = false;
        value[8] = [null, null, null, null, null, price];
        value[9] = id.includes("OMM") ? 1 : 3;
        value[13] = false;
        value[16] = 2.5;
        return value;
      };
      const market: unknown[] = [];
      market[0] = "0OU877857669225148454";
      market[1] = "Over Under";
      market[5] = ["OU0", "full time"];
      market[13] = [
        selection("wrong-selection", "0.91"),
        selection("0OU877857669225148454OMM", "-0.29")
      ];
      const event: unknown[] = [];
      event[0] = "877857668386287616";
      event[8] = [["home", { VI: "Polisi Tanzania" }], ["away", { VI: "JKT Tanzania" }]];
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

  it("reads BTI detail arrays wrapped in value/Count as returned by the live provider", async () => {
    const page = await browser.newPage();
    await page.route("https://bti-wrapped.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>BTI wrapped detail</p>" }));
    await page.route("https://bti-wrapped.example/api/eventpage/events/event-wrapped**", async (route) => {
      const home = Array<unknown>(20).fill(null);
      home[0] = "home-wrapped"; home[5] = false;
      home[8] = { value: [null, null, null, null, null, "0.81"], Count: 6 };
      home[9] = 1; home[13] = false; home[16] = -0.25;
      const away = [...home]; away[0] = "away-wrapped"; away[9] = 3; away[16] = 0.25;
      const market = Array<unknown>(24).fill(null);
      market[0] = "market-wrapped"; market[1] = "Asian Handicap";
      market[5] = { value: ["HC0", "Asian Handicap", 2, "Asian Handicap", "Full"], Count: 5 };
      market[13] = { value: [home, away], Count: 2 };
      const event = Array<unknown>(34).fill(null);
      event[0] = "event-wrapped";
      event[8] = { value: [
        { value: ["home", "Alpha", "Home"], Count: 3 },
        { value: ["away", "Beta", "Away"], Count: 3 }
      ], Count: 2 };
      event[20] = { value: [market], Count: 1 };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [event] }) });
    });
    await page.goto("https://bti-wrapped.example/");

    await expect(page.evaluate(buildBtiSelectionPriceExpression({
      providerEventId: "event-wrapped", providerMarketId: "market-wrapped:-0.25",
      providerSelectionId: "home-wrapped", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_AH", scope: "FULL_TIME",
      selection: "HOME", line: "-0.25"
    }))).resolves.toEqual(expect.objectContaining({ ok: true, rawOdds: "0.81" }));
    await page.close();
  });

  it("fails BTI detail checks closed when participants, line, outcome, or event identity differs", async () => {
    const page = await browser.newPage();
    await page.route("https://bti-identity.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>BTI identity probe</p>" }));
    const selection = Array<unknown>(20).fill(null);
    selection[0] = "under-selection"; selection[2] = { VI: "Under" }; selection[5] = false;
    selection[8] = [null, null, null, null, null, "0.17"]; selection[9] = 3;
    selection[13] = false; selection[16] = 2.5;
    const market = Array<unknown>(24).fill(null);
    market[0] = "total-market"; market[1] = "Over Under"; market[5] = ["OU0", "full time"];
    market[13] = [selection];
    const event = Array<unknown>(34).fill(null);
    event[0] = "event-1"; event[8] = [["h", { VI: "Alpha" }], ["a", { VI: "Beta" }]];
    event[20] = [market];
    let responseEvents: unknown[] = [event];
    await page.route("https://bti-identity.example/api/eventpage/events/event-1**", async (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: responseEvents }) }));
    await page.goto("https://bti-identity.example/");
    const base = { providerEventId: "event-1", providerMarketId: "total-market:2.5",
      providerSelectionId: "under-selection", eventLabel: "Alpha vs Beta", participantA: "Alpha",
      participantB: "Beta", marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "2.5" };
    const evaluate = (overrides: Partial<typeof base>) => page.evaluate(
      buildBtiSelectionPriceExpression({ ...base, ...overrides }));

    await expect(evaluate({ participantA: "Beta", participantB: "Alpha" })).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: "BTI_EVENT_NOT_FOUND" }));
    await expect(evaluate({ line: "3.5", providerMarketId: "total-market:3.5" })).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: "BTI_MARKET_NOT_FOUND" }));
    await expect(evaluate({ selection: "OVER" })).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: "BTI_SELECTION_NOT_FOUND" }));
    responseEvents = [event, [...event]];
    await expect(evaluate({})).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: "BTI_EVENT_AMBIGUOUS" }));
    await page.close();
  });

  it("reads each BTI two-way outcome and rejects duplicate exact markets or selections", async () => {
    const page = await browser.newPage();
    await page.route("https://bti-outcomes.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>BTI outcome probe</p>" }));
    const makeSelection = (id: string, name: string, side: 1 | 3, line: number, price: string) => {
      const value = Array<unknown>(20).fill(null);
      value[0] = id; value[2] = { VI: name }; value[5] = false;
      value[8] = [null, null, null, null, null, price]; value[9] = side;
      value[13] = false; value[16] = line; return value;
    };
    const makeMarket = (id: string, code: string, selections: unknown[]) => {
      const value = Array<unknown>(24).fill(null);
      value[0] = id; value[1] = code === "HC0" ? "Asian Handicap" : "Over Under";
      value[5] = [code, "full time"]; value[13] = selections; return value;
    };
    const ah = makeMarket("ah-market", "HC0", [
      makeSelection("home-selection", "Alpha", 1, -0.25, "0.81"),
      makeSelection("away-selection", "Beta", 3, 0.25, "-0.91")]);
    const total = makeMarket("total-market", "OU0", [
      makeSelection("over-selection", "Over", 1, 2.5, "0.82"),
      makeSelection("under-selection", "Under", 3, 2.5, "-0.92")]);
    const event = Array<unknown>(34).fill(null);
    event[0] = "event-2"; event[8] = [["h", { VI: "Alpha" }], ["a", { VI: "Beta" }]];
    event[20] = [ah, total];
    await page.route("https://bti-outcomes.example/api/eventpage/events/event-2**", async (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [event] }) }));
    await page.goto("https://bti-outcomes.example/");
    const base = { providerEventId: "event-2", eventLabel: "Alpha vs Beta", participantA: "Alpha",
      participantB: "Beta", scope: "FULL_TIME" };
    const cases = [
      { providerMarketId: "ah-market:-0.25", providerSelectionId: "home-selection",
        marketType: "FT_AH", selection: "HOME", line: "-0.25", rawOdds: "0.81" },
      { providerMarketId: "ah-market:-0.25", providerSelectionId: "away-selection",
        marketType: "FT_AH", selection: "AWAY", line: "-0.25", rawOdds: "-0.91" },
      { providerMarketId: "total-market:2.5", providerSelectionId: "over-selection",
        marketType: "FT_TOTAL", selection: "OVER", line: "2.5", rawOdds: "0.82" },
      { providerMarketId: "total-market:2.5", providerSelectionId: "under-selection",
        marketType: "FT_TOTAL", selection: "UNDER", line: "2.5", rawOdds: "-0.92" }
    ] as const;
    for (const expected of cases) {
      const { rawOdds, ...identity } = expected;
      await expect(page.evaluate(buildBtiSelectionPriceExpression({ ...base, ...identity }))).resolves.toEqual(
        expect.objectContaining({ ok: true, rawOdds }));
    }
    event[20] = [ah, [...ah]];
    await expect(page.evaluate(buildBtiSelectionPriceExpression({ ...base, ...cases[0] }))).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: "BTI_MARKET_AMBIGUOUS" }));
    const duplicateSelection = (ah[13] as unknown[])[0];
    event[20] = [makeMarket("ah-market", "HC0", [duplicateSelection, duplicateSelection])];
    await expect(page.evaluate(buildBtiSelectionPriceExpression({ ...base, ...cases[0] }))).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: "BTI_SELECTION_AMBIGUOUS" }));
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
        "8": "wrong-event", "2": "Other Home", "3": "Other Away",
        "7": { "3": ["0.75 0.99*56434230030000075h 0.95*56434230030000075a 7307800681810075"] }
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
        "2": "Alpha", "3": "Beta",
        "7": { "3": ["2.5 0.17*selection-h 0.95*selection-a market-1"] } } })
    }));
    await page.goto("https://sbobet.example/");

    const value = await page.evaluate(buildSbobetSelectionPriceExpression({ providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-h", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5"
    })) as { ok: boolean; rawOdds?: string; reason?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.17" }));
    await page.close();
  });

  it("reads SBOBET's currently displayed exact DOM selection without calling the catalog endpoint", async () => {
    const page = await browser.newPage();
    let directRequests = 0;
    await page.route("https://sbobet.example/api/v2/getEvent", async (route) => {
      directRequests += 1;
      await route.fulfill({ status: 500, body: "must not be called" });
    });
    await page.setContent(`<section class="wrapper-match-component" id="wrapper-match-component-5643423">
      <span class="row-team-name">Coquimbo Unido</span><span class="row-team-name">CA Platense</span>
      <div class="match-item"><div class="promotion-market" data-market-id="7307800681610075">
        <div class="odd-row"><span class="rate-asian">0.25</span>
          <button class="odd-item" id="odd-item-56434230050000025h"><span class="odd-val">-0.41</span></button></div>
        <div class="odd-row"><span class="rate-asian"></span>
          <button class="odd-item" id="odd-item-56434230050000025a"><span class="odd-val">-0.67</span></button></div>
      </div></div></section>`);

    const value = await page.evaluate(buildSbobetSelectionPriceExpression({ providerEventId: "5643423",
      providerMarketId: "7307800681610075", providerSelectionId: "56434230050000025h",
      eventLabel: "Coquimbo Unido vs CA Platense", participantA: "Coquimbo Unido",
      participantB: "CA Platense", marketType: "FT_AH", scope: "FULL_TIME",
      selection: "HOME", line: "-0.25" })) as { ok: boolean; rawOdds?: string; method?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "-0.41", method: "DOM" }));
    expect(directRequests).toBe(0);
    await page.close();
  });

  it("does not accept an SBOBET DOM price when the exact provider market ID is not proven", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="wrapper-match-component" id="wrapper-match-component-event-1">
      <span class="row-team-name">Alpha</span><span class="row-team-name">Beta</span>
      <div class="promotion-market"><div class="odd-row"><span class="rate-asian">2.5</span>
        <button class="odd-item" id="odd-item-selection-h"><span class="odd-val">0.17</span></button></div>
        <div class="odd-row"><span class="rate-asian">u</span>
        <button class="odd-item" id="odd-item-selection-a"><span class="odd-val">0.95</span></button></div></div>
      </section>`);

    const value = await page.evaluate(buildSbobetSelectionPriceExpression({ providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-h", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL", scope: "FULL_TIME",
      selection: "OVER", line: "2.5" }, null, "DOM_ONLY")) as { ok: boolean; reason?: string };

    expect(value).toEqual({ ok: false, reason: "SBOBET_SELECTION_NOT_FOUND" });
    await page.close();
  });

  it("fails closed when SBOBET has duplicate visible exact DOM selections", async () => {
    const page = await browser.newPage();
    await page.setContent(["event-a", "event-b"].map((eventId) =>
      `<section class="wrapper-match-component" id="wrapper-match-component-${eventId}">
        <span class="row-team-name">Alpha</span><span class="row-team-name">Beta</span>
        <div class="match-item"><div class="promotion-market">
          <div class="odd-row"><span class="rate-asian">2.5</span>
            <button class="odd-item" id="odd-item-selection-h"><span class="odd-val">0.17</span></button></div>
          <div class="odd-row"><span class="rate-asian">u</span>
            <button class="odd-item" id="odd-item-selection-a"><span class="odd-val">0.95</span></button></div>
        </div></div></section>`).join(""));

    const value = await page.evaluate(buildSbobetSelectionPriceExpression({ providerEventId: "event-a",
      providerMarketId: "market-1", providerSelectionId: "selection-h", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL", scope: "FULL_TIME",
      selection: "OVER", line: "2.5" })) as { ok: boolean; reason?: string };

    expect(value).toEqual({ ok: false, reason: "SBOBET_SELECTION_AMBIGUOUS" });
    await page.close();
  });

  it("fails closed when the direct SBOBET response contains duplicate exact candidates", async () => {
    const page = await browser.newPage();
    await page.route("https://sbobet.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>sportsbook</p>" }));
    const event = { "8": "5643423", "2": "Alpha", "3": "Beta",
      "7": { "3": ["2.5 0.17*selection-h 0.95*selection-a market-1"] } };
    await page.route("https://sbobet.example/api/v2/getEvent", async (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ payload: [event, event] })
    }));
    await page.goto("https://sbobet.example/");

    const value = await page.evaluate(buildSbobetSelectionPriceExpression({ providerEventId: "5643423",
      providerMarketId: "market-1", providerSelectionId: "selection-h", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL", scope: "FULL_TIME",
      selection: "OVER", line: "2.5" })) as { ok: boolean; reason?: string };

    expect(value).toEqual({ ok: false, reason: "SBOBET_SELECTION_AMBIGUOUS" });
    await page.close();
  });

  it("fails closed when exact IDs belong to the wrong participants or market scope", async () => {
    const page = await browser.newPage();
    await page.route("https://sbobet.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>sportsbook</p>" }));
    await page.route("https://sbobet.example/api/v2/getEvent", async (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ payload: [{ "8": "5643423",
        "2": "Wrong Home", "3": "Wrong Away",
        "7": { "4": ["2.5 0.17*selection-h 0.95*selection-a market-1"] } }] })
    }));
    await page.goto("https://sbobet.example/");

    const value = await page.evaluate(buildSbobetSelectionPriceExpression({ providerEventId: "5643423",
      providerMarketId: "market-1", providerSelectionId: "selection-h", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL", scope: "FULL_TIME",
      selection: "OVER", line: "2.5" })) as { ok: boolean; reason?: string };

    expect(value).toEqual({ ok: false, reason: "SBOBET_SELECTION_NOT_FOUND" });
    await page.close();
  });

  it("does not borrow an SBOBET price from another event with the same market line", async () => {
    const page = await browser.newPage();
    await page.route("https://sbobet.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>sportsbook</p>" }));
    await page.route("https://sbobet.example/api/v2/getEvent", async (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ payload: [{ "8": "other-event",
        "2": "Alpha", "3": "Beta",
        "7": { "3": ["2.5 8.88*selection-h 0.95*selection-a market-1"] }
      }, { "8": "event-1", "2": "Alpha", "3": "Beta",
        "7": { "3": ["2.5 0.17*selection-h 0.95*selection-a market-1"] }
      }] })
    }));
    await page.goto("https://sbobet.example/");

    const value = await page.evaluate(buildSbobetSelectionPriceExpression({ providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-h", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL", scope: "FULL_TIME",
      selection: "OVER", line: "2.5" })) as { ok: boolean; rawOdds?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.17" }));
    await page.close();
  });

  it("reads the exact home handicap with the same sign convention as the normalized ticket", async () => {
    const page = await browser.newPage();
    await page.route("https://sbobet.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>sportsbook</p>" }));
    await page.route("https://sbobet.example/api/v2/getEvent", async (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ payload: [{ "8": "5643423",
        "2": "Coquimbo Unido", "3": "CA Platense", "7": {
          "5": ["0.25 -0.41*56434230050000025h -0.67*56434230050000025a h 7307800681610075"]
        } }] })
    }));
    await page.goto("https://sbobet.example/");

    const value = await page.evaluate(buildSbobetSelectionPriceExpression({ providerEventId: "5643423",
      providerMarketId: "7307800681610075", providerSelectionId: "56434230050000025h",
      eventLabel: "Coquimbo Unido vs CA Platense", participantA: "Coquimbo Unido",
      participantB: "CA Platense", marketType: "FT_AH", scope: "FULL_TIME",
      selection: "HOME", line: "-0.25" })) as { ok: boolean; rawOdds?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "-0.41" }));
    const reversed = await page.evaluate(buildSbobetSelectionPriceExpression({ providerEventId: "5643423",
      providerMarketId: "7307800681610075", providerSelectionId: "56434230050000025h",
      eventLabel: "CA Platense vs Coquimbo Unido", participantA: "CA Platense",
      participantB: "Coquimbo Unido", marketType: "FT_AH", scope: "FULL_TIME",
      selection: "HOME", line: "0.25" })) as { ok: boolean; reason?: string };
    expect(reversed).toEqual({ ok: false, reason: "SBOBET_SELECTION_NOT_FOUND" });
    await page.close();
  });

  it("refreshes SBOBET's same-origin catalog when Chrome evicted its resource timing entry", async () => {
    const page = await browser.newPage();
    let requests = 0;
    await page.route("https://sbobet.example/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<p>The initial resource timing buffer is empty</p>" }));
    await page.route("https://sbobet.example/api/v2/getEvent", async (route) => {
      requests += 1;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ payload: [] }) });
    });
    await page.goto("https://sbobet.example/");

    const value = await page.evaluate(buildSbobetCatalogRefreshExpression(null)) as {
      ok: boolean; status?: number; reason?: string
    };

    expect(value).toEqual(expect.objectContaining({ ok: true, status: 200 }));
    expect(requests).toBe(1);
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

  it("reads CMD's price from the book's own catalog when the page never drew the row", async () => {
    const page = await browser.newPage();
    // Nothing rendered: exactly the case that reported VISIBLE_PRICE_NOT_FOUND
    // while the book was still offering the price.
    const row = Array<unknown>(91).fill(null);
    row[0] = 25310330;
    row[10] = -0.5;
    row[40] = 0.92;
    row[41] = -0.98;
    await page.route("**/Member/BetsView/BetLight/DataOdds.ashx*", async (route) => {
      await route.fulfill({ contentType: "application/json",
        body: JSON.stringify({ t: 1, a: true, data: [], today: [row], f: [] }) });
    });
    // A relative request needs a real origin to resolve against, and the empty
    // page is the point: nothing rendered for the DOM reader to find.
    await page.route("https://cgnew.fts368.com/", async (route) => {
      await route.fulfill({ contentType: "text/html", body: "<div></div>" });
    });
    await page.goto("https://cgnew.fts368.com/");

    const marketId = "25310330:1";
    const value = await page.evaluate(buildCmdSelectionPriceExpression({ providerEventId: "25310330",
      providerMarketId: marketId, providerSelectionId: `${marketId}:away`,
      eventLabel: "A vs B", participantA: "A", participantB: "B", marketType: "FT_AH",
      scope: "FULL_TIME", selection: "AWAY", line: "-0.5" }, "FETCH_ONLY")) as
      { ok: boolean; rawOdds?: string; method?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "-0.98", method: "IN_PAGE_FETCH" }));
    await page.close();
  });

  it("says CMD is not offering a market rather than reporting a sentinel as a price", async () => {
    const page = await browser.newPage();
    const row = Array<unknown>(91).fill(null);
    row[0] = 25310330;
    // -999 is CMD's code for a market it has withdrawn, not a price.
    row[42] = -999;
    row[43] = -999;
    await page.route("**/Member/BetsView/BetLight/DataOdds.ashx*", async (route) => {
      await route.fulfill({ contentType: "application/json",
        body: JSON.stringify({ t: 1, a: true, data: [row], today: [], f: [] }) });
    });
    await page.route("https://cgnew.fts368.com/", async (route) => {
      await route.fulfill({ contentType: "text/html", body: "<div></div>" });
    });
    await page.goto("https://cgnew.fts368.com/");

    const marketId = "25310330:3";
    const value = await page.evaluate(buildCmdSelectionPriceExpression({ providerEventId: "25310330",
      providerMarketId: marketId, providerSelectionId: `${marketId}:over`,
      eventLabel: "A vs B", participantA: "A", participantB: "B", marketType: "FT_TOTAL",
      scope: "FULL_TIME", selection: "OVER", line: "2.5" }, "FETCH_ONLY")) as
      { ok: boolean; reason?: string };

    expect(value).toEqual(expect.objectContaining({ ok: false, reason: "CMD_SELECTION_NOT_ON_OFFER" }));
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
