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
      <style>
        .match { position: relative; height: 60px; }
        .team { position: absolute; left: 0; top: 0; }
        .tableDiv-match-info__event { position: relative; width: 90px; height: 50px; }
        .tableDiv-match-info__event span { position: absolute; left: 0; }
        .tableDiv-match-info__event span:first-child { top: 2px; }
        .tableDiv-match-info__event span:last-child { top: 28px; }
        .Dbox_b2, .Dbox_b3, .Dbox_b5 { position: relative; display: block; height: 50px; }
        .match > .Dbox_b2, .match > .Dbox_b3, .match > .Dbox_b5 { position: absolute; left: 120px; top: 0; }
        .Dbox_b2 .odds, .Dbox_b3 .odds, .Dbox_b5 .odds { position: absolute; left: 100px; }
        .Dbox_b2 .odds:first-of-type, .Dbox_b3 .odds:first-of-type, .Dbox_b5 .odds:first-of-type { top: 2px; }
        .Dbox_b2 .odds:last-of-type, .Dbox_b3 .odds:last-of-type, .Dbox_b5 .odds:last-of-type { top: 28px; }
      </style>
      <div class="league" id="lg_101">ASEAN Championship</div>
      <div class="match default-match" id="R_25250586">
        <div class="tableDiv-match-time">LIVE</div>
        <div class="team"><div class="tableDiv-match-info__event">
          <span>Vietnam</span><span>Malaysia</span>
        </div></div>
        <div class="Dbox_b2"><span>1</span><i class="odds">0.90</i><i class="odds">-0.95</i></div>
        <div class="Dbox_b3"><span>2.5</span><span>ou</span><i class="odds">0.91</i><i class="odds">-0.96</i></div>
        <div class="Dbox_b4"><i class="odds">2.1</i><i class="odds">3.2</i><i class="odds">3.4</i></div>
        <div class="Dbox_b5"><span>0.5</span><i class="odds">0.88</i><i class="odds">-0.93</i></div>
        <div class="Dbox_b3"><span>1</span><span>ou</span><i class="odds">0.89</i><i class="odds">-0.94</i></div>
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
      <style>
        .match { position: relative; height: 60px; }
        .team { position: absolute; left: 0; top: 0; }
        .tableDiv-match-info__event { position: relative; width: 90px; height: 50px; }
        .tableDiv-match-info__event span { position: absolute; left: 0; }
        .tableDiv-match-info__event span:first-child { top: 2px; }
        .tableDiv-match-info__event span:last-child { top: 28px; }
        .Dbox_b3, .Dbox_b5 { position: relative; display: block; height: 50px; }
        .match > .Dbox_b3, .match > .Dbox_b5 { position: absolute; left: 120px; top: 0; }
        .Dbox_b3 .odds, .Dbox_b5 .odds { position: absolute; left: 100px; }
        .Dbox_b3 .odds:first-of-type, .Dbox_b5 .odds:first-of-type { top: 2px; }
        .Dbox_b3 .odds:last-of-type, .Dbox_b5 .odds:last-of-type { top: 28px; }
      </style>
      <div class="league" id="lg_101">ASEAN Championship</div>
      <div class="match default-match" id="R_25250587">
        <div class="tableDiv-match-time">LIVE</div>
        <div class="team"><div class="tableDiv-match-info__event">
          <span>Thailand</span><span>Indonesia</span>
        </div></div>
        <div class="Dbox_b5"><span>0.5</span><i class="odds">0.88</i><i class="odds">-0.93</i></div>
        <div class="Dbox_b3"><span>1</span><span>ou</span><i class="odds">0.89</i><i class="odds">-0.94</i></div>
        <div class="Dbox_b4"><i class="odds">1.70</i><i class="odds">3.20</i><i class="odds">4.80</i></div>
      </div>
    `);

    const serialized = await page.evaluate(CMD_PUBLIC_CATALOG_EXPRESSION) as string;
    const records = JSON.parse(serialized) as Array<{ groups: Array<{ betTypeIds: string[] }> }>;

    expect(records[0]?.groups.map((group) => group.betTypeIds)).toEqual([["7"], ["8"]]);
    await page.close();
  });

  it("orders legacy handicap prices by their rendered team rows instead of reversed DOM order", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <style>
        .match { position: relative; width: 400px; height: 80px; }
        .team { position: absolute; left: 0; top: 0; }
        .tableDiv-match-info__event { position: relative; width: 90px; height: 80px; }
        .tableDiv-match-info__event span { position: absolute; left: 0; }
        .tableDiv-match-info__event span:first-child { top: 8px; }
        .tableDiv-match-info__event span:last-child { top: 48px; }
        .Dbox_b2 { position: absolute; left: 120px; top: 0; width: 180px; height: 80px; }
        .Dbox_b2 .line { position: absolute; left: 10px; top: 48px; }
        .Dbox_b2 .home { position: absolute; left: 100px; top: 8px; }
        .Dbox_b2 .away { position: absolute; left: 100px; top: 48px; }
      </style>
      <div class="league" id="lg_101">COPA LIBERTADORES</div>
      <div class="match default-match" id="R_25224741">
        <div class="tableDiv-match-time">LIVE</div>
        <div class="team"><div class="tableDiv-match-info__event">
          <span>Cerro Porteno</span><span>Palmeiras SP</span>
        </div></div>
        <div class="Dbox_b2"><span class="line">0/0.5</span>
          <i class="odds away">0.96</i><i class="odds home">0.92</i>
        </div>
        <div class="Dbox_b4"><i class="odds">4.80</i><i class="odds">3.20</i><i class="odds">1.70</i></div>
      </div>
    `);

    const serialized = await page.evaluate(CMD_PUBLIC_CATALOG_EXPRESSION) as string;
    const records = JSON.parse(serialized) as Array<{ groups: Array<{
      odds: Array<{ lineText?: string }> }> }>;

    expect(records[0]?.groups[0]?.odds).toEqual([
      expect.objectContaining({ priceText: "0.92" }),
      expect.objectContaining({ priceText: "0.96", lineText: "0/0.5" })
    ]);
    await page.close();
  });

  it("anchors a legacy handicap to the rendered team labels when the responsive layout reverses the rows", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <style>
        .match { position: relative; width: 400px; height: 100px; }
        .tableDiv-match-info__event span, .Dbox_b2 > * { position: absolute; }
        .tableDiv-match-info__event .home { left: 10px; top: 52px; }
        .tableDiv-match-info__event .away { left: 10px; top: 8px; }
        .Dbox_b2 .line { left: 180px; top: 52px; }
        .Dbox_b2 .home { left: 260px; top: 52px; }
        .Dbox_b2 .away { left: 260px; top: 8px; }
      </style>
      <div class="league" id="lg_101">COPA LIBERTADORES</div>
      <div class="match default-match" id="R_25224741">
        <div class="tableDiv-match-time">LIVE</div>
        <div class="team"><div class="tableDiv-match-info__event">
          <span class="home">Cerro Porteno</span><span class="away">Palmeiras SP</span>
        </div></div>
        <div class="Dbox_b2"><span class="line">0/0.5</span>
          <i class="odds away">0.96</i><i class="odds home">0.92</i>
        </div>
      </div>
    `);

    const serialized = await page.evaluate(CMD_PUBLIC_CATALOG_EXPRESSION) as string;
    const records = JSON.parse(serialized) as Array<{ groups: Array<{
      odds: Array<{ lineText?: string }> }> }>;

    expect(records[0]?.groups[0]?.odds).toEqual([
      expect.objectContaining({ priceText: "0.92", lineText: "0/0.5" }),
      expect.objectContaining({ priceText: "0.96" })
    ]);
    await page.close();
  });

  it("fails closed when an invisible legacy handicap does not reveal which selection owns the line", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="league" id="lg_101">League</div>
      <div class="match default-match" id="R_25224742">
        <div class="tableDiv-match-time">LIVE</div>
        <div class="team"><div class="tableDiv-match-info__event"><span>Home</span><span>Away</span></div></div>
        <div class="Dbox_b2" style="display:none"><span>0/0.5</span>
          <i class="odds">0.80</i><i class="odds">-0.90</i>
        </div>
      </div>
    `);

    const serialized = await page.evaluate(CMD_PUBLIC_CATALOG_EXPRESSION) as string;
    const records = JSON.parse(serialized) as Array<{ groups: unknown[] }>;

    expect(records[0]?.groups).toEqual([]);
    await page.close();
  });
});
