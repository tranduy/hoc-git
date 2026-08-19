import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";

describe("CMD public catalog DOM snapshot", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("extracts full-time and first-half two-way markets from the legacy CMD row", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="league" id="lg_101">ASEAN Championship</div>
      <div class="match default-match" id="R_25250586">
        <div class="tableDiv-match-time">LIVE</div>
        <div class="team"><div class="tableDiv-match-info__event">
          <span>Vietnam</span><span>Malaysia</span>
        </div></div>
        <div class="Dbox_b2"><span>1</span><i class="odds">0.90</i><i class="odds">-0.95</i></div>
        <div class="Dbox_b3"><span>2.5</span><span>ou</span><i class="odds">0.91</i><i class="odds">-0.96</i></div>
        <div class="Dbox_b4"><i class="odds">2.1</i><i class="odds">3.2</i><i class="odds">3.4</i></div>
        <div class="Dbox_b5" style="display:none"><span>0.5</span><i class="odds">0.88</i><i class="odds">-0.93</i></div>
        <div class="Dbox_b3" style="display:none"><span>1</span><span>ou</span><i class="odds">0.89</i><i class="odds">-0.94</i></div>
        <div class="Dbox_b4"><i class="odds">2.2</i><i class="odds">2.8</i><i class="odds">3.1</i></div>
      </div>
    `);

    const serialized = await page.evaluate(CMD_PUBLIC_CATALOG_EXPRESSION) as string;
    const records = JSON.parse(serialized) as Array<{ groups: Array<{
      betTypeIds: string[]; labels: string[]; odds: Array<{ lineText?: string }> }> }>;

    expect(records).toHaveLength(1);
    expect(records[0]?.groups.map((group) => group.betTypeIds)).toEqual([["1"], ["3"], ["7"], ["8"]]);
    expect(records[0]?.groups.map((group) => group.odds.length)).toEqual([2, 2, 2, 2]);
    expect(records[0]?.groups[2]?.odds[0]?.lineText).toBe("0.5");
    await page.close();
  });

  it("does not relabel a lone first-half total as full-time", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="league" id="lg_101">ASEAN Championship</div>
      <div class="match default-match" id="R_25250587">
        <div class="tableDiv-match-time">LIVE</div>
        <div class="team"><div class="tableDiv-match-info__event">
          <span>Thailand</span><span>Indonesia</span>
        </div></div>
        <div class="Dbox_b5"><span>0.5</span><i class="odds">0.88</i><i class="odds">-0.93</i></div>
        <div class="Dbox_b3"><span>1</span><span>ou</span><i class="odds">0.89</i><i class="odds">-0.94</i></div>
      </div>
    `);

    const serialized = await page.evaluate(CMD_PUBLIC_CATALOG_EXPRESSION) as string;
    const records = JSON.parse(serialized) as Array<{ groups: Array<{ betTypeIds: string[] }> }>;

    expect(records[0]?.groups.map((group) => group.betTypeIds)).toEqual([["7"], ["8"]]);
    await page.close();
  });
});
