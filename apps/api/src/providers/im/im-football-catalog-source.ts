import { isSupportedFootballTwoWayLine,
  type SbobetCatalogInputRecord, type SbobetCatalogMarket, type SbobetCatalogSelection } from "@tool-chenh/adapters";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value)
    : typeof value === "string" && /^\d+$/u.test(value) && value !== "0" ? value : null;
}

function supportedLine(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100 &&
    isSupportedFootballTwoWayLine(String(Math.abs(value)));
}

type ImFootballMarketType = "FT_AH" | "FT_TOTAL" | "FH_AH" | "FH_TOTAL";

function isHandicapMarket(marketType: ImFootballMarketType): boolean {
  return marketType === "FT_AH" || marketType === "FH_AH";
}

function selection(value: unknown, marketType: ImFootballMarketType): SbobetCatalogSelection | null {
  const item = record(value);
  const isHandicap = isHandicapMarket(marketType);
  const expected = isHandicap ? [1, 2] : [3, 4];
  if (item === null || !expected.includes(Number(item.si)) || !supportedLine(item.hdp) ||
    typeof item.o !== "number" || !Number.isFinite(item.o) || item.o === 0 || Math.abs(item.o) > 1) return null;
  const selectionId = identifier(item.wsi);
  const lineText = text(item.dih);
  if (selectionId === null || lineText === null) return null;
  return {
    selectionId,
    selection: isHandicap ? (item.si === 1 ? "HOME" : "AWAY")
      : (item.si === 3 ? "OVER" : "UNDER"),
    priceText: String(item.o),
    locked: false,
    lineText
  };
}

function market(value: unknown): SbobetCatalogMarket | null {
  const item = record(value);
  if (item === null || (item.bti !== 1 && item.bti !== 2) || (item.gp !== 1 && item.gp !== 2) ||
    !Array.isArray(item.ws) || item.ws.length !== 2) return null;
  const marketId = identifier(item.mi);
  const marketType: ImFootballMarketType = item.gp === 1
    ? item.bti === 1 ? "FT_AH" : "FT_TOTAL"
    : item.bti === 1 ? "FH_AH" : "FH_TOTAL";
  const selections = item.ws.map((value) => selection(value, marketType));
  if (marketId === null || selections.some((item) => item === null)) return null;
  const exact = selections as SbobetCatalogSelection[];
  if (new Set(exact.map((item) => item.selection)).size !== 2) return null;
  return { marketId, marketType,
    lineText: isHandicapMarket(marketType) ? null : exact[0]?.lineText ?? null, selections: exact };
}

function markets(value: unknown): readonly SbobetCatalogMarket[] {
  return Array.isArray(value) ? value.map(market).filter((item): item is SbobetCatalogMarket => item !== null) : [];
}

function liveTime(value: unknown): string {
  const raw = text(value);
  const clock = raw === null ? null : /^(\d)H\s+(\d{1,3})(?::\d{2})?$/iu.exec(raw);
  return clock === null ? "LIVE" : `${clock[1]}H ${clock[2]}'`;
}

export function extractImFootballCatalog(value: unknown): readonly SbobetCatalogInputRecord[] {
  const root = record(value);
  if (root === null || root.StatusCode !== 100 || !Array.isArray(root.sel)) return [];
  return root.sel.flatMap((candidate): SbobetCatalogInputRecord[] => {
    const item = record(candidate);
    if (item === null || item.iscyb === true) return [];
    const eventId = identifier(item.eid);
    const home = text(item.htn);
    const away = text(item.atn);
    const leagueName = text(item.cn);
    const startAtUtcMs = typeof item.edt === "string" ? Date.parse(item.edt) : Number.NaN;
    if (eventId === null || home === null || away === null || home === away || leagueName === null ||
      !Number.isFinite(startAtUtcMs) || !Array.isArray(item.mls)) return [];
    const acceptedMarkets = markets(item.mls);
    if (acceptedMarkets.length === 0) return [];
    const isLive = item.isrbt === true;
    const scoreText = isLive && Number.isSafeInteger(item.hs) && Number.isSafeInteger(item.as) &&
      Number(item.hs) >= 0 && Number(item.as) >= 0 ? `${item.hs}-${item.as}` : null;
    return [{
      eventId,
      leagueName,
      timeText: isLive ? liveTime(item.rbt) : "PREMATCH",
      scoreText,
      startAtUtcMs,
      teamNames: [home, away],
      markets: acceptedMarkets
    }];
  });
}

export function mergeImFootballDelta(
  previous: readonly SbobetCatalogInputRecord[], value: unknown
): readonly SbobetCatalogInputRecord[] {
  const root = record(value);
  if (root === null || root.StatusCode !== 100 || !Array.isArray(root.dc)) return previous;
  const next = new Map(previous.map((item) => [item.eventId, item]));
  for (const candidate of root.dc) {
    const change = record(candidate);
    const eventId = change === null ? null : identifier(change.eid);
    const current = eventId === null ? undefined : next.get(eventId);
    if (eventId === null || current === undefined) continue;
    if (change?.a === 1) {
      next.delete(eventId);
      continue;
    }
    if (change?.a !== 3 || !Array.isArray(change.v)) continue;
    const changedIds = new Set(change.v.flatMap((item) => {
      const id = identifier(record(item)?.mi);
      return id === null ? [] : [id];
    }));
    const updatedMarkets = [...current.markets.filter((item) => !changedIds.has(item.marketId)), ...markets(change.v)];
    if (updatedMarkets.length === 0) next.delete(eventId);
    else next.set(eventId, { ...current, markets: updatedMarkets });
  }
  return [...next.values()];
}

export function mergeImFootballSnapshots(
  groups: readonly (readonly SbobetCatalogInputRecord[])[]
): readonly SbobetCatalogInputRecord[] {
  const events = new Map<string, SbobetCatalogInputRecord>();
  for (const group of groups) {
    for (const incoming of group) {
      const current = events.get(incoming.eventId);
      if (current === undefined) {
        events.set(incoming.eventId, incoming);
        continue;
      }
      const marketMap = new Map(current.markets.map((market) => [market.marketId, market]));
      for (const market of incoming.markets) marketMap.set(market.marketId, market);
      events.set(incoming.eventId, { ...incoming, markets: [...marketMap.values()] });
    }
  }
  return [...events.values()];
}
