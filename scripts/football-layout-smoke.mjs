import { chromium } from "playwright";

const baseUrl = process.env.TOOL_CHENH_WEB_URL ?? "http://127.0.0.1:4311";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1992, height: 1000 } });
  await page.goto(`${baseUrl}/football-live`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5_000);

  const firstCard = page.locator('.catalog-event[role="button"]').first();
  if (await firstCard.count() === 0) throw new Error("LAYOUT_NO_MATCH_CARD");
  await firstCard.click();
  await page.waitForTimeout(1_000);

  const failures = await page.evaluate(() => {
    const messages = [];
    const assertNotClipped = (selector, label) => {
      const elements = [...document.querySelectorAll(selector)];
      if (elements.length === 0) messages.push(`${label}: missing`);
      for (const element of elements) {
        if (element.scrollHeight > element.clientHeight + 1) {
          messages.push(`${label}: vertical ${element.scrollHeight}/${element.clientHeight}`);
        }
        if (element.scrollWidth > element.clientWidth + 1) {
          messages.push(`${label}: horizontal ${element.scrollWidth}/${element.clientWidth}`);
        }
      }
    };

    assertNotClipped(".catalog-event .provider-tags", "match provider badges");
    assertNotClipped(".catalog-event .event-edge-summary", "match ROI summary");
    assertNotClipped(".catalog-event .event-edge-summary > *", "match ROI text");
    assertNotClipped(".catalog-workspace__detail .provider-selector--detail", "detail provider selector");
    assertNotClipped(".catalog-workspace__detail .watch-ranked-tickets", "detail tickets");
    assertNotClipped(".catalog-workspace__detail .ranked-ticket-table-wrap--compact", "detail ticket table");

    const stakeProviderBrands = [...document.querySelectorAll(
      ".catalog-workspace__detail .ranked-ticket-stake-provider .provider-brand"
    )];
    if (stakeProviderBrands.length === 0) messages.push("stake provider badge: missing");
    for (const brand of stakeProviderBrands) {
      const style = getComputedStyle(brand);
      const icon = brand.querySelector(".provider-brand__icon");
      const name = brand.querySelector(".provider-brand__name");
      if (style.display !== "inline-flex") {
        messages.push(`stake provider badge: display ${style.display}`);
      }
      if (icon !== null && name !== null) {
        const iconRect = icon.getBoundingClientRect();
        const nameRect = name.getBoundingClientRect();
        if (Math.abs(iconRect.top - nameRect.top) > 4) {
          messages.push(`stake provider badge: split rows ${iconRect.top}/${nameRect.top}`);
        }
      }
    }

    const documentElement = document.documentElement;
    if (documentElement.scrollWidth > documentElement.clientWidth + 1) {
      messages.push(`page horizontal ${documentElement.scrollWidth}/${documentElement.clientWidth}`);
    }
    return messages;
  });

  if (failures.length > 0) throw new Error(`LAYOUT_CLIPPED\n${failures.join("\n")}`);
  console.log("football layout smoke: PASS");
} finally {
  await browser.close();
}
