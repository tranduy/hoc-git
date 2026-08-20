import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const durationMs = Math.max(10_000, Number(process.argv[2] ?? 600_000));
const outputPath = process.argv[3] ?? "cmd-ui-runtime-evidence.json";
const startedAtMs = Date.now();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const prices = new Map();
const result = { startedAtMs, durationMs, documentNavigations: 0, cmdCatalogResponses: 0,
  cmdQuoteChanges: [], pageErrors: [] };

page.on("request", (request) => {
  if (request.resourceType() === "document") result.documentNavigations += 1;
});
page.on("pageerror", (error) => result.pageErrors.push(error.message));
page.on("response", async (response) => {
  if (!response.url().includes("/api/catalog/accounts/catalog-source%3ACMD%3AFOOTBALL") &&
    !response.url().includes("/api/catalog/accounts/catalog-source:CMD:FOOTBALL")) return;
  if (!response.ok()) return;
  try {
    const catalog = await response.json();
    result.cmdCatalogResponses += 1;
    for (const quote of catalog.quotes ?? []) {
      const key = [quote.providerEventId, quote.providerMarketId, quote.providerSelectionId].join("|");
      const prior = prices.get(key);
      if (prior !== undefined && prior.rawOdds !== quote.rawOdds && result.cmdQuoteChanges.length < 50) {
        result.cmdQuoteChanges.push({ key, before: prior.rawOdds, after: quote.rawOdds,
          beforeSequence: prior.sequence, afterSequence: quote.sequence, detectedAtMs: Date.now() });
      }
      prices.set(key, { rawOdds: quote.rawOdds, sequence: quote.sequence });
    }
  } catch (error) {
    result.pageErrors.push(error instanceof Error ? error.message : String(error));
  }
});

await page.goto("http://127.0.0.1:4311/football-live", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(durationMs);
result.finishedAtMs = Date.now();
result.finalUrl = page.url();
await browser.close();
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
