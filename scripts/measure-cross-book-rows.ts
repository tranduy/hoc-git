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

  process.stdout.write("\nby edge (margin > 0 is an arbitrage)\n");
  const buckets: readonly (readonly [string, (m: number) => boolean])[] = [
    ["margin > 2%", (m) => m > 0.02],
    ["margin 1-2%", (m) => m > 0.01 && m <= 0.02],
    ["margin 0-1%", (m) => m > 0 && m <= 0.01],
    ["margin <= 0", (m) => m <= 0]
  ];
  const edges: number[] = [];
  for (const event of built) {
    for (const row of event.rows as readonly { margin: number | null }[]) {
      if (typeof row.margin === "number" && Number.isFinite(row.margin)) edges.push(row.margin);
    }
  }
  for (const [label, test] of buckets) {
    process.stdout.write(`  ${label.padEnd(24)} ${edges.filter(test).length}
`);
  }
  process.stdout.write(`  ${"no margin computed".padEnd(24)} ${rows - edges.length}
`);
  const positives = edges.filter((m) => m > 0).sort((a, b) => b - a);
  if (positives.length > 0) {
    process.stdout.write(`  best edge               ${(positives[0]! * 100).toFixed(2)}%
`);
  }

  const top = (counts: ReadonlyMap<string, number>, label: string, limit: number): void => {
    process.stdout.write(`\n${label}\n`);
    for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
      process.stdout.write(`  ${key.padEnd(24)} ${count}\n`);
    }
  };
  reportTopEdges(built as readonly unknown[], 3);
  blamePositiveRows(built as readonly unknown[]);
  top(pairCounts, "by book pair", 15);
  top(marketCounts, "by market type", 15);
}

void main();

/**
 * The top of the positive list is where fabricated edges surface. A real
 * cross-book arbitrage on a liquid football market is a fraction of a percent
 * and lives for seconds; a double-digit one is a pairing or staleness defect
 * wearing a profit label. Printing the shape of the best rows is how the
 * difference becomes visible instead of assumed.
 */
export function reportTopEdges(built: readonly unknown[], limit: number): void {
  type Cell = { provider?: string; quotes?: readonly { selection?: string; rawOdds?: string;
    rawFormat?: string; sequence?: number; providerObservedAtMs?: number; status?: string }[] };
  type Row = { marketType: string; scope: string; line: string | null; margin: number | null;
    cells: readonly Cell[]; bestBySelection?: Readonly<Record<string, string>> };
  const found: { event: string; row: Row }[] = [];
  for (const event of built as readonly { event?: { participantA?: string; participantB?: string };
    providerEventIds?: Readonly<Record<string, string>>; rows: readonly Row[] }[]) {
    for (const row of event.rows) {
      if (typeof row.margin === "number" && row.margin > 0) {
        found.push({ event: `${event.event?.participantA ?? "?"} v ${event.event?.participantB ?? "?"}` +
          ` | ids=${JSON.stringify(event.providerEventIds ?? {})}`, row });
      }
    }
  }
  found.sort((a, b) => (b.row.margin ?? 0) - (a.row.margin ?? 0));
  const now = Date.now();
  process.stdout.write(`\ntop ${limit} positive rows\n`);
  for (const { event, row } of found.slice(0, limit)) {
    process.stdout.write(`\n  ${((row.margin ?? 0) * 100).toFixed(2).padStart(7)}%  ` +
      `${row.marketType}/${row.scope}${row.line === null ? "" : ` line=${row.line}`}  ${event}\n`);
    process.stdout.write(`           best=${JSON.stringify(row.bestBySelection ?? {})}\n`);
    for (const cell of row.cells) {
      for (const quote of cell.quotes ?? []) {
        const ageMs = typeof quote.providerObservedAtMs === "number"
          ? now - quote.providerObservedAtMs : null;
        process.stdout.write(`           ${String(cell.provider).padEnd(8)} ` +
          `${String(quote.selection).padEnd(10)} raw=${String(quote.rawOdds).padEnd(8)} ` +
          `fmt=${String(quote.rawFormat).padEnd(7)} ` +
          `seq=${String(quote.sequence).padEnd(8)} ` +
          `age=${ageMs === null ? "?" : `${(ageMs / 1000).toFixed(0)}s`} ` +
          `${quote.status ?? ""}\n`);
      }
    }
  }
}

/**
 * Which books are named as best on a positive row. A book that is not live, or
 * whose price is derived rather than published, shows up here as the author of
 * edges that do not exist.
 */
export function blamePositiveRows(built: readonly unknown[]): void {
  type Row = { margin: number | null; bestBySelection?: Readonly<Record<string, string>>;
    cells: readonly { provider?: string; quotes?: readonly { rawOdds?: string }[] }[] };
  const winners = new Map<string, number>();
  let positives = 0;
  let longDecimal = 0;
  const longDecimalBy = new Map<string, number>();
  for (const event of built as readonly { rows: readonly Row[] }[]) {
    for (const row of event.rows) {
      if (typeof row.margin !== "number" || row.margin <= 0) continue;
      positives += 1;
      for (const provider of new Set(Object.values(row.bestBySelection ?? {}))) {
        winners.set(provider, (winners.get(provider) ?? 0) + 1);
      }
      let hasLong = false;
      for (const cell of row.cells) {
        for (const quote of cell.quotes ?? []) {
          const raw = String(quote.rawOdds ?? "");
          const decimals = raw.includes(".") ? raw.split(".")[1]!.length : 0;
          if (decimals > 4) {
            hasLong = true;
            const key = String(cell.provider);
            longDecimalBy.set(key, (longDecimalBy.get(key) ?? 0) + 1);
          }
        }
      }
      if (hasLong) longDecimal += 1;
    }
  }
  process.stdout.write(`
positive rows: ${positives}
`);
  process.stdout.write("  named best on a positive row:\n");
  for (const [provider, count] of [...winners].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`    ${provider.padEnd(10)} ${count}
`);
  }
  process.stdout.write(`  rows carrying a >4-decimal (derived) price: ${longDecimal}
`);
  for (const [provider, count] of [...longDecimalBy].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`    ${provider.padEnd(10)} ${count}
`);
  }
}
