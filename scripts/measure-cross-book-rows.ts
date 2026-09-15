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
  reportTopEdges(built as readonly unknown[], 12);
  namesBehindPositiveRows(built as readonly unknown[], catalogs as never);
  blamePositiveRows(built as readonly unknown[]);
  phaseDisagreement(built as readonly unknown[]);
  ladderForWorstRow(built as readonly unknown[], catalogs as never);
  livePositiveSplit(built as readonly unknown[]);
  cmdMoreValue(built as readonly unknown[], catalogs as never);
  marginBearingMarkets(built as readonly unknown[]);
  unusedMarketTypes(built as readonly unknown[], catalogs as never);
  whyUnpriced(built as readonly unknown[]);
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
    rawFormat?: string; sequence?: number; providerObservedAtMs?: number; status?: string;
    isLive?: boolean; line?: string | null }[] };
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
    // Only the quotes the margin actually used, with the line each came from.
    // A winning quote whose line differs from the row's is the row pricing two
    // different products against each other.
    const decimal = (raw: string, fmt: string): number | null => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      if (fmt === "DECIMAL") return value;
      if (fmt === "HK") return value + 1;
      if (fmt === "MALAY") return value === 0 ? null : value > 0 ? value + 1 : 1 + 1 / Math.abs(value);
      return null;
    };
    let implied = 0;
    let usable = true;
    for (const [selection, provider] of Object.entries(row.bestBySelection ?? {})) {
      // A provider can hold several cells on one row; search them all.
      const winners = row.cells.filter((item) => item.provider === provider)
        .flatMap((item) => item.quotes ?? []).filter((quote) => quote.selection === selection);
      const best = winners
        .map((quote) => ({ quote, dec: decimal(String(quote.rawOdds), String(quote.rawFormat)) }))
        .filter((item): item is { quote: typeof winners[number]; dec: number } => item.dec !== null)
        .sort((a, b) => b.dec - a.dec)[0];
      if (best === undefined) { usable = false; continue; }
      implied += 1 / best.dec;
      const sameLine = (best.quote.line ?? null) === row.line;
      process.stdout.write(`           USED ${String(provider).padEnd(8)} ` +
        `${selection.padEnd(10)} raw=${String(best.quote.rawOdds).padEnd(8)} ` +
        `${String(best.quote.rawFormat).padEnd(7)} dec=${best.dec.toFixed(4).padEnd(8)} ` +
        `line=${String(best.quote.line ?? "-").padEnd(6)}${sameLine ? "" : "  <-- LINE MISMATCH"}` +
        `  candidates=${winners.length}
`);
    }
    // A book prices both sides of its own market with an overround. If its own
    // two sides imply less than 1, the quotes are not a book - they are a
    // decoding or line-mapping error, and any edge built on them is invented.
    for (const cell of row.cells) {
      const own = new Map<string, number>();
      for (const quote of cell.quotes ?? []) {
        if (quote.status !== "OPEN") continue;
        const dec = decimal(String(quote.rawOdds), String(quote.rawFormat));
        if (dec === null || (quote.line ?? null) !== row.line) continue;
        const selection = String(quote.selection);
        if (!own.has(selection) || dec > own.get(selection)!) own.set(selection, dec);
      }
      if (own.size < 2) continue;
      const sum = [...own.values()].reduce((total, dec) => total + 1 / dec, 0);
      const flag = sum < 1 ? "  <-- BOOK ARBS ITSELF" : "";
      process.stdout.write(`           own  ${String(cell.provider).padEnd(8)} ` +
        `sides=${own.size} impliedSum=${sum.toFixed(4)} ` +
        `overround=${((sum - 1) * 100).toFixed(2)}%${flag}
`);
    }
    if (usable) {
      process.stdout.write(`           implied sum=${implied.toFixed(5)} ` +
        `=> margin ${((1 / implied - 1) * 100).toFixed(2)}% (row says ` +
        `${((row.margin ?? 0) * 100).toFixed(2)}%)
`);
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

/**
 * Whether the books on a row agree about which half of the match they are
 * pricing. Two books quoting the same fixture at different phases are not
 * quoting the same product, and pairing them reads as an edge when it is only
 * a clock difference.
 */
export function phaseDisagreement(built: readonly unknown[]): void {
  type Row = { margin: number | null;
    cells: readonly { provider?: string; quotes?: readonly { isLive?: boolean }[] }[] };
  let split = 0;
  let splitPositive = 0;
  let agreed = 0;
  const splitBy = new Map<string, number>();
  for (const event of built as readonly { rows: readonly Row[] }[]) {
    for (const row of event.rows) {
      const live = new Set<boolean>();
      const liveProviders = new Set<string>();
      for (const cell of row.cells) {
        for (const quote of cell.quotes ?? []) {
          live.add(quote.isLive === true);
          if (quote.isLive === true) liveProviders.add(String(cell.provider));
        }
      }
      if (live.size < 2) { agreed += 1; continue; }
      split += 1;
      if (typeof row.margin === "number" && row.margin > 0) splitPositive += 1;
      for (const provider of liveProviders) splitBy.set(provider, (splitBy.get(provider) ?? 0) + 1);
    }
  }
  process.stdout.write(`
rows where books disagree on live/prematch
`);
  process.stdout.write(`  rows in phase agreement : ${agreed}
`);
  process.stdout.write(`  rows split on phase     : ${split}
`);
  process.stdout.write(`  of those, positive      : ${splitPositive}
`);
  for (const [provider, count] of [...splitBy].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`    live side is ${provider.padEnd(9)} ${count}
`);
  }
}

/**
 * The full line ladder each book publishes for the fixture and market behind
 * the worst positive row. If one book's prices sit a rung away from everyone
 * else's at the same labelled line, the line mapping is wrong; if its ladder
 * simply stops short, the books are pricing different products.
 */
export function ladderForWorstRow(built: readonly unknown[],
  catalogs: readonly { provider?: string; quotes?: readonly {
    providerEventId?: string; marketType?: string; scope?: string; line?: string | null;
    selection?: string; rawOdds?: string; rawFormat?: string; isLive?: boolean }[] }[]): void {
  type Row = { marketType: string; scope: string; line: string | null; margin: number | null };
  type Built = { providerEventIds?: Readonly<Record<string, string>>;
    event?: { participantA?: string; participantB?: string }; rows: readonly Row[] };
  let worst: { event: Built; row: Row } | null = null;
  for (const event of built as readonly Built[]) {
    for (const row of event.rows) {
      if (typeof row.margin !== "number" || row.margin <= 0) continue;
      if (worst === null || row.margin > (worst.row.margin ?? 0)) worst = { event, row };
    }
  }
  if (worst === null) { process.stdout.write("\nno positive row to explain\n"); return; }
  const { event, row } = worst;
  process.stdout.write(`
ladder behind the worst row: ${row.marketType}/${row.scope} ` +
    `line=${row.line ?? "-"} at ${((row.margin ?? 0) * 100).toFixed(2)}%
`);
  process.stdout.write(`  ${event.event?.participantA ?? "?"} v ${event.event?.participantB ?? "?"}
`);
  for (const catalog of catalogs) {
    const id = (event.providerEventIds ?? {})[String(catalog.provider)];
    if (id === undefined) continue;
    const ladder = new Map<string, string[]>();
    for (const quote of catalog.quotes ?? []) {
      if (quote.providerEventId !== id || quote.marketType !== row.marketType ||
        quote.scope !== row.scope) continue;
      const key = String(quote.line ?? "-");
      const entries = ladder.get(key) ?? [];
      entries.push(`${quote.selection}=${quote.rawOdds}${quote.isLive === true ? "*" : ""}`);
      ladder.set(key, entries);
    }
    const lines = [...ladder.keys()].sort((a, b) => Number(a) - Number(b));
    process.stdout.write(`  ${String(catalog.provider).padEnd(9)}` +
      `${lines.length === 0 ? "(no ladder)" : ""}
`);
    for (const line of lines) {
      process.stdout.write(`      line ${line.padEnd(7)} ${ladder.get(line)!.join("  ")}
`);
    }
  }
}

/**
 * Whether the positive rows are in-play. A live price moves every few seconds,
 * so two books sampled seconds apart disagree by amounts that read as enormous
 * edges and are only clock skew - and a read-only system could not act on them
 * even if they were real.
 */
export function livePositiveSplit(built: readonly unknown[]): void {
  type Row = { margin: number | null; marketType: string;
    cells: readonly { quotes?: readonly { isLive?: boolean }[] }[] };
  let livePositive = 0;
  let prematchPositive = 0;
  const liveEdges: number[] = [];
  const prematchEdges: number[] = [];
  for (const event of built as readonly { rows: readonly Row[] }[]) {
    for (const row of event.rows) {
      if (typeof row.margin !== "number" || row.margin <= 0) continue;
      const live = row.cells.some((cell) => (cell.quotes ?? []).some((quote) => quote.isLive === true));
      if (live) { livePositive += 1; liveEdges.push(row.margin); }
      else { prematchPositive += 1; prematchEdges.push(row.margin); }
    }
  }
  const describe = (edges: readonly number[]): string => edges.length === 0 ? "-"
    : `max ${(Math.max(...edges) * 100).toFixed(2)}%`;
  process.stdout.write("\npositive rows by phase\n");
  process.stdout.write(`  in-play  : ${livePositive}  ${describe(liveEdges)}
`);
  process.stdout.write(`  prematch : ${prematchPositive}  ${describe(prematchEdges)}
`);
}

/**
 * What each book calls the fixture behind a positive row. Cross-book matching
 * links fixtures by name and kickoff; if the books are actually describing
 * different games - a reserve side, an age-group match - the row compares two
 * different events and the edge is invented.
 */
export function namesBehindPositiveRows(built: readonly unknown[],
  catalogs: readonly { provider?: string;
    events?: readonly { providerEventId?: string; participantA?: string; participantB?: string;
      competition?: string; startAtUtcMs?: number; isLive?: boolean }[] }[]): void {
  type Built = { providerEventIds?: Readonly<Record<string, string>>;
    rows: readonly { margin: number | null }[] };
  const seen = new Set<string>();
  process.stdout.write("\nfixture identity behind each positive row\n");
  for (const event of built as readonly Built[]) {
    const best = event.rows.reduce<number | null>((top, row) =>
      typeof row.margin === "number" && row.margin > 0 ? Math.max(top ?? row.margin, row.margin) : top, null);
    if (best === null) continue;
    const key = JSON.stringify(event.providerEventIds ?? {});
    if (seen.has(key)) continue;
    seen.add(key);
    process.stdout.write(`
  best ${(best * 100).toFixed(2)}%
`);
    for (const catalog of catalogs) {
      const id = (event.providerEventIds ?? {})[String(catalog.provider)];
      if (id === undefined) continue;
      const found = (catalog.events ?? []).find((item) => item.providerEventId === id);
      if (found === undefined) { process.stdout.write(`    ${String(catalog.provider).padEnd(9)} (event missing)
`); continue; }
      const kick = typeof found.startAtUtcMs === "number"
        ? new Date(found.startAtUtcMs).toISOString().slice(5, 16).replace("T", " ") : "?";
      process.stdout.write(`    ${String(catalog.provider).padEnd(9)}${found.isLive === true ? "LIVE " : "pre  "}` +
        `${kick}  ${found.participantA} v ${found.participantB}  [${found.competition ?? "?"}]
`);
    }
  }
}

/**
 * What CMD's hidden markets are worth in cross-book rows. CMD's More call names
 * a group and no event, so a group whose answer covers one fixture leaves its
 * siblings without hidden markets. This measures the cost of that in the only
 * currency that matters: rows the board would lose.
 */
export function cmdMoreValue(built: readonly unknown[],
  catalogs: readonly { provider?: string;
    markets?: readonly { providerEventId?: string; marketType?: string }[] }[]): void {
  const MAIN = new Set(["FT_AH", "FT_TOTAL", "FT_1X2", "FH_AH", "FH_TOTAL", "FH_1X2"]);
  const cmd = catalogs.find((item) => item.provider === "CMD");
  if (cmd === undefined) { process.stdout.write("\nno CMD catalog\n"); return; }
  const typesByEvent = new Map<string, Set<string>>();
  for (const market of cmd.markets ?? []) {
    const id = String(market.providerEventId);
    const set = typesByEvent.get(id) ?? new Set<string>();
    set.add(String(market.marketType));
    typesByEvent.set(id, set);
  }
  const thin = new Set([...typesByEvent]
    .filter(([, types]) => [...types].every((type) => MAIN.has(type)))
    .map(([id]) => id));

  let thinMatched = 0;
  let thinRows = 0;
  let richMatched = 0;
  let richRows = 0;
  for (const event of built as readonly { providerEventIds?: Readonly<Record<string, string>>;
    rows: readonly { cells: readonly { provider?: string }[] }[] }[]) {
    const id = (event.providerEventIds ?? {}).CMD;
    if (id === undefined) continue;
    const rows = event.rows.filter((row) => row.cells.some((cell) => cell.provider === "CMD")).length;
    if (thin.has(id)) { thinMatched += 1; thinRows += rows; }
    else { richMatched += 1; richRows += rows; }
  }
  const mean = (total: number, count: number): string => count === 0 ? "-" : (total / count).toFixed(1);
  process.stdout.write("\nwhat CMD's hidden markets are worth\n");
  process.stdout.write(`  CMD fixtures with only main markets : ${thin.size}
`);
  process.stdout.write(`    of those, matched to another book : ${thinMatched}
`);
  process.stdout.write(`    rows they carry a CMD side on     : ${thinRows} (mean ${mean(thinRows, thinMatched)})
`);
  process.stdout.write(`  CMD fixtures with hidden markets    : ${typesByEvent.size - thin.size}
`);
  process.stdout.write(`    of those, matched to another book : ${richMatched}
`);
  process.stdout.write(`    rows they carry a CMD side on     : ${richRows} (mean ${mean(richRows, richMatched)})
`);
}

/**
 * Every market type the board is willing to put a margin on. Only two routes
 * may produce one - an exact two-way domain, and the 1X2/double-chance
 * complement - so anything else here is a market being priced through a door
 * nobody meant to open. FT_HALF_FULL_RESULT is the reason to look: it carries a
 * nine-way selection space in which HOME_AWAY means "home at half time, away at
 * full time", the same string double chance uses for "home or away".
 */
export function marginBearingMarkets(built: readonly unknown[]): void {
  const priced = new Map<string, number>();
  const rowsBy = new Map<string, number>();
  for (const event of built as readonly { rows: readonly {
    marketType: string; margin: number | null }[] }[]) {
    for (const row of event.rows) {
      rowsBy.set(row.marketType, (rowsBy.get(row.marketType) ?? 0) + 1);
      if (typeof row.margin === "number" && Number.isFinite(row.margin)) {
        priced.set(row.marketType, (priced.get(row.marketType) ?? 0) + 1);
      }
    }
  }
  process.stdout.write("\nmarket types carrying a margin\n");
  for (const [type, count] of [...priced].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${type.padEnd(30)} priced=${String(count).padEnd(6)} rows=${rowsBy.get(type)}
`);
  }
  const unpriced = [...rowsBy].filter(([type]) => !priced.has(type));
  process.stdout.write(`  (market types present but never priced: ${unpriced.length})
`);
  for (const [type, count] of unpriced.sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    process.stdout.write(`      ${type.padEnd(30)} rows=${count}
`);
  }
}

/**
 * Market types the books publish that reach no row at all. Each one is a book's
 * inventory the board collects, stores and never compares - the state
 * FT_HALF_FULL_RESULT and FT_RESULT_BTTS were in until 2026-09-15. Ranked by
 * how many books carry it, because a type only one book publishes can never
 * produce a cross-book row however it is priced.
 */
export function unusedMarketTypes(built: readonly unknown[],
  catalogs: readonly { provider?: string;
    quotes?: readonly { marketType?: string; providerEventId?: string }[] }[]): void {
  const inRows = new Set<string>();
  for (const event of built as readonly { rows: readonly { marketType: string }[] }[]) {
    for (const row of event.rows) inRows.add(row.marketType);
  }
  const books = new Map<string, Set<string>>();
  const fixtures = new Map<string, Set<string>>();
  for (const catalog of catalogs) {
    for (const quote of catalog.quotes ?? []) {
      const type = String(quote.marketType);
      if (inRows.has(type)) continue;
      const bookSet = books.get(type) ?? new Set<string>();
      bookSet.add(String(catalog.provider));
      books.set(type, bookSet);
      const fixtureSet = fixtures.get(type) ?? new Set<string>();
      fixtureSet.add(`${catalog.provider}|${quote.providerEventId}`);
      fixtures.set(type, fixtureSet);
    }
  }
  const ranked = [...books].sort((a, b) => b[1].size - a[1].size ||
    (fixtures.get(b[0])?.size ?? 0) - (fixtures.get(a[0])?.size ?? 0));
  process.stdout.write(`
market types collected but never compared: ${ranked.length}
`);
  for (const [type, bookSet] of ranked.slice(0, 20)) {
    process.stdout.write(`  ${type.padEnd(34)} books=${bookSet.size}  ` +
      `bookFixtures=${fixtures.get(type)?.size ?? 0}  [${[...bookSet].sort().join(",")}]
`);
  }
}

/**
 * Why a cross-book row carries no margin. Three answers are possible and they
 * mean very different things: one book holding the best price on every outcome
 * is not an arbitrage and must not be priced, a domain the board could not fill
 * is missing inventory, and anything else is a gate worth naming.
 */
export function whyUnpriced(built: readonly unknown[]): void {
  type Row = { marketType: string; margin: number | null;
    bestBySelection?: Readonly<Record<string, string>>;
    cells: readonly { provider?: string }[] };
  let singleBookBest = 0;
  let domainUnfilled = 0;
  let other = 0;
  const byTypeSingle = new Map<string, number>();
  const byTypeUnfilled = new Map<string, number>();
  for (const event of built as readonly { rows: readonly Row[] }[]) {
    for (const row of event.rows) {
      if (typeof row.margin === "number" && Number.isFinite(row.margin)) continue;
      const best = Object.values(row.bestBySelection ?? {});
      const providers = new Set(row.cells.map((cell) => String(cell.provider)));
      if (best.length > 0 && new Set(best).size < 2 && providers.size >= 2) {
        singleBookBest += 1;
        byTypeSingle.set(row.marketType, (byTypeSingle.get(row.marketType) ?? 0) + 1);
      } else if (best.length === 0) {
        domainUnfilled += 1;
        byTypeUnfilled.set(row.marketType, (byTypeUnfilled.get(row.marketType) ?? 0) + 1);
      } else other += 1;
    }
  }
  process.stdout.write("\nwhy a cross-book row carries no margin\n");
  process.stdout.write(`  one book best on every outcome (correct) : ${singleBookBest}
`);
  process.stdout.write(`  no best for some outcome (missing side)  : ${domainUnfilled}
`);
  process.stdout.write(`  something else                           : ${other}
`);
  const top = (counts: ReadonlyMap<string, number>, label: string): void => {
    process.stdout.write(`  ${label}
`);
    for (const [type, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      process.stdout.write(`      ${type.padEnd(24)} ${count}
`);
    }
  };
  top(byTypeSingle, "by type, one book best:");
  top(byTypeUnfilled, "by type, missing side:");
}
