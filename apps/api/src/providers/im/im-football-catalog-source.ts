import { isSupportedFootballTwoWayLine, isSupportedFootballSplitLine,
  type SbobetCatalogInputRecord, type SbobetCatalogMarket, type SbobetCatalogSelection } from "@tool-chenh/adapters";
import { type FootballBinaryOutcome, type FootballResultSelection,
  type MarketType, type NativeMarketObservation, type OddsFormat } from "@tool-chenh/contracts";

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

interface ImFootballMarketSemantics {
  readonly marketType: MarketType;
  readonly outcomes: ReadonlyMap<number, FootballBinaryOutcome | FootballResultSelection>;
  readonly linePolicy: "LINE" | "NONE";
  readonly handicap: boolean;
  readonly specifierTotal?: boolean;
}

/** IM publishes mixed formats per selection even when the request asks for one format. */
export function normalizeImSelectionPrice(value: unknown): { priceText: string; priceFormat: OddsFormat } | null {
  const item = record(value);
  const price = item?.o;
  if (item === null || typeof price !== "number" || !Number.isFinite(price)) return null;
  if (item.ot === undefined) {
    const legacy = normalizeImOdds(price);
    return legacy === null ? null : { priceText: String(legacy), priceFormat: "MALAY" };
  }
  let normalized = price;
  let priceFormat: OddsFormat;
  switch (item.ot) {
    case 1: if (price === 0 || Math.abs(price) > 1) return null; priceFormat = "MALAY"; break;
    case 2: if (price <= 0) return null; priceFormat = "HK"; break;
    case 3: if (price <= 1) return null; priceFormat = "DECIMAL"; break;
    case 4:
      if (Math.abs(price) < 1) return null;
      normalized = price > 0 ? 1 + price : 1 - 1 / price;
      priceFormat = "DECIMAL"; break;
    case 6: if (Math.abs(price) < 100) return null; priceFormat = "AMERICAN"; break;
    default: return null;
  }
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(String(normalized))
    ? { priceText: String(normalized), priceFormat } : null;
}

export function imMarketObservedAtMs(value: unknown, envelopeObservedAtMs: number): number | null {
  const item = record(value);
  if (item?.fieldlineObservedAtMs === undefined) return envelopeObservedAtMs;
  const receipt = item.fieldlineObservedAtMs;
  return typeof receipt === "number" && Number.isFinite(receipt) && receipt >= 0 && receipt <= envelopeObservedAtMs
    ? receipt : null;
}

function nativeScalar(value: unknown, maximum: number): string | null {
  const result = typeof value === "number" && Number.isFinite(value) ? String(value)
    : typeof value === "string" ? value.trim() : null;
  return result !== null && result.length > 0 && result.length <= maximum ? result : null;
}

function outcomeMap(...entries: ReadonlyArray<readonly [number, FootballBinaryOutcome]>):
ReadonlyMap<number, FootballBinaryOutcome> {
  return new Map(entries);
}

const handicapOutcomes = outcomeMap([1, "HOME"], [2, "AWAY"]);
const totalOutcomes = outcomeMap([3, "OVER"], [4, "UNDER"]);
const oddEvenOutcomes = outcomeMap([10, "ODD"], [11, "EVEN"]);
const yesNoOutcomes = (yes: number, no: number) => outcomeMap([yes, "YES"], [no, "NO"]);
const customOddEvenOutcomes = (odd: number, even: number) => outcomeMap([odd, "ODD"], [even, "EVEN"]);
const customTotalOutcomes = (under: number, over: number) => outcomeMap([under, "UNDER"], [over, "OVER"]);

function periodMarket(gp: number, full: MarketType, first: MarketType, second?: MarketType): MarketType | null {
  return gp === 1 ? full : gp === 2 ? first : gp === 3 ? second ?? null : null;
}

function imMarketSemantics(bti: number, gp: number): ImFootballMarketSemantics | null {
  const line = (marketType: MarketType, outcomes: ReadonlyMap<number, FootballBinaryOutcome>, handicap = false):
  ImFootballMarketSemantics => ({ marketType, outcomes, linePolicy: "LINE", handicap });
  const noLine = (marketType: MarketType, outcomes: ReadonlyMap<number, FootballBinaryOutcome>):
  ImFootballMarketSemantics => ({ marketType, outcomes, linePolicy: "NONE", handicap: false });
  if (bti === 1) {
    const marketType = periodMarket(gp, "FT_AH", "FH_AH", "SH_AH");
    return marketType === null ? null : line(marketType, handicapOutcomes, true);
  }
  if (bti === 2) {
    const marketType = periodMarket(gp, "FT_TOTAL", "FH_TOTAL", "SH_TOTAL");
    return marketType === null ? null : line(marketType, totalOutcomes);
  }
  if (bti === 5) {
    const marketType = periodMarket(gp, "FT_ODD_EVEN", "FH_ODD_EVEN", "SH_ODD_EVEN");
    return marketType === null ? null : noLine(marketType, oddEvenOutcomes);
  }
  if (bti === 18) {
    const marketType = periodMarket(gp, "FT_BTTS", "FH_BTTS", "SH_BTTS");
    return marketType === null ? null : noLine(marketType, yesNoOutcomes(87, 88));
  }
  if (bti === 3) {
    const marketType = periodMarket(gp, "FT_1X2", "FH_1X2", "SH_1X2");
    return marketType === null ? null : { marketType, linePolicy: "NONE", handicap: false,
      outcomes: new Map<number, FootballBinaryOutcome | "DRAW">([[5, "HOME"], [6, "AWAY"], [7, "DRAW"]]) };
  }
  // Public IM selection enum: _1X=43, _X2=44, _12=45. Native array order varies.
  if (bti === 8) {
    const marketType = periodMarket(gp, "FT_DOUBLE_CHANCE", "FH_DOUBLE_CHANCE", "SH_DOUBLE_CHANCE");
    return marketType === null ? null : { marketType, outcomes: new Map([[43, "HOME_DRAW"], [44, "DRAW_AWAY"], [45, "HOME_AWAY"]]),
      linePolicy: "NONE", handicap: false };
  }
  if (bti === 160 || bti === 161) {
    const marketType = bti === 160 ? periodMarket(gp, "HOME_FT_TOTAL", "HOME_FH_TOTAL")
      : periodMarket(gp, "AWAY_FT_TOTAL", "AWAY_FH_TOTAL");
    return marketType === null ? null : line(marketType, bti === 160
      ? outcomeMap([638, "OVER"], [639, "UNDER"]) : outcomeMap([640, "OVER"], [641, "UNDER"]));
  }
  if (gp !== 1 && bti !== 299 && bti !== 306) return null;
  switch (bti) {
    case 19: return noLine("HOME_FT_WIN_EITHER_HALF", yesNoOutcomes(89, 90));
    case 20: return noLine("AWAY_FT_WIN_EITHER_HALF", yesNoOutcomes(91, 92));
    case 22: return noLine("HOME_FT_CLEAN_SHEET", yesNoOutcomes(97, 98));
    case 23: return noLine("AWAY_FT_CLEAN_SHEET", yesNoOutcomes(99, 100));
    case 24: return { ...line("FT_BOTH_HALVES_OVER_TOTAL", yesNoOutcomes(101, 102)), specifierTotal: true };
    case 25: return { ...line("FT_BOTH_HALVES_UNDER_TOTAL", yesNoOutcomes(103, 104)), specifierTotal: true };
    case 26: return noLine("HOME_FT_WIN_BOTH_HALVES", yesNoOutcomes(105, 106));
    case 27: return noLine("AWAY_FT_WIN_BOTH_HALVES", yesNoOutcomes(107, 108));
    case 31: return line("HOME_FT_TOTAL", customTotalOutcomes(118, 119));
    case 32: return line("AWAY_FT_TOTAL", customTotalOutcomes(120, 121));
    case 33: return noLine("HOME_FT_SCORE_BOTH_HALVES", yesNoOutcomes(122, 123));
    case 34: return noLine("AWAY_FT_SCORE_BOTH_HALVES", yesNoOutcomes(124, 125));
    case 42: return noLine("HOME_FT_ODD_EVEN", customOddEvenOutcomes(144, 145));
    case 43: return noLine("AWAY_FT_ODD_EVEN", customOddEvenOutcomes(146, 147));
    case 44: return noLine("HOME_FT_WIN_TO_NIL", yesNoOutcomes(148, 149));
    case 45: return noLine("AWAY_FT_WIN_TO_NIL", yesNoOutcomes(150, 151));
    case 78: return noLine("HOME_FT_TO_WIN", yesNoOutcomes(334, 335));
    case 79: return noLine("AWAY_FT_TO_WIN", yesNoOutcomes(336, 337));
    case 80: return noLine("FT_ANY_TEAM_TO_WIN", yesNoOutcomes(338, 339));
    case 299: {
      const marketType = periodMarket(gp, "CORNER_FT_AH", "CORNER_FH_AH");
      return marketType === null ? null : line(marketType, handicapOutcomes, true);
    }
    case 306: {
      const marketType = periodMarket(gp, "CORNER_FT_TOTAL", "CORNER_FH_TOTAL");
      return marketType === null ? null : line(marketType, totalOutcomes);
    }
    default: return null;
  }
}

function specifierTotal(item: Record<string, unknown>): string | null {
  const match = /^total=(\d+(?:\.\d+)?)$/u.exec(text(item.s) ?? "");
  if (match === null || !supportedLine(Number(match[1]))) return null;
  const total = Number(match[1]);
  if (item.hdp !== undefined && item.hdp !== total) return null;
  if (item.dih !== undefined && Number(item.dih) !== total) return null;
  return String(total);
}

function numericTotalLine(value: unknown): number | null {
  const label = text(value);
  if (label === null || !/^\d+(?:\.\d+)?(?:\s*[\/-]\s*\d+(?:\.\d+)?)?$/u.test(label)) return null;
  const parts = label.split(/[\/-]/u).map(Number);
  if (parts.some(value => !supportedLine(value)) || parts.length > 2 ||
    (parts.length === 2 && !isSupportedFootballSplitLine(parts[0]!, parts[1]!))) return null;
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
}

function consistentTotalLines(items: readonly unknown[], semantics: ImFootballMarketSemantics): boolean {
  if (semantics.linePolicy !== "LINE" || semantics.handicap) return true;
  const values = items.map(value => {
    const item = record(value);
    if (item === null) return null;
    if (semantics.specifierTotal) { const line = specifierTotal(item); return line === null ? null : Number(line); }
    const line = numericTotalLine(item.dih);
    return line !== null && (item.hdp === undefined || item.hdp === line) ? line : null;
  });
  return values.every(value => value !== null && value === values[0]);
}

function selection(value: unknown, semantics: ImFootballMarketSemantics, locked: boolean): SbobetCatalogSelection | null {
  const item = record(value);
  const selected = item === null ? undefined : semantics.outcomes.get(Number(item.si));
  if (item === null || selected === undefined ||
    (semantics.linePolicy === "LINE" && semantics.specifierTotal !== true && !supportedLine(item.hdp))) return null;
  const price = normalizeImSelectionPrice(item);
  if (price === null) return null;
  const selectionId = identifier(item.wsi);
  const lineText = semantics.specifierTotal === true ? specifierTotal(item)
    : semantics.linePolicy === "LINE" ? text(item.dih) : null;
  if (selectionId === null || (semantics.linePolicy === "LINE" && lineText === null)) return null;
  return {
    selectionId,
    selection: selected,
    priceText: price.priceText,
    ...(price.priceFormat === "MALAY" ? {} : { priceFormat: price.priceFormat }),
    locked,
    ...(lineText === null ? {} : { lineText })
  };
}

function market(value: unknown): SbobetCatalogMarket | null {
  const item = record(value);
  const semantics = item === null ? null : imMarketSemantics(Number(item.bti), Number(item.gp));
  if (item === null || semantics === null || !Array.isArray(item.ws) ||
    item.ws.length === 0 || item.ws.length > semantics.outcomes.size) return null;
  const marketId = identifier(item.mi);
  // Public IM L0 mapper uses market.il as isLocked. Missing legacy projection
  // metadata is not evidence that an offer is open.
  const selections = item.ws.map((value) => selection(value, semantics, item.il !== false));
  if (marketId === null || selections.some((item) => item === null)) return null;
  const exact = selections as SbobetCatalogSelection[];
  if (new Set(exact.map((item) => item.selection)).size !== exact.length ||
    new Set(exact.map((item) => item.selectionId)).size !== exact.length) return null;
  if (!consistentTotalLines(item.ws, semantics)) return null;
  const signedSingleHandicap = semantics.handicap && exact.length === 1;
  if (signedSingleHandicap && !/^(?:[+-]\d|0(?:\.0+)?$)/u.test(exact[0]?.lineText ?? "")) return null;
  return { marketId, marketType: semantics.marketType,
    lineText: semantics.handicap || semantics.linePolicy === "NONE" ? null : exact[0]?.lineText ?? null,
    ...(signedSingleHandicap ? { handicapLineFormat: "SIGNED" as const } : {}),
    selections: exact };
}

function markets(value: unknown): readonly SbobetCatalogMarket[] {
  return Array.isArray(value) ? value.map(market).filter((item): item is SbobetCatalogMarket => item !== null) : [];
}

const imKnownExcludedBetTypes = new Set([4, 6, 7, 9, 11, 35, 38, 39, 158, 159, 313]);

export function observeNativeImFootballMarkets(value: unknown, observedAtMs: number):
readonly NativeMarketObservation[] {
  const root = record(value);
  if (root === null || root.StatusCode !== 100 || !Array.isArray(root.sel) || !Number.isFinite(observedAtMs)) return [];
  const observations: NativeMarketObservation[] = [];
  for (const [eventIndex, candidate] of root.sel.entries()) {
    const event = record(candidate);
    if (event === null || !Array.isArray(event.mls)) continue;
    const providerEventId = identifier(event.eid) ?? `UNKNOWN_EVENT_${eventIndex}`;
    const eventComparable = identifier(event.eid) !== null && event.iscyb === false && text(event.htn) !== null &&
      text(event.atn) !== null && text(event.htn) !== text(event.atn) && text(event.cn) !== null;
    for (const [marketIndex, candidateMarket] of event.mls.entries()) {
      const item = record(candidateMarket);
      const bti = Number(item?.bti);
      const gp = Number(item?.gp);
      const nativeType = Number.isSafeInteger(bti) ? `bti=${bti}` : "bti=UNKNOWN";
      const nativeScope = Number.isSafeInteger(gp) ? `gp=${gp}` : null;
      const providerMarketId = identifier(item?.mi) ?? `${providerEventId}:native:${nativeType}:${marketIndex}`;
      const semantics = Number.isSafeInteger(bti) && Number.isSafeInteger(gp) ? imMarketSemantics(bti, gp) : null;
      const normalized = market(item);
      const selections = Array.isArray(item?.ws) ? item.ws : [];
      const marketObservedAtMs = imMarketObservedAtMs(item, observedAtMs);
      if (marketObservedAtMs === null) continue;
      const rawOutcomeLabels = selections.map((candidateSelection, selectionIndex) => {
        const rawSelection = record(candidateSelection);
        const selectionId = Number(rawSelection?.si);
        return semantics?.outcomes.get(selectionId) ??
          (Number.isSafeInteger(selectionId) ? String(selectionId) : `OUTCOME_${selectionIndex + 1}`);
      });
      const knownExcluded = Number.isSafeInteger(bti) && imKnownExcludedBetTypes.has(bti);
      const disposition: NativeMarketObservation["disposition"] = !eventComparable || knownExcluded ||
        (semantics !== null && normalized === null) ? "EXCLUDED" : semantics === null ? "UNMAPPED" : "NORMALIZED";
      const reason = !eventComparable ? "EVENT_NOT_COMPARABLE"
        : knownExcluded ? (bti === 4 || bti === 39 ? "PUSH_OR_REFUND_SETTLEMENT"
          : bti === 3 ? "THREE_WAY_OUTCOME_DOMAIN" : "NON_BINARY_OUTCOME_DOMAIN")
        : semantics === null ? "NATIVE_TYPE_UNMAPPED"
        : normalized === null ? "INVALID_TWO_WAY_SHAPE" : "CANONICAL_MARKET_MAPPED";
      const labels = selections.flatMap((candidateSelection) => {
        const label = text(record(candidateSelection)?.dih);
        return label === null ? [] : [label];
      });
      observations.push({ provider: "IM", category: "FOOTBALL", providerEventId, providerMarketId,
        ...(typeof item?.il === "boolean" ? { status: item.il ? "SUSPENDED" as const : "OPEN" as const } : {}),
        nativeType, nativeLabel: [...new Set(labels)].join(" | ").slice(0, 512) || null, nativeScope,
        outcomeLabels: rawOutcomeLabels, observedAtMs: marketObservedAtMs, disposition, reason,
        nativeSelections: selections.map(candidateSelection => {
          const selected = record(candidateSelection);
          return { selectionId: nativeScalar(selected?.wsi, 256), outcomeId: nativeScalar(selected?.si, 256),
            line: nativeScalar(selected?.dih, 512) ?? nativeScalar(selected?.hdp, 512) ??
              (semantics?.specifierTotal && selected !== null ? specifierTotal(selected) : null),
            price: nativeScalar(selected?.o, 128),
            ...(selected?.ot === 1 ? { rawFormat: "MALAY" as const }
              : selected?.ot === 2 ? { rawFormat: "HK" as const }
              : selected?.ot === 3 ? { rawFormat: "DECIMAL" as const }
              : selected?.ot === 6 ? { rawFormat: "AMERICAN" as const }
              : selected?.ot === undefined && typeof selected?.o === "number" && Number.isFinite(selected.o) && selected.o !== 0
                ? { rawFormat: selected.o > 0 ? "HK" as const : "MALAY" as const } : {}) };
        }) });
    }
  }
  return observations;
}

function validDeltaMarket(value: unknown): boolean {
  const item = record(value);
  if (item === null || identifier(item.mi) === null || typeof item.bti !== "number" ||
    !Number.isSafeInteger(item.bti) || typeof item.gp !== "number" || !Number.isSafeInteger(item.gp) ||
    !Array.isArray(item.ws)) return false;
  const semantics = imMarketSemantics(item.bti, item.gp);
  const supportedDomain = semantics !== null;
  if (!supportedDomain) return true;
  if (item.ws.length === 0 || item.ws.length > semantics.outcomes.size) return false;
  const actualSelections = new Set<number>();
  for (const candidate of item.ws) {
    const itemSelection = record(candidate);
    const selectionId = Number(itemSelection?.si);
    if (itemSelection === null || identifier(itemSelection.wsi) === null || !semantics.outcomes.has(selectionId) ||
      actualSelections.has(selectionId) || normalizeImSelectionPrice(itemSelection) === null ||
      (semantics.linePolicy === "LINE" && (semantics.specifierTotal === true
        ? specifierTotal(itemSelection) === null
        : !isLineFieldWellFormed(itemSelection.hdp) || text(itemSelection.dih) === null))) return false;
    actualSelections.add(selectionId);
  }
  return actualSelections.size === item.ws.length && consistentTotalLines(item.ws, semantics);
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
