import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { extractSbobetRecords, isSbobetCatalogReady } from "./sbobet-browser-manager.js";

describe("extractSbobetRecords", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("reads the full-time handicap column with per-team line evidence", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <section class="league-component"><span class="league-name">Allsvenskan</span>
        <div class="wrapper-match-component" id="wrapper-match-component-5388803">
          <span class="row-team-name">IK Sirius</span><span class="row-team-name">Brommapojkarna</span>
          <span class="game-time">1H 41'</span><span class="game-score">2 - 2</span>
          <div class="match-item">
            <div class="promotion-market">
              <div class="odd-row"><span class="rate-asian">0.5</span><div class="odd-item" id="odd-item-5388803005000050h"><span class="odd-val">0.79</span></div></div>
              <div class="odd-row"><span class="rate-asian"></span><div class="odd-item" id="odd-item-5388803005000050a"><span class="odd-val">-0.87</span></div></div>
            </div>
            <div class="promotion-market">
              <div class="odd-row"><span class="rate-asian">2.5</span><div class="odd-item" id="odd-item-total-h"><span class="odd-val">0.80</span></div></div>
              <div class="odd-row"><span class="rate-asian">u</span><div class="odd-item" id="odd-item-total-a"><span class="odd-val">-0.90</span></div></div>
            </div>
            <div class="un-promotion"><div class="odd-item" id="odd-item-result-h"><span class="odd-val">2.1</span></div>
              <div class="odd-item" id="odd-item-result-d"><span class="odd-val">3.2</span></div>
              <div class="odd-item" id="odd-item-result-a"><span class="odd-val">3.4</span></div></div>
            <div class="un-promotion">
              <div class="odd-row"><span class="rate-asian">0.5</span><div class="odd-item" id="odd-item-alt-h"><span class="odd-val">0.20</span></div></div>
              <div class="odd-row"><span class="rate-asian"></span><div class="odd-item" id="odd-item-alt-a"><span class="odd-val">-0.30</span></div></div>
            </div>
          </div>
        </div>
      </section>`);

    const result = await extractSbobetRecords(page);
    expect(result[0]?.markets[0]).toEqual(expect.objectContaining({ marketType: "FT_AH" }));
    expect(result[0]?.markets[0]?.selections).toEqual([
      expect.objectContaining({ selection: "HOME", priceText: "0.79", lineText: "0.5" }),
      expect.objectContaining({ selection: "AWAY", priceText: "-0.87", lineText: null })
    ]);
    expect(result[0]?.markets.map((market) => [market.marketType, market.lineText])).toEqual([
      ["FT_AH", "0.5"], ["FT_TOTAL", "2.5"], ["FT_1X2", null]
    ]);
    await page.close();
  });

  it("does not accept the cold-start shell before teams and prices are rendered", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="league-component"><span class="league-name">Allsvenskan</span>
      <div class="wrapper-match-component" id="wrapper-match-component-5388803"></div></section>`);
    expect(await isSbobetCatalogReady(page)).toBe(false);
    await page.locator(".wrapper-match-component").evaluate((node) => {
      node.innerHTML = `<span class="row-team-name">IK Sirius</span><span class="row-team-name">Brommapojkarna</span>
        <div class="odd-item"><span class="odd-val">0.79</span></div>`;
    });
    expect(await isSbobetCatalogReady(page)).toBe(true);
    await page.close();
  });
});
