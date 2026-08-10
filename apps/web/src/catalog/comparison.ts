import type { ProviderEvent, ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";

export interface ComparisonCell {
  readonly provider: ProviderId;
  readonly market: ProviderMarket;
  readonly quotes: readonly ProviderQuote[];
}

export interface ComparisonRow {
  readonly key: string;
  readonly marketType: string;
  readonly scope: string;
  readonly line: string | null;
  readonly cells: readonly ComparisonCell[];
  readonly bestBySelection: Readonly<Record<string, ProviderId>>;
  readonly margin: number | null;
  readonly crossBook: boolean;
}

export interface ComparisonEvent {
  readonly key: string;
  readonly event: ProviderEvent;
  readonly providers: readonly ProviderId[];
  readonly catalogs: readonly LiveCatalogResponse[];
  readonly providerEventIds: Readonly<Partial<Record<ProviderId, string>>>;
  readonly rows: readonly ComparisonRow[];
  readonly bestMargin: number | null;
}

function identityText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}

function eventKey(event: ProviderEvent): string {
  const liveEvidence = event.category === "FOOTBALL" && event.liveState !== null
    ? `${event.liveState.period}|${event.liveState.scoreHome}|${event.liveState.scoreAway}` : "LIVE";
  const variantEvidence = event.category === "FOOTBALL"
    ? [event.isVirtual === true ? "VIRTUAL" : event.isVirtual === false ? "REAL" : "UNKNOWN", event.sportVariant ?? "UNKNOWN"]
    : [event.gameVariant ?? "UNKNOWN"];
  return [event.category, ...variantEvidence, identityText(event.participantA), identityText(event.participantB),
    event.isLive ? liveEvidence : String(event.startAtUtcMs)].join("|");
}

function marketKey(market: ProviderMarket): string {
  return [market.marketType, market.scope, market.line ?? "", market.settlementProfile].join("|");
}

export function decimalOdds(quote: ProviderQuote): number | null {
  const value = Number(quote.rawOdds);
  if (!Number.isFinite(value)) return null;
  if (quote.rawFormat === "DECIMAL") return value > 1 ? value : null;
  if (quote.rawFormat === "MALAY") {
    if (value === 0 || Math.abs(value) > 1) return null;
    return value > 0 ? 1 + value : 1 + 1 / Math.abs(value);
  }
  return null;
}

export function buildComparisonEvents(catalogs: readonly LiveCatalogResponse[]): readonly ComparisonEvent[] {
  const groups = new Map<string, { event: ProviderEvent; catalogs: LiveCatalogResponse[]; ids: Partial<Record<ProviderId, string>> }>();
  for (const catalog of catalogs) {
    for (const event of catalog.events) {
      const key = eventKey(event);
      const group = groups.get(key) ?? { event, catalogs: [], ids: {} };
      if (!group.catalogs.some((candidate) => candidate.provider === catalog.provider)) group.catalogs.push(catalog);
      group.ids[catalog.provider] = event.providerEventId;
      groups.set(key, group);
    }
  }
  return [...groups.entries()].map(([key, group]) => {
    const rowGroups = new Map<string, ComparisonCell[]>();
    for (const catalog of group.catalogs) {
      const providerEventId = group.ids[catalog.provider];
      for (const market of catalog.markets.filter((candidate) => candidate.providerEventId === providerEventId)) {
        const rowKey = marketKey(market);
        const cells = rowGroups.get(rowKey) ?? [];
        cells.push({ provider: catalog.provider, market,
          quotes: catalog.quotes.filter((quote) => quote.providerMarketId === market.providerMarketId) });
        rowGroups.set(rowKey, cells);
      }
    }
    const rows = [...rowGroups.entries()].map(([rowKey, cells]): ComparisonRow => {
      const bestBySelection: Record<string, ProviderId> = {};
      const selections = new Set(cells.flatMap((cell) => cell.quotes.map((quote) => quote.selection)));
      for (const selection of selections) {
        const eligible = cells.flatMap((cell) => cell.quotes.filter((quote) => quote.selection === selection &&
          quote.status === "OPEN" && cell.market.status === "OPEN").map((quote) => ({ provider: cell.provider, odds: decimalOdds(quote) })));
        const best = eligible.filter((item): item is { provider: ProviderId; odds: number } => item.odds !== null)
          .sort((left, right) => right.odds - left.odds)[0];
        if (best !== undefined) bestBySelection[selection] = best.provider;
      }
      const selectedProviders = new Set(Object.values(bestBySelection));
      const expectedOutcomes = cells[0]!.market.marketType === "FT_1X2" ? 3 : 2;
      const bestOdds = [...selections].map((selection) => {
        const provider = bestBySelection[selection];
        const quote = cells.find((cell) => cell.provider === provider)?.quotes.find((item) => item.selection === selection);
        return quote === undefined ? null : decimalOdds(quote);
      });
      const inverseSum = bestOdds.length === expectedOutcomes && bestOdds.every((value): value is number => value !== null)
        ? bestOdds.reduce((sum, value) => sum + 1 / value, 0) : null;
      const crossBook = selectedProviders.size >= 2;
      const margin = crossBook && inverseSum !== null ? (1 / inverseSum) - 1 : null;
      return { key: rowKey, marketType: cells[0]!.market.marketType, scope: cells[0]!.market.scope,
        line: cells[0]!.market.line, cells, bestBySelection, margin, crossBook };
    }).sort((left, right) => (right.margin ?? Number.NEGATIVE_INFINITY) - (left.margin ?? Number.NEGATIVE_INFINITY) || left.key.localeCompare(right.key));
    const bestMargin = rows.reduce<number | null>((best, row) => row.margin === null ? best : Math.max(best ?? row.margin, row.margin), null);
    return { key, event: group.event, providers: group.catalogs.map((catalog) => catalog.provider),
      catalogs: group.catalogs, providerEventIds: group.ids, rows, bestMargin };
  }).sort((left, right) => (right.bestMargin ?? Number.NEGATIVE_INFINITY) - (left.bestMargin ?? Number.NEGATIVE_INFINITY) ||
    left.event.startAtUtcMs - right.event.startAtUtcMs);
}

export function formatCountdown(startAtUtcMs: number, nowMs: number): string {
  const remainingSeconds = Math.max(0, Math.floor((startAtUtcMs - nowMs) / 1_000));
  if (remainingSeconds === 0) return "Starting / refresh pending";
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  const two = (value: number): string => String(value).padStart(2, "0");
  return `Starts in ${two(days)}:${two(hours)}:${two(minutes)}:${two(seconds)}`;
}

type DisplayLiveState = ProviderEvent["liveState"];

export function formatMatchClock(liveState: DisplayLiveState | null): string {
  if (liveState === null || !("clockMs" in liveState) || liveState.clockMs === null ||
    !Number.isFinite(liveState.clockMs) || liveState.clockMs < 0) {
    return "LIVE · clock unavailable";
  }
  const totalSeconds = Math.floor(liveState.clockMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `LIVE${liveState.period === null ? "" : ` · ${liveState.period}`} · ${clock} elapsed`;
}

export function estimatedLiveStartAtMs(observedAtMs: number, liveState: DisplayLiveState | null): number | null {
  if (!Number.isFinite(observedAtMs) || liveState === null || !("clockMs" in liveState) || liveState.clockMs === null ||
    !Number.isFinite(liveState.clockMs) || liveState.clockMs < 0) return null;
  const estimated = observedAtMs - liveState.clockMs;
  return Number.isFinite(estimated) && estimated >= 0 ? estimated : null;
}
