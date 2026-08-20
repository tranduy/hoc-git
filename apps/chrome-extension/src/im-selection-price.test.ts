import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildImExactSelectionPriceExpression } from "./im-selection-price.js";

const identity = {
  providerEventId: "112738921", providerMarketId: "2503913473", providerSelectionId: "32394906714",
  eventLabel: "KaPa vs JIPPO", participantA: "KaPa", participantB: "JIPPO",
  marketType: "FT_AH", scope: "FULL_TIME", selection: "AWAY", line: "0.75"
} as const;

const response = (overrides: Record<string, unknown> = {}) => ({ StatusCode: 100, sel: [{
  eid: 112738921, htn: "KaPa", atn: "JIPPO", mls: [{ mi: 2503913473, bti: 1, gp: 1, ws: [
    { wsi: 32394906713, si: 1, hdp: -0.75, dih: "+0.5/1", o: 0.98 },
    { wsi: 32394906714, si: 2, hdp: -0.75, dih: "-0.5/1", o: 0.91, ...overrides }
  ] }]
}] });

describe("IM exact current selection price", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  const openPage = async () => {
    const page = await browser.newPage();
    await page.route("https://imsports.directsb.net/", async (route) => route.fulfill({ contentType: "text/html",
      body: "<main></main>" }));
    await page.goto("https://imsports.directsb.net/", { waitUntil: "domcontentloaded" });
    return page;
  };

  it("ignores an exact hidden node and reads the fresh exact GetSE selection", async () => {
    const page = await openPage();
    await page.setContent(`<button style="display:none" data-event-id="112738921"
      data-market-id="2503913473" data-selection-id="32394906714">0.12</button>`);
    await page.evaluate(() => {
      sessionStorage.setItem("token", "session-token");
      window.addEventListener("helo", ((event: CustomEvent) => {
        window.dispatchEvent(new CustomEvent(`halo_${event.detail.c}`, { detail: "signed" }));
      }) as EventListener);
    });
    await page.route("**/api/EventV6/GetSE", async (route) => route.fulfill({ contentType: "application/json",
      body: JSON.stringify(response()) }));

    await expect(page.evaluate(buildImExactSelectionPriceExpression(identity))).resolves.toEqual(
      expect.objectContaining({ ok: true, rawOdds: "0.91", method: "IN_PAGE_FETCH" }));
    await page.close();
  });

  it("never clicks or requests navigation when the selection is absent", async () => {
    const page = await openPage();
    await page.setContent(`<button id="event-row">KaPa vs JIPPO</button>`);
    const clicked = vi.fn();
    await page.exposeFunction("recordClick", clicked);
    await page.evaluate(() => document.querySelector("#event-row")?.addEventListener("click", () => {
      void (window as unknown as { recordClick(): Promise<void> }).recordClick();
    }));

    await expect(page.evaluate(buildImExactSelectionPriceExpression(identity))).resolves.toEqual({
      ok: false, reason: "IM_DIRECT_TOKEN_UNAVAILABLE"
    });
    expect(clicked).not.toHaveBeenCalled();
    await page.close();
  });

  it.each([
    ["wrong line", { hdp: -0.5, dih: "-0.5" }, "IM_DIRECT_SELECTION_NOT_FOUND"],
    ["wrong scope", {}, "IM_DIRECT_SELECTION_NOT_FOUND", { ...identity, marketType: "FH_AH", scope: "FIRST_HALF" }],
    ["wrong outcome", {}, "IM_DIRECT_SELECTION_NOT_FOUND", { ...identity, selection: "HOME" }]
  ])("fails closed for exact identity with %s", async (_label, overrides, reason, requested = identity) => {
    const page = await openPage();
    await page.setContent("<main></main>");
    await page.evaluate(() => {
      sessionStorage.setItem("token", "session-token");
      window.addEventListener("helo", ((event: CustomEvent) => {
        window.dispatchEvent(new CustomEvent(`halo_${event.detail.c}`, { detail: "signed" }));
      }) as EventListener);
    });
    await page.route("**/api/EventV6/GetSE", async (route) => route.fulfill({ contentType: "application/json",
      body: JSON.stringify(response(overrides)) }));

    await expect(page.evaluate(buildImExactSelectionPriceExpression(requested))).resolves.toEqual({ ok: false, reason });
    await page.close();
  });
});
