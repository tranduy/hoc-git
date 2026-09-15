/**
 * Count the only number that matters: rows paired across two or more books.
 *
 * The web builds these in the browser, so the figure was only ever readable by
 * looking at a screen. This runs the same builder against the live catalogs and
 * prints counts, which makes the metric measurable between deploys instead of
 * estimated.
 *
 * Read-only: it fetches catalogs and computes. It places nothing and changes
 * nothing.
 */
import { buildComparisonEvents } from "../apps/web/src/catalog/comparison.js";

const API = process.env.TOOL_CHENH_API ?? "http://127.0.0.1:4310";

const SOURCES = ["CMD", "SABA", "SBOBET", "APSPORT", "BTI", "IM"]
  .map((provider) => `catalog-source:${provider}:FOOTBALL`);

async function readCatalog(accountId: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${API}/api/catalog/accounts/${encodeURIComponent(accountId)}`);
    if (!response.ok) {
      process.stdout.write(`${accountId.padEnd(32)} HTTP ${response.status}\n`);
      return null;
    }
    return await response.json();
  } catch (error) {
    process.stdout.write(`${accountId.padEnd(32)} ${error instanceof Error ? error.message : String(error)}\n`);
    return null;
  }
}

function providerOf(cell: { readonly provider?: string }): string {
  return cell.provider ?? "UNKNOWN";
}

async function main(): Promise<void> {
  const catalogs = (await Promise.all(SOURCES.map(readCatalog)))
    .filter((catalog): catalog is Record<string, unknown> => catalog !== null);

  process.stdout.write(`\ncatalogs read: ${catalogs.length}/${SOURCES.length}\n`);
  for (const catalog of catalogs) {
    const events = Array.isArray(catalog.events) ? catalog.events.length : 0;
    const markets = Array.isArray(catalog.markets) ? catalog.markets.length : 0;
    const quotes = Array.isArray(catalog.quotes) ? catalog.quotes.length : 0;
    process.stdout.write(`  ${String(catalog.provider).padEnd(9)} events=${String(events).padEnd(5)} ` +
      `markets=${String(markets).padEnd(6)} quotes=${quotes}\n`);
  }

  const built = buildComparisonEvents(catalogs as never);

  let rows = 0;
  let crossBookRows = 0;
  let crossBookEvents = 0;
  const pairCounts = new Map<string, number>();
  const marketCounts = new Map<string, number>();

  for (const event of built) {
    let eventHasCross = false;
    for (const row of event.rows as readonly { marketType: string; cells: readonly { provider?: string }[] }[]) {
      rows += 1;
      const providers = [...new Set(row.cells.map(providerOf))].sort();
      if (providers.length < 2) continue;
      crossBookRows += 1;
      eventHasCross = true;
      marketCounts.set(row.marketType, (marketCounts.get(row.marketType) ?? 0) + 1);
      for (let i = 0; i < providers.length; i += 1) {
        for (let j = i + 1; j < providers.length; j += 1) {
          const key = `${providers[i]}+${providers[j]}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }
    if (eventHasCross) crossBookEvents += 1;
  }

  process.stdout.write(`\nevents built        : ${built.length}\n`);
  process.stdout.write(`rows total          : ${rows}\n`);
  process.stdout.write(`ROWS ACROSS BOOKS   : ${crossBookRows}\n`);
  process.stdout.write(`events with a cross : ${crossBookEvents}\n`);

  const top = (counts: ReadonlyMap<string, number>, label: string, limit: number): void => {
    process.stdout.write(`\n${label}\n`);
    for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
      process.stdout.write(`  ${key.padEnd(24)} ${count}\n`);
    }
  };
  top(pairCounts, "by book pair", 15);
  top(marketCounts, "by market type", 15);
}

void main();
