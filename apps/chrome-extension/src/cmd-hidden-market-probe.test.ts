import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCmdHiddenMarketProbeExpression } from "./cmd-hidden-market-probe.js";

describe("CMD hidden-market DOM probe", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("ignores a hidden duplicate row and probes the visible exact event", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="c-match" data-matchid="25250586" style="display:none"></div>
      <div class="c-match" data-matchid="25250586">
        <button class="c-match__detail">View details</button>
        <i class="c-odds" data-moid="visible:1">0.90</i>
      </div>
      <div class="c-match" data-matchid="visible-other"><span class="c-team-name">Other</span></div>
    `);

    const result = await page.evaluate(buildCmdHiddenMarketProbeExpression("25250586"));

    expect(result).toMatchObject({ found: true, beforeMarketIds: ["visible:1"],
      candidateControls: ["button.c-match__detail View details"],
      visibleEventIds: ["25250586", "visible-other"] });
    await page.close();
  });

  it("prefers a rich legacy row over a visible modern event shell with the same id", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="c-match" data-matchid="25250586"></div>
      <div class="match" id="R_25250586">
        <div class="team" onclick="void 0">Vietnam Malaysia</div>
        <div class="Dbox_b2" data-bt="1"><span class="line">1/1.5</span>
          <span class="odds">0.90</span><span class="odds">-0.95</span></div>
      </div>
    `);

    const result = await page.evaluate(buildCmdHiddenMarketProbeExpression("25250586"));

    expect(result).toMatchObject({ beforeMarketIds: ["legacy-dom:25250586:0", "legacy-dom:25250586:1"],
      candidateControls: ["div.team Vietnam Malaysia"],
      marketStructures: ["div.Dbox_b2 bt=1 visible=1 label=1/1.5 odds=2"] });
    await page.close();
  });
});
