import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCmdSelectionPriceExpression } from "./selection-price.js";

describe("CMD direct selection-price regressions", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("does not mix a full-time market with first-half at the same line", async () => {
    const page = await browser.newPage();
    await page.setContent(`<div class="match default-match" id="R_900"></div>
      <div class="match" id="R_901"><div class="Dbox_b2"><span>0/0.5</span>
        <i class="odds">0.91</i><i class="odds">-0.99</i></div>
        <div class="Dbox_b5"><span>0/0.5</span>
        <i class="odds">0.41</i><i class="odds">-0.49</i></div></div>`);
    const fullTimeMarket = "legacy:901:1:0/0.5";
    const value = await page.evaluate(buildCmdSelectionPriceExpression({ providerEventId: "900",
      providerMarketId: fullTimeMarket, providerSelectionId: `${fullTimeMarket}:home` })) as
      { ok: boolean; rawOdds?: string };
    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.91" }));
    await page.close();
  });

  it("maps an authenticated HTTP market identity to the visible legacy CMD row", async () => {
    const page = await browser.newPage();
    await page.setContent(`<div class="match default-match" id="R_25224742"></div>
      <div class="match" id="R_25252758"><div class="Dbox_b5"><span>0/0.5</span>
        <i class="odds">-0.67</i><i class="odds">0.84</i></div></div>`);
    const marketId = "25224742:7";

    const value = await page.evaluate(buildCmdSelectionPriceExpression({ providerEventId: "25224742",
      providerMarketId: marketId, providerSelectionId: `${marketId}:away`, eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FH_AH", scope: "FIRST_HALF",
      selection: "AWAY", line: "-0.25" })) as { ok: boolean; rawOdds?: string };

    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "0.84" }));
    await page.close();
  });

  it("does not read the same market and line from a different event", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="c-match" data-matchid="event-a">
      <i class="c-odds" data-moid="market-25">0.91</i><i class="c-odds" data-moid="market-25">-0.99</i></section>
      <section class="c-match" data-matchid="event-b">
      <i class="c-odds" data-moid="market-25">0.31</i><i class="c-odds" data-moid="market-25">-0.39</i></section>`);
    const value = await page.evaluate(buildCmdSelectionPriceExpression({ providerEventId: "event-b",
      providerMarketId: "market-25", providerSelectionId: "market-25:away" })) as
      { ok: boolean; rawOdds?: string };
    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "-0.39" }));
    await page.close();
  });

  it("fails closed when the exact selection is not present", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="c-match" data-matchid="event-a">
      <i class="c-odds" data-moid="other-market">0.91</i><i class="c-odds" data-moid="other-market">-0.99</i>
      </section>`);
    const value = await page.evaluate(buildCmdSelectionPriceExpression({ providerEventId: "event-a",
      providerMarketId: "market-25", providerSelectionId: "market-25:home" })) as
      { ok: boolean; reason?: string };
    expect(value).toEqual({ ok: false, reason: "EXACT_SELECTION_NOT_FOUND" });
    await page.close();
  });
});
