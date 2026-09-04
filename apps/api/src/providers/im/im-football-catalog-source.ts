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

export function normalizeImOdds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0 || value < -1) return null;
  const normalized = value > 1 ? -1 / value : value;
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(String(normalized)) ? normalized : null;
}

type ImFootballMarketType = "FT_AH" | "FT_TOTAL" | "FH_AH" | "FH_TOTAL" | "SH_AH" | "SH_TOTAL";

function isHandicapMarket(marketType: ImFootballMarketType): boolean {
  return marketType === "FT_AH" || marketType === "FH_AH" || marketType === "SH_AH";
}

function selection(value: unknown, marketType: ImFootballMarketType): SbobetCatalogSelection | null {
  const item = record(value);
  const isHandicap = isHandicapMarket(marketType);
  const expected = isHandicap ? [1, 2] : [3, 4];
  if (item === null || !expected.includes(Number(item.si)) || !supportedLine(item.hdp)) return null;
  const normalizedOdds = normalizeImOdds(item.o);
  if (normalizedOdds === null) return null;
  const selectionId = identifier(item.wsi);
  const lineText = text(item.dih);
  if (selectionId === null || lineText === null) return null;
  return {
    selectionId,
    selection: isHandicap ? (item.si === 1 ? "HOME" : "AWAY")
      : (item.si === 3 ? "OVER" : "UNDER"),
    priceText: String(normalizedOdds),
    locked: false,
    lineText
  };
}

function market(value: unknown): SbobetCatalogMarket | null {
  const item = record(value);
  if (item === null || (item.bti !== 1 && item.bti !== 2) || ![1, 2, 3].includes(Number(item.gp)) ||
    !Array.isArray(item.ws) || item.ws.length !== 2) return null;
  const marketId = identifier(item.mi);
  const marketType: ImFootballMarketType = item.gp === 1
    ? item.bti === 1 ? "FT_AH" : "FT_TOTAL"
    : item.gp === 2
      ? item.bti === 1 ? "FH_AH" : "FH_TOTAL"
      : item.bti === 1 ? "SH_AH" : "SH_TOTAL";
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

function validDeltaMarket(value: unknown): boolean {
  const item = record(value);
  if (item === null || identifier(item.mi) === null || typeof item.bti !== "number" ||
    !Number.isSafeInteger(item.bti) || typeof item.gp !== "number" || !Number.isSafeInteger(item.gp) ||
    !Array.isArray(item.ws)) return false;
  const supportedDomain = [1, 2].includes(item.bti) && [1, 2, 3].includes(item.gp);
  if (!supportedDomain) return true;
  if (item.ws.length !== 2) return false;
  const expectedSelections = item.bti === 1 ? new Set([1, 2]) : new Set([3, 4]);
  const actualSelections = new Set<number>();
  for (const candidate of item.ws) {
    const selection = record(candidate);
    if (selection === null || identifier(selection.wsi) === null || typeof selection.si !== "number" ||
      !expectedSelections.has(selection.si) || actualSelections.has(selection.si) ||
      !isLineFieldWellFormed(selection.hdp) ||
      text(selection.dih) === null || normalizeImOdds(selection.o) === null) return false;
    actualSelections.add(selection.si);
  }
  return actualSelections.size === 2;
}

/**
 * A selection with no `hdp` key at all is a supported-domain market whose line
 * the provider has not published yet. Measured 2026-09-01 on imsports GetSE
 * Market 2: 11 of 11 976 in-domain markets arrived that way, every other
 * field intact. `market()` already excludes such a market from the catalog
 * (`supportedLine(undefined)` is false), so the absence is an explained
 * provider-domain exclusion, not malformed evidence. A present but non-numeric
 * or absurd line is still malformed.
 */
export function isLineFieldWellFormed(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100);
}

export function isValidImFootballDelta(value: unknown): boolean {
  const root = record(value);
  if (root === null || root.StatusCode !== 100 || !Array.isArray(root.dc)) return false;
  return root.dc.every((candidate) => {
    const change = record(candidate);
    if (change === null || identifier(change.eid) === null) return false;
    if (change.a === 1 || change.a === 2) return true;
    return change.a === 3 && Array.isArray(change.v) && change.v.every(validDeltaMarket);
  });
}

function liveTime(value: unknown): string {
  const raw = text(value);
  const clock = raw === null ? null : /^(\d)H\s+(\d{1,3})(?::\d{2})?$/iu.exec(raw);
  return clock === null ? "LIVE" : `${clock[1]}H ${clock[2]}'`;
}

export interface ImFootballCatalogWindow {
  readonly nowMs: number;
}

export function extractImFootballCatalog(
  value: unknown,
  window?: ImFootballCatalogWindow
): readonly SbobetCatalogInputRecord[] {
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
    const isLive = item.isrbt === true;
    if (eventId === null || home === null || away === null || home === away || leagueName === null ||
      !Number.isFinite(startAtUtcMs) || !Array.isArray(item.mls)) return [];
    if (!isLive && window !== undefined && startAtUtcMs < window.nowMs) return [];
    const acceptedMarkets = markets(item.mls);
    if (acceptedMarkets.length === 0) return [];
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
  if (!isValidImFootballDelta(value)) return previous;
  const root = record(value);
  if (root === null || !Array.isArray(root.dc)) return previous;
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
