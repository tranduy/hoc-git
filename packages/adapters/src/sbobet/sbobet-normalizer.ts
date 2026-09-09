import { footballBinaryMarketSpec, footballResultMarketSpec, footballCategoricalMarketSpec, isFootballCategoricalSelection,
  type MarketType, type OddsFormat,
  type ProviderEvent, type ProviderMarket, type ProviderQuote, type Scope } from "@tool-chenh/contracts";
import { isSupportedFootballSplitLine, isSupportedFootballTwoWayLine } from "../football-market-policy.js";

export interface SbobetCatalogSelection {
  readonly selectionId: string;
  readonly selection: string;
  readonly priceText: string;
  readonly priceFormat?: OddsFormat;
  readonly locked: boolean;
  readonly lineText?: string | null;
}

export interface SbobetCatalogMarket {
  readonly marketId: string;
  readonly marketType: MarketType;
  readonly lineText: string | null;
  /** Native numeric lines already carry HOME/AWAY orientation; DOM labels do not. */
  readonly handicapLineFormat?: "SIGNED";
  readonly selections: readonly SbobetCatalogSelection[];
}

export interface SbobetCatalogInputRecord {
  readonly eventId: string;
  readonly leagueName: string;
  readonly timeText: string;
  readonly scoreText: string | null;
  readonly startAtUtcMs?: number | null;
  readonly teamNames: readonly string[];
  readonly markets: readonly SbobetCatalogMarket[];
}

export interface SbobetCatalogOptions {
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
  readonly provider?: "SBOBET" | "APSPORT" | "BTI" | "IM";
  readonly settlementProfile?: string;
}

export interface NormalizedSbobetCatalog {
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
  readonly diagnostics: readonly string[];
}

function virtualFootballEvidence(competition: string, teams: readonly string[]): boolean {
  const label = competition.normalize("NFKC").toLocaleLowerCase("en");
  if (/(?:\be[\s-]?soccer\b|\bvirtual\b|simulated reality|soccer marble|\bpes\b|(?<![\p{L}\p{M}\p{N}_])ảo(?![\p{L}\p{M}\p{N}_])|điện tử)/u.test(label)) return true;
  return teams.length === 2 && teams.every((team) => /(?:\((?:pg|e|pes|v|s)\)(?:\s*\([^)]*\))*|\([a-z0-9_]{4,}\))\s*$/iu.test(team));
}

const signedDecimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function exactFootballMarketSemantics(marketType: MarketType, fallbackProfile?: string): {
  readonly isTotal: boolean; readonly isHandicap: boolean; readonly scope: Scope;
  readonly outcomes: readonly string[]; readonly linePolicy: "HALF_UNIT" | "NONE";
  readonly partialSelections: boolean;
  readonly settlementProfile: string;
} | null {
  const categorical = footballCategoricalMarketSpec(marketType);
  if (categorical !== null) return { ...categorical, isTotal: false, isHandicap: false,
    outcomes: [], partialSelections: true };
  // A native result selection is meaningful independently of other offers.
  // Eligibility for an opposing ticket is decided from the exact outcome set.
  const result = footballResultMarketSpec(marketType);
  if (result !== null) return {
    isTotal: false, isHandicap: false, scope: result.scope,
    outcomes: result.outcomes, linePolicy: "NONE", partialSelections: true,
    settlementProfile: result.settlementProfile
  };
  const spec = footballBinaryMarketSpec(marketType);
  if (spec === null) return null;
  const defaultRegulation = spec.statistic === "GOALS" && spec.scope === "FULL_TIME" &&
    (marketType === "FT_AH" || marketType === "FT_TOTAL");
  return { isTotal: spec.family === "TOTAL", isHandicap: spec.family === "HANDICAP",
    scope: spec.scope, outcomes: spec.outcomes, linePolicy: spec.linePolicy, partialSelections: true,
    settlementProfile: defaultRegulation ? fallbackProfile ?? spec.settlementProfile : spec.settlementProfile };
}

function validPrice(selection: SbobetCatalogSelection): boolean {
  if (!signedDecimal.test(selection.priceText)) return false;
  const price = Number(selection.priceText);
  if (!Number.isFinite(price)) return false;
  switch (selection.priceFormat ?? "MALAY") {
    case "MALAY": return price !== 0 && Math.abs(price) <= 1;
    case "DECIMAL": return price > 1;
    case "HK": return price > 0;
    case "AMERICAN": return Math.abs(price) >= 100;
  }
}

function canonicalLine(value: string | null): string | null {
  if (value === null || !/^\d+(?:\.\d+)?(?:\s*[\/-]\s*\d+(?:\.\d+)?)?$/u.test(value.trim())) return null;
  const parts = value.trim().split(/[\/-]/u).map(Number);
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 100)) return null;
  if (parts.length === 2 && !isSupportedFootballSplitLine(parts[0]!, parts[1]!)) return null;
  return String(parts.reduce((sum, part) => sum + part, 0) / parts.length);
}

function handicapValue(value: string): number | null {
  const match = /^([+-])?(\d+(?:\.\d+)?)(?:\s*[\/-]\s*(\d+(?:\.\d+)?))?$/u.exec(value.trim());
  if (match === null) return null;
  const first = Number(match[2]);
  const second = match[3] === undefined ? first : Number(match[3]);
  if (![first, second].every((part) => Number.isFinite(part) && part >= 0 && part <= 100)) return null;
  if (match[3] !== undefined && !isSupportedFootballSplitLine(first, second)) return null;
  const magnitude = (first + second) / 2;
  return match[1] === "-" ? -magnitude : magnitude;
}

function canonicalHomeHandicap(selections: readonly SbobetCatalogSelection[], signedNative = false): string | null {
  if (selections.length < 1 || selections.length > 2 || (selections.length === 1 && !signedNative)) return null;
  const evidence = selections.flatMap((selection) => {
    const raw = selection.lineText?.trim();
    if (raw === undefined || raw === null || raw.length === 0) return signedNative ? [Number.NaN] : [];
    const parsed = handicapValue(raw);
    if (parsed === null || (!signedNative && parsed === 0)) return [Number.NaN];
    const selectionLine = signedNative || /^[+-]/u.test(raw) ? parsed : -Math.abs(parsed);
    return [selection.selection === "HOME" ? selectionLine : -selectionLine];
  });
  if (evidence.length === 0 || evidence.some((value) => !Number.isFinite(value)) ||
    evidence.some((value) => value !== evidence[0])) return null;
  return String(evidence[0]);
}

function liveTiming(record: SbobetCatalogInputRecord, observedAtMs: number) {
  const match = /^(\d)H\s*(\d+)'$/iu.exec(record.timeText.trim());
  if (match !== null) return {
    isLive: true,
    startAtUtcMs: observedAtMs,
    period: `${match[1]}H`,
    clockMs: Number(match[2]) * 60_000
  };
  if (/(?:live|trực\s*tiếp|hiệp)/iu.test(record.timeText)) return {
    isLive: true,
    startAtUtcMs: observedAtMs,
    period: /(?:hiệp\s*1|1h)/iu.test(record.timeText) ? "1H"
      : /(?:hiệp\s*2|2h)/iu.test(record.timeText) ? "2H" : null,
    clockMs: null
  };
  if (record.startAtUtcMs !== null && record.startAtUtcMs !== undefined && Number.isFinite(record.startAtUtcMs)) return {
    isLive: false,
    startAtUtcMs: record.startAtUtcMs,
    period: null,
    clockMs: null
  };
  return null;
}

function score(value: string | null): { scoreHome: number | null; scoreAway: number | null } {
  const match = value === null ? null : /^(\d+)\s*-\s*(\d+)$/u.exec(value.trim());
  return match === null ? { scoreHome: null, scoreAway: null } : { scoreHome: Number(match[1]), scoreAway: Number(match[2]) };
}

export function normalizeSbobetCatalog(
  records: readonly SbobetCatalogInputRecord[],
  options: SbobetCatalogOptions
): NormalizedSbobetCatalog {
  const events: ProviderEvent[] = [];
  const markets: ProviderMarket[] = [];
  const quotes: ProviderQuote[] = [];
  const diagnostics: string[] = [];
  const provider = options.provider ?? "SBOBET";
  if (!Number.isFinite(options.observedAtMs) || !Number.isFinite(options.receivedMonotonicMs) || !Number.isSafeInteger(options.sequence)) {
    return { events, markets, quotes, diagnostics: ["SBOBET_CATALOG_OPTIONS_INVALID"] };
  }
  for (const record of records) {
    const teams = record.teamNames.map((team) => team.trim()).filter(Boolean);
    const timing = liveTiming(record, options.observedAtMs);
    const recordMarkets: ProviderMarket[] = [];
    const recordQuotes: ProviderQuote[] = [];
    if (record.eventId.trim() === "" || record.leagueName.trim() === "" || teams.length !== 2 || teams[0] === teams[1] || timing === null) {
      diagnostics.push("SBOBET_CATALOG_RECORD_REJECTED");
      continue;
    }
    if (virtualFootballEvidence(record.leagueName, teams)) {
      diagnostics.push("SBOBET_CATALOG_EVENT_UNSUPPORTED");
      continue;
    }
    let invalid = false;
    for (const market of record.markets) {
      const semantics = exactFootballMarketSemantics(market.marketType, options.settlementProfile);
      if (semantics === null) continue;
      const { isTotal, isHandicap, scope, settlementProfile, outcomes, linePolicy } = semantics;
      const actual = market.selections.map((selection) => selection.selection);
      const ids = new Set(market.selections.map((selection) => selection.selectionId));
      const line = linePolicy === "NONE" ? null : isHandicap
        ? canonicalHomeHandicap(market.selections, market.handicapLineFormat === "SIGNED") : canonicalLine(market.lineText);
      if (linePolicy === "HALF_UNIT" && !isSupportedFootballTwoWayLine(line)) continue;
      const pricesValid = market.selections.every(validPrice);
      const exactDomain = actual.length > 0 && ids.size === actual.length && new Set(actual).size === actual.length &&
        actual.every((outcome) => outcomes.includes(outcome) || isFootballCategoricalSelection(market.marketType, outcome)) &&
        (semantics.partialSelections || actual.length === outcomes.length);
      if (market.marketId.trim() === "" || !exactDomain ||
        (linePolicy === "HALF_UNIT" && line === null) || !pricesValid) {
        invalid = true;
        break;
      }
      const status = (semantics.partialSelections ? market.selections.every((selection) => selection.locked)
        : market.selections.some((selection) => selection.locked)) ? "SUSPENDED" as const : "OPEN" as const;
      recordMarkets.push({
        provider, category: "FOOTBALL", providerEventId: record.eventId,
        providerMarketId: market.marketId, marketType: market.marketType, scope, line,
        settlementProfile, status
      });
      recordQuotes.push(...market.selections.map((selection): ProviderQuote => ({
        provider, category: "FOOTBALL", providerEventId: record.eventId,
        providerMarketId: market.marketId, providerSelectionId: selection.selectionId,
        marketType: market.marketType, scope, selection: selection.selection, line,
        rawOdds: selection.priceText, rawFormat: selection.priceFormat ?? "MALAY",
        status: semantics.partialSelections ? selection.locked ? "SUSPENDED" : "OPEN" : status,
        isLive: timing.isLive, sourceTimestampMs: null,
        receivedMonotonicMs: options.receivedMonotonicMs, sequence: options.sequence
      })));
    }
    if (invalid) {
      diagnostics.push("SBOBET_CATALOG_RECORD_REJECTED");
      continue;
    }
    const currentScore = score(record.scoreText);
    events.push({
      provider, category: "FOOTBALL", providerEventId: record.eventId,
      competition: record.leagueName.trim(), seasonStage: null, startAtUtcMs: timing.startAtUtcMs,
      participantA: teams[0]!, participantB: teams[1]!, eventScope: "REGULATION", bestOf: null,
      isLive: timing.isLive, rematchCandidate: timing.isLive, fixtureDiscriminator: null,
      isVirtual: false, sportVariant: "FOOTBALL",
      liveState: timing.isLive ? { period: timing.period, ...currentScore, clockMs: timing.clockMs } : null
    });
    markets.push(...recordMarkets);
    quotes.push(...recordQuotes);
  }
  return { events, markets, quotes, diagnostics };
}
