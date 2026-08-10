import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { extractSbobetRecords } from "./sbobet-browser-manager.js";

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
            <div class="un-promotion">
              <div class="odd-item" id="odd-item-5388803h"><span>0.5</span><span class="odd-val">0.79</span></div>
              <div class="odd-item" id="odd-item-5388803a"><span class="odd-val">-0.87</span></div>
            </div>
            <div class="un-promotion"></div><div class="un-promotion"></div>
          </div>
        </div>
      </section>`);

    const result = await extractSbobetRecords(page);
    expect(result[0]?.markets[0]).toEqual(expect.objectContaining({ marketType: "FT_AH" }));
    expect(result[0]?.markets[0]?.selections).toEqual([
      expect.objectContaining({ selection: "HOME", priceText: "0.79", lineText: "0.5" }),
      expect.objectContaining({ selection: "AWAY", priceText: "-0.87", lineText: null })
    ]);
    await page.close();
  });
});
