import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { extractApsportProfile, extractApsportRecords } from "./apsport-browser-manager.js";

describe("APSPORT DOM catalog", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); }, 30_000);

  it("extracts full-time half and quarter lines while excluding 1X2", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="match"><div class="league-name">Champions League</div>
      <div class="match-favorite" id="eventId-prematch-354-5543972"></div>
      <div class="match__status">Trực tiếp 1H 22'</div>
      <span class="match__team-name">Bodo Glimt</span><span class="match__team-score">2</span>
      <span class="match__team-name">St Gilloise</span><span class="match__team-score">2</span>
      <div class="match-odd-pair-list"><div class="match__odd-pair-list__type">TT Chấp</div>
        <div class="match__odd-pair" id="odd-item-5543972005000050h"><span class="match__odd-type">-0.5</span><span class="match__odd-value">0.90</span></div>
        <div class="match__odd-pair" id="odd-item-5543972005000050a"><span class="match__odd-type">+0.5</span><span class="match__odd-value">0.98</span></div>
      </div>
      <div class="match-odd-pair-list"><div class="match__odd-pair-list__type">TT T/X</div>
        <div class="match__odd-pair" id="odd-item-quarter-h"><span class="match__odd-type">o 3/3.5</span><span class="match__odd-value">-0.90</span></div>
        <div class="match__odd-pair" id="odd-item-quarter-a"><span class="match__odd-type">u 3/3.5</span><span class="match__odd-value">0.76</span></div>
      </div>
      <div class="match-odd-pair-list"><div class="match__odd-pair-list__type">TT 1X2</div></div>
    </section>`);

    const records = await extractApsportRecords(page);
    expect(records).toEqual([expect.objectContaining({
      eventId: "5543972", leagueName: "Champions League", teamNames: ["Bodo Glimt", "St Gilloise"],
      scoreText: "2 - 2", markets: [
        expect.objectContaining({ marketType: "FT_AH", lineText: "-0.5", selections: [
          expect.objectContaining({ selectionId: "5543972005000050h", selection: "HOME", priceText: "0.90" }),
          expect.objectContaining({ selectionId: "5543972005000050a", selection: "AWAY", priceText: "0.98" })
        ] }),
        expect.objectContaining({ marketType: "FT_TOTAL", lineText: "3/3.5", selections: [
          expect.objectContaining({ selection: "OVER", priceText: "-0.90" }),
          expect.objectContaining({ selection: "UNDER", priceText: "0.76" })
        ] })
      ]
    })]);
    await page.close();
  });

  it("classifies explicit half, second-half, corner and card two-way market labels", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="match"><div class="league-name">League</div>
      <div class="match-favorite" id="eventId-live-1-778800"></div><div class="match__status">LIVE</div>
      <span class="match__team-name">Home</span><span class="match__team-name">Away</span>
      ${[
        ["Hiep 1 Chap", "0.25"], ["Hiep 1 T/X", "1.25"],
        ["Hiep 2 Chap", "0.75"], ["Hiep 2 T/X", "1.75"],
        ["Phat goc ca tran Chap", "2.25"], ["Phat goc Hiep 1 T/X", "4.75"],
        ["The phat ca tran T/X", "3.25"], ["The phat Hiep 1 Chap", "0.75"]
      ].map(([label, line], index) => `<div class="match-odd-pair-list">
        <div class="match__odd-pair-list__type">${label}</div>
        <div class="match__odd-pair" id="odd-item-${index}-a"><span class="match__odd-type">${line}</span><span class="match__odd-value">0.8</span></div>
        <div class="match__odd-pair" id="odd-item-${index}-b"><span class="match__odd-type">${line}</span><span class="match__odd-value">-0.9</span></div>
      </div>`).join("")}
    </section>`);

    const [record] = await extractApsportRecords(page);
    expect(record?.markets.map((market) => market.marketType)).toEqual([
      "FH_AH", "FH_TOTAL", "SH_AH", "SH_TOTAL", "CORNER_FT_AH", "CORNER_FH_TOTAL",
      "CARD_FT_TOTAL", "CARD_FH_AH"
    ]);
    await page.close();
  });

  it("rejects a total group whose two selections carry different lines", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="match"><div class="league-name">League</div>
      <div class="match-favorite" id="eventId-live-1-778801"></div><div class="match__status">LIVE</div>
      <span class="match__team-name">Home</span><span class="match__team-name">Away</span>
      <div class="match-odd-pair-list"><div class="match__odd-pair-list__type">TT T/X</div>
        <div class="match__odd-pair" id="odd-item-over"><span class="match__odd-type">o 2.5</span><span class="match__odd-value">0.8</span></div>
        <div class="match__odd-pair" id="odd-item-under"><span class="match__odd-type">u 3.5</span><span class="match__odd-value">-0.9</span></div>
      </div>
    </section>`);

    const [record] = await extractApsportRecords(page);
    expect(record?.markets).toEqual([]);
    await page.close();
  });

  it("extracts live handicap markets from correctly encoded Vietnamese labels", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="match"><div class="league-name">V-League</div>
      <div class="match-favorite" id="eventId-live-354-778899"></div>
      <div class="match__status">Trực tiếp Hiệp 2 67'</div>
      <span class="match__team-name">Hà Nội</span><span class="match__team-score">1</span>
      <span class="match__team-name">Nam Định</span><span class="match__team-score">0</span>
      <div class="match-odd-pair-list"><div class="match__odd-pair-list__type">TT Chấp</div>
        <div class="match__odd-pair" id="odd-item-home"><span class="match__odd-type">-0.5</span><span class="match__odd-value">0.91</span></div>
        <div class="match__odd-pair" id="odd-item-away"><span class="match__odd-type">+0.5</span><span class="match__odd-value">0.97</span></div>
      </div>
    </section>`);

    await expect(extractApsportRecords(page)).resolves.toEqual([expect.objectContaining({
      eventId: "778899", teamNames: ["Hà Nội", "Nam Định"], markets: [expect.objectContaining({
        marketType: "FT_AH", lineText: "-0.5"
      })]
    })]);
    await page.close();
  });

  it("extracts the authenticated profile from the read-only account header", async () => {
    const page = await browser.newPage();
    await page.setContent(`<p class="user-name">development-user-3333</p><span class="user-balance">29 K</span>`);
    await expect(extractApsportProfile(page)).resolves.toEqual({
      displayName: "development-user-3333", balanceText: "29 K"
    });
    await page.close();
  });
});
