import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTsportSelectionPriceExpression } from "./tsport-selection-price.js";

const identity = {
  providerEventId: "778899", providerMarketId: "778899:FT_AH:-0.5:0",
  providerSelectionId: "home-current", eventLabel: "Ha Noi vs Nam Dinh",
  participantA: "Ha Noi", participantB: "Nam Dinh", marketType: "FT_AH",
  scope: "FULL_TIME", selection: "HOME", line: "-0.5"
} as const;

const event = (input: { id?: string; home?: string; away?: string; marketLabel?: string;
  line?: string; selectionId?: string; price?: string; hidden?: boolean } = {}) => `<section class="match"
  data-event-id="${input.id ?? "778899"}" ${input.hidden ? "style=\"display:none\"" : ""}>
  <div class="match-favorite" id="eventId-live-1-${input.id ?? "778899"}"></div>
  <span class="match__team-name">${input.home ?? "Ha Noi"}</span>
  <span class="match__team-name">${input.away ?? "Nam Dinh"}</span>
  <div class="match-odd-pair-list"><div class="match__odd-pair-list__type">${input.marketLabel ?? "Asian Handicap"}</div>
    <button class="match__odd-pair" id="odd-item-${input.selectionId ?? "home-current"}">
      <span class="match__odd-type">${input.line ?? "-0.5"}</span>
      <b class="match__odd-value">${input.price ?? "0.91"}</b></button>
    <button class="match__odd-pair" id="odd-item-away-current">
      <span class="match__odd-type">+0.5</span><b class="match__odd-value">-0.99</b></button>
  </div></section>`;

describe("TSPORT exact visible selection price", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("ignores a hidden duplicate and reads the sole visible exact selection", async () => {
    const page = await browser.newPage();
    await page.setContent(event({ hidden: true, price: "0.12" }) + event());
    await expect(page.evaluate(buildTsportSelectionPriceExpression(identity)))
      .resolves.toEqual(expect.objectContaining({ ok: true, rawOdds: "0.91" }));
    await page.close();
  });

  it.each([
    ["similar event name", event({ id: "778898", home: "Ha Noi City", away: "Nam Dinh Youth" }),
      "TSPORT_EVENT_NOT_FOUND"],
    ["same line in another market", event({ marketLabel: "First Half Asian Handicap" }),
      "TSPORT_MARKET_NOT_FOUND"],
    ["obsolete selection ID", event({ selectionId: "home-old" }), "TSPORT_SELECTION_NOT_RENDERED"],
    ["reversed participants", event({ home: "Nam Dinh", away: "Ha Noi" }), "TSPORT_PARTICIPANTS_NOT_FOUND"]
  ])("fails closed for %s", async (_label, html, reason) => {
    const page = await browser.newPage();
    await page.setContent(html);
    await expect(page.evaluate(buildTsportSelectionPriceExpression(identity)))
      .resolves.toEqual({ ok: false, reason });
    await page.close();
  });

  it("does not accept a sole hidden exact node as the current visible price", async () => {
    const page = await browser.newPage();
    await page.setContent(event({ hidden: true }));
    await expect(page.evaluate(buildTsportSelectionPriceExpression(identity)))
      .resolves.toEqual({ ok: false, reason: "TSPORT_SELECTION_HIDDEN" });
    await page.close();
  });

  it("fails closed when two visible exact nodes are ambiguous", async () => {
    const page = await browser.newPage();
    await page.setContent(event() + event({ price: "0.92" }));
    await expect(page.evaluate(buildTsportSelectionPriceExpression(identity)))
      .resolves.toEqual({ ok: false, reason: "TSPORT_SELECTION_AMBIGUOUS" });
    await page.close();
  });

  it("fails closed when the exact selection is not rendered", async () => {
    const page = await browser.newPage();
    await page.setContent(event({ selectionId: "other" }));
    await expect(page.evaluate(buildTsportSelectionPriceExpression(identity)))
      .resolves.toEqual({ ok: false, reason: "TSPORT_SELECTION_NOT_RENDERED" });
    await page.close();
  });

  it("uses a fresh same-tab response with the complete exact identity when the DOM is virtualized", async () => {
    const page = await browser.newPage();
    let requests = 0;
    await page.route("https://tsport.example/", async (route) => route.fulfill({
      contentType: "text/html", body: "<main>virtualized event list</main>"
    }));
    await page.route("https://tsport.example/event/778899", async (route) => {
      requests += 1;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        eventId: "778899", marketId: "778899:FT_AH:-0.5:0", marketType: "FT_AH",
        scope: "FULL_TIME", line: "-0.5", selections: [{ selectionId: "home-current",
          selection: "HOME", priceText: "0.93" }]
      }) });
    });
    await page.goto("https://tsport.example/", { waitUntil: "domcontentloaded" });
    await expect(page.evaluate(buildTsportSelectionPriceExpression(identity,
      ["https://tsport.example/event/778899"])))
      .resolves.toEqual(expect.objectContaining({ ok: true, rawOdds: "0.93", method: "IN_PAGE_FETCH" }));
    expect(requests).toBe(1);
    await page.close();
  });

  it("fails closed within the probe deadline when the provider request stalls", async () => {
    const page = await browser.newPage();
    await page.route("https://tsport.example/", async (route) => route.fulfill({
      contentType: "text/html", body: "<main>virtualized event list</main>"
    }));
    await page.route("https://tsport.example/event/778899", async () => new Promise(() => undefined));
    await page.goto("https://tsport.example/", { waitUntil: "domcontentloaded" });
    const startedAt = Date.now();

    await expect(page.evaluate(buildTsportSelectionPriceExpression(identity,
      ["https://tsport.example/event/778899"])))
      .resolves.toEqual({ ok: false, reason: "TSPORT_SELECTION_NOT_FOUND" });
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    await page.close();
  });
});
