import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";

export interface SbobetCatalogSelection {
  readonly selectionId: string;
  readonly selection: "OVER" | "UNDER" | "HOME" | "DRAW" | "AWAY";
  readonly priceText: string;
  readonly locked: boolean;
  readonly lineText?: string | null;
}

export interface SbobetCatalogMarket {
  readonly marketId: string;
  readonly marketType: "FT_TOTAL" | "FT_1X2" | "FT_AH";
  readonly lineText: string | null;
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
}

export interface NormalizedSbobetCatalog {
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
  readonly diagnostics: readonly string[];
}

function virtualFootballEvidence(competition: string, teams: readonly string[]): boolean {
  const label = competition.normalize("NFKC").toLocaleLowerCase("en");
  if (/(?:e[\s-]?soccer|\bvirtual\b|simulated reality|soccer marble|\bpes\b|ảo|điện tử)/u.test(label)) return true;
  return teams.length === 2 && teams.every((team) => /(?:\((?:pg|e|pes|v|s)\)(?:\s*\([^)]*\))*|\([a-z0-9_]{4,}\))\s*$/iu.test(team));
}

const signedDecimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function canonicalLine(value: string | null): string | null {
  if (value === null) return null;
  const parts = value.trim().split(/[\/-]/u).map(Number);
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 100)) return null;
  return String(parts.reduce((sum, part) => sum + part, 0) / parts.length);
}

function handicapValue(value: string): number | null {
  const match = /^([+-])?(\d+(?:\.\d+)?)(?:\s*[\/-]\s*(\d+(?:\.\d+)?))?$/u.exec(value.trim());
  if (match === null) return null;
  const first = Number(match[2]);
  const second = match[3] === undefined ? first : Number(match[3]);
  if (![first, second].every((part) => Number.isFinite(part) && part >= 0 && part <= 100)) return null;
  const magnitude = (first + second) / 2;
  return match[1] === "-" ? -magnitude : magnitude;
}

function canonicalHomeHandicap(selections: readonly SbobetCatalogSelection[]): string | null {
  if (selections.length !== 2) return null;
  const evidence = selections.flatMap((selection) => {
    const raw = selection.lineText?.trim();
    if (raw === undefined || raw === null || raw.length === 0) return [];
    const parsed = handicapValue(raw);
    if (parsed === null || parsed === 0) return [Number.NaN];
    const selectionLine = /^[+-]/u.test(raw) ? parsed : -Math.abs(parsed);
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
    let invalid = false;
    for (const market of record.markets) {
      const outcomes = market.marketType === "FT_TOTAL" ? ["OVER", "UNDER"] : market.marketType === "FT_AH"
        ? ["HOME", "AWAY"] : ["HOME", "DRAW", "AWAY"];
      const actual = market.selections.map((selection) => selection.selection);
      const ids = new Set(market.selections.map((selection) => selection.selectionId));
      const line = market.marketType === "FT_TOTAL" ? canonicalLine(market.lineText) : market.marketType === "FT_AH"
        ? canonicalHomeHandicap(market.selections) : null;
      const pricesValid = market.selections.every((selection) => market.marketType !== "FT_1X2"
        ? signedDecimal.test(selection.priceText) && Number(selection.priceText) !== 0 && Math.abs(Number(selection.priceText)) <= 1
        : decimal.test(selection.priceText) && Number(selection.priceText) > 1);
      if (market.marketId.trim() === "" || ids.size !== outcomes.length || actual.length !== outcomes.length ||
        outcomes.some((outcome) => !actual.includes(outcome as never)) ||
        ((market.marketType === "FT_TOTAL" || market.marketType === "FT_AH") && line === null) || !pricesValid) {
        invalid = true;
        break;
      }
      const status = market.selections.some((selection) => selection.locked) ? "SUSPENDED" as const : "OPEN" as const;
      recordMarkets.push({
        provider: "SBOBET", category: "FOOTBALL", providerEventId: record.eventId,
        providerMarketId: market.marketId, marketType: market.marketType, scope: "FULL_TIME", line,
        settlementProfile: "football-regulation-including-added-time", status
      });
      recordQuotes.push(...market.selections.map((selection): ProviderQuote => ({
        provider: "SBOBET", category: "FOOTBALL", providerEventId: record.eventId,
        providerMarketId: market.marketId, providerSelectionId: selection.selectionId,
        marketType: market.marketType, scope: "FULL_TIME", selection: selection.selection, line,
        rawOdds: selection.priceText, rawFormat: market.marketType === "FT_1X2" ? "DECIMAL" : "MALAY",
        status, isLive: timing.isLive, sourceTimestampMs: null,
        receivedMonotonicMs: options.receivedMonotonicMs, sequence: options.sequence
      })));
    }
    if (invalid) {
      diagnostics.push("SBOBET_CATALOG_RECORD_REJECTED");
      continue;
    }
    const currentScore = score(record.scoreText);
    const isVirtual = virtualFootballEvidence(record.leagueName, teams);
    events.push({
      provider: "SBOBET", category: "FOOTBALL", providerEventId: record.eventId,
      competition: record.leagueName.trim(), seasonStage: null, startAtUtcMs: timing.startAtUtcMs,
      participantA: teams[0]!, participantB: teams[1]!, eventScope: "REGULATION", bestOf: null,
      isLive: timing.isLive, rematchCandidate: timing.isLive, fixtureDiscriminator: null,
      isVirtual, sportVariant: isVirtual ? "VIRTUAL_FOOTBALL" : "FOOTBALL",
      liveState: timing.isLive ? { period: timing.period, ...currentScore, clockMs: timing.clockMs } : null
    });
    markets.push(...recordMarkets);
    quotes.push(...recordQuotes);
  }
  return { events, markets, quotes, diagnostics };
}
