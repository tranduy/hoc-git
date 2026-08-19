import type { ProviderEvent, ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { isSupportedFootballTwoWayLine } from "../football-market-policy.js";

export interface CmdCatalogOdd {
  readonly marketOddsId: string;
  readonly priceText: string;
  readonly status: string | null;
  readonly greyedOut: string | null;
  readonly lineText?: string | null;
}

export interface CmdCatalogGroup {
  readonly betTypeIds: readonly string[];
  readonly labels: readonly string[];
  readonly odds: readonly CmdCatalogOdd[];
}

export interface CmdCatalogInputRecord {
  readonly sportId: "1" | "43";
  readonly leagueId: string;
  readonly leagueName: string;
  readonly matchId: string;
  readonly timeText: string;
  readonly teamNames: readonly string[];
  readonly groups: readonly CmdCatalogGroup[];
}

export interface CmdCatalogOptions {
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly timezoneOffsetMinutes: number;
  readonly sequence: number;
}

export interface NormalizedCmdCatalog {
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
  readonly diagnostics: readonly string[];
}

const cmdTwoWayMarketSemantics = {
  "1": { marketType: "FT_AH", scope: "FULL_TIME", isHandicap: true,
    settlementProfile: "football-regulation-including-added-time" },
  "3": { marketType: "FT_TOTAL", scope: "FULL_TIME", isHandicap: false,
    settlementProfile: "football-regulation-including-added-time" },
  "7": { marketType: "FH_AH", scope: "FIRST_HALF", isHandicap: true,
    settlementProfile: "football-first-half-including-added-time" },
  "8": { marketType: "FH_TOTAL", scope: "FIRST_HALF", isHandicap: false,
    settlementProfile: "football-first-half-including-added-time" }
} as const;

type CmdEventFamily = "GOALS" | "CORNERS" | "CARDS";

const specialTwoWaySemantics = {
  CORNERS: {
    "1": { marketType: "CORNER_FT_AH", scope: "FULL_TIME", isHandicap: true,
      settlementProfile: "football-corners-regulation" },
    "3": { marketType: "CORNER_FT_TOTAL", scope: "FULL_TIME", isHandicap: false,
      settlementProfile: "football-corners-regulation" },
    "7": { marketType: "CORNER_FH_AH", scope: "FIRST_HALF", isHandicap: true,
      settlementProfile: "football-corners-first-half" },
    "8": { marketType: "CORNER_FH_TOTAL", scope: "FIRST_HALF", isHandicap: false,
      settlementProfile: "football-corners-first-half" }
  },
  CARDS: {
    "1": { marketType: "CARD_FT_AH", scope: "FULL_TIME", isHandicap: true,
      settlementProfile: "football-cards-regulation" },
    "3": { marketType: "CARD_FT_TOTAL", scope: "FULL_TIME", isHandicap: false,
      settlementProfile: "football-cards-regulation" },
    "7": { marketType: "CARD_FH_AH", scope: "FIRST_HALF", isHandicap: true,
      settlementProfile: "football-cards-first-half" },
    "8": { marketType: "CARD_FH_TOTAL", scope: "FIRST_HALF", isHandicap: false,
      settlementProfile: "football-cards-first-half" }
  }
} as const;

function cmdMarketSemantics(betType: string, family: CmdEventFamily) {
  if (family === "GOALS") {
    return cmdTwoWayMarketSemantics[betType as keyof typeof cmdTwoWayMarketSemantics] ?? null;
  }
  return specialTwoWaySemantics[family][betType as keyof typeof specialTwoWaySemantics[typeof family]] ?? null;
}

function removeLoadingSuffix(value: string): string {
  return value.trim().replace(/\s*(?:Ä‘ang\s+táº£i|đang\s+tải)\.\.\.\s*$/iu, "").trim();
}

function normalizedDistinctTeams(rawTeams: readonly string[], suffix?: RegExp): string[] {
  return [...new Map(rawTeams.map((team) => {
    let normalized = team.trim().replace(/\s*\(N\)\s*$/iu, "").trim();
    if (suffix !== undefined) normalized = normalized.replace(suffix, "").trim();
    return normalized;
  }).filter((team) => team.length > 0).map((team) => [team.toLocaleLowerCase("en-US"), team])).values()];
}

function classifyCmdEvent(rawCompetition: string, rawTeams: readonly string[]): {
  readonly competition: string;
  readonly teams: readonly string[];
  readonly family: CmdEventFamily;
} | null {
  const competition = removeLoadingSuffix(rawCompetition);
  const cornerCompetition = /\s*-\s*CORNERS\s*$/iu.test(competition);
  const bookingCompetition = /\s*-\s*BOOKINGS\s*$/iu.test(competition);
  if (cornerCompetition) {
    const suffix = /\s*\(\s*No\.?\s*of\s+Corners\s*\)\s*$/iu;
    if (!rawTeams.every((team) => suffix.test(team))) return null;
    return { competition: competition.replace(/\s*-\s*CORNERS\s*$/iu, "").trim(),
      teams: normalizedDistinctTeams(rawTeams, suffix), family: "CORNERS" };
  }
  if (bookingCompetition) {
    const suffix = /\s*\(\s*Total\s+Bookings\s*\)\s*$/iu;
    if (!rawTeams.every((team) => suffix.test(team))) return null;
    return { competition: competition.replace(/\s*-\s*BOOKINGS\s*$/iu, "").trim(),
      teams: normalizedDistinctTeams(rawTeams, suffix), family: "CARDS" };
  }
  const unsupported = /(?:SPECIFIC\s+\d+\s+MINS|WHICH\s+TEAM\s+WILL\s+ADVANCE|SINGLE\s+TEAM\s+OVER\s*\/\s*UNDER|FANTASY\s+MATCHES)/iu;
  if (unsupported.test(competition) || rawTeams.some((team) => unsupported.test(team)) ||
    /\b(?:CORNERS?|BOOKINGS?|CARDS?)\b/iu.test(competition) ||
    rawTeams.some((team) => /\((?:\d+(?:ST|ND|RD|TH)\s+)?(?:CORNER|BOOKING|CARD)S?\)\s*$/iu.test(team))) return null;
  return { competition, teams: normalizedDistinctTeams(rawTeams), family: "GOALS" };
}

function virtualFootballEvidence(competition: string, teams: readonly string[]): boolean {
  const label = competition.normalize("NFKC").toLocaleLowerCase("en");
  if (/(?:soccer marble|e[\s-]?soccer|\bvirtual\b|simulated reality|spinner world cup|\bpes\b|ảo|điện tử)/u.test(label)) return true;
  return teams.length === 2 && teams.every((team) => /(?:\((?:pg|e|pes|v|s)\)(?:\s*\([^)]*\))*|\([a-z0-9_]{4,}\))\s*$/iu.test(team));
}

const signedDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function line(labels: readonly string[]): string | null {
  const candidate = labels.find((label) => /^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/u.test(label));
  if (candidate === undefined) return null;
  const parts = candidate.split("/").map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0 || part > 100)) return null;
  const value = parts.reduce((sum, part) => sum + part, 0) / parts.length;
  return Number.isFinite(value) ? String(value) : null;
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

function canonicalHomeHandicap(odds: readonly CmdCatalogOdd[]): string | null {
  if (odds.length !== 2) return null;
  const evidence = odds.flatMap((odd, index) => {
    const raw = odd.lineText?.trim();
    if (raw === undefined || raw === null || raw.length === 0) return [];
    const parsed = handicapValue(raw);
    if (parsed === null || parsed === 0) return [Number.NaN];
    const explicitSign = /^[+-]/u.test(raw);
    const selectionLine = explicitSign ? parsed : -Math.abs(parsed);
    return [index === 0 ? selectionLine : -selectionLine];
  });
  if (evidence.length === 0 || evidence.some((value) => !Number.isFinite(value)) ||
    evidence.some((value) => value !== evidence[0])) return null;
  return String(evidence[0]);
}

function eventTime(timeText: string, options: CmdCatalogOptions): {
  readonly startAtUtcMs: number;
  readonly isLive: boolean;
  readonly period: string | null;
  readonly clockMs: number | null;
} | null {
  const normalized = timeText.trim().toUpperCase();
  const stoppageClock = /^(\d)H(\d+)'\+\d+$/u.exec(normalized);
  if (stoppageClock !== null) {
    return {
      startAtUtcMs: options.observedAtMs,
      isLive: true,
      period: `${stoppageClock[1]}H`,
      clockMs: Number(stoppageClock[2]) * 60_000
    };
  }
  if (normalized === "TRỰC TIẾP" || normalized === "LIVE" || /^\dH\d+'$/u.test(normalized)) {
    const clock = /^(\d)H(\d+)'$/u.exec(normalized);
    return {
      startAtUtcMs: options.observedAtMs,
      isLive: true,
      period: clock === null ? null : `${clock[1]}H`,
      clockMs: clock === null ? null : Number(clock[2]) * 60_000
    };
  }
  const todayClock = /^(\d{1,2}):(\d{2})(?:LIVE)?$/u.exec(normalized);
  if (todayClock !== null) {
    const hour = Number(todayClock[1]);
    const minute = Number(todayClock[2]);
    if (hour > 23 || minute > 59) return null;
    const providerNow = new Date(options.observedAtMs + options.timezoneOffsetMinutes * 60_000);
    const timestamp = Date.UTC(providerNow.getUTCFullYear(), providerNow.getUTCMonth(),
      providerNow.getUTCDate(), hour, minute) - options.timezoneOffsetMinutes * 60_000;
    return { startAtUtcMs: timestamp, isLive: false, period: null, clockMs: null };
  }
  const match = /^(\d{2})\/(\d{2})\s*(\d{1,2}):(\d{2})(AM|PM)?$/u.exec(normalized);
  if (match === null) return null;
  const observed = new Date(options.observedAtMs);
  const month = Number(match[1]);
  const day = Number(match[2]);
  let hour = Number(match[3]);
  const meridiem = match[5];
  if (meridiem !== undefined) {
    hour %= 12;
    if (meridiem === "PM") hour += 12;
  }
  const minute = Number(match[4]);
  if (hour > 23 || minute > 59) return null;
  let year = observed.getUTCFullYear();
  let timestamp = Date.UTC(year, month - 1, day, hour, minute) - options.timezoneOffsetMinutes * 60_000;
  if (timestamp < options.observedAtMs - 180 * 86_400_000) {
    year += 1;
    timestamp = Date.UTC(year, month - 1, day, hour, minute) - options.timezoneOffsetMinutes * 60_000;
  }
  const providerDate = new Date(timestamp + options.timezoneOffsetMinutes * 60_000);
  if (providerDate.getUTCMonth() !== month - 1 || providerDate.getUTCDate() !== day) return null;
  return { startAtUtcMs: timestamp, isLive: false, period: null, clockMs: null };
}

function commonMarketStatus(group: CmdCatalogGroup): "OPEN" | "SUSPENDED" {
  return group.odds.some((odd) => odd.greyedOut?.toLowerCase() === "true") ? "SUSPENDED" : "OPEN";
}

function exactMarketId(group: CmdCatalogGroup, expectedSelections: number): string | null {
  if (group.odds.length !== expectedSelections) return null;
  const ids = [...new Set(group.odds.map((odd) => odd.marketOddsId.trim()))];
  return ids.length === 1 && ids[0]!.length > 0 ? ids[0]! : null;
}

function validMalay(value: string): boolean {
  if (!signedDecimalPattern.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0 && Math.abs(numeric) <= 1;
}

export function normalizeObservedFootballCatalog(
  provider: ProviderId,
  records: readonly CmdCatalogInputRecord[],
  options: CmdCatalogOptions
): NormalizedCmdCatalog {
  const events: ProviderEvent[] = [];
  const markets: ProviderMarket[] = [];
  const quotes: ProviderQuote[] = [];
  const diagnostics: string[] = [];
  if (!Number.isFinite(options.observedAtMs) || !Number.isFinite(options.receivedMonotonicMs) ||
    !Number.isFinite(options.timezoneOffsetMinutes) || !Number.isSafeInteger(options.sequence)) {
    return { events, markets, quotes, diagnostics: ["CMD_CATALOG_OPTIONS_INVALID"] };
  }

  for (const record of records) {
    const timing = eventTime(record.timeText, options);
    const classified = classifyCmdEvent(record.leagueName, record.teamNames);
    const teams = classified?.teams ?? [];
    const supported = record.groups.filter((group) => group.betTypeIds.length === 1 &&
      classified !== null && cmdMarketSemantics(group.betTypeIds[0]!, classified.family) !== null &&
      (!cmdMarketSemantics(group.betTypeIds[0]!, classified.family)!.isHandicap ||
        group.odds.some((odd) => odd.lineText !== undefined)));
    const invalid = record.sportId !== "1" || record.matchId.trim().length === 0 || record.leagueName.trim().length === 0 ||
      teams.length !== 2 || teams[0] === teams[1] || timing === null;
    const recordMarkets: ProviderMarket[] = [];
    const recordQuotes: ProviderQuote[] = [];
    if (classified === null) {
      diagnostics.push("CMD_CATALOG_EVENT_UNSUPPORTED");
      continue;
    }
    if (invalid) {
      diagnostics.push("CMD_CATALOG_RECORD_REJECTED");
      continue;
    }
    if (virtualFootballEvidence(classified.competition, teams)) {
      diagnostics.push("CMD_CATALOG_EVENT_UNSUPPORTED");
      continue;
    }
    for (const group of supported) {
      const betType = group.betTypeIds[0]!;
      const semantics = cmdMarketSemantics(betType, classified.family)!;
      const selections = semantics.isHandicap ? ["HOME", "AWAY"] as const : ["OVER", "UNDER"] as const;
      const marketId = exactMarketId(group, selections.length);
      const marketLine = semantics.isHandicap ? canonicalHomeHandicap(group.odds) : line(group.labels);
      const pricesValid = group.odds.every((odd) => validMalay(odd.priceText));
      if (marketId === null || !isSupportedFootballTwoWayLine(marketLine) || !pricesValid) {
        diagnostics.push("CMD_CATALOG_MARKET_REJECTED");
        continue;
      }
      const { marketType, scope, settlementProfile } = semantics;
      const status = commonMarketStatus(group);
      recordMarkets.push({
        provider, category: "FOOTBALL", providerEventId: record.matchId,
        providerMarketId: marketId, marketType, scope, line: marketLine,
        settlementProfile, status
      });
      recordQuotes.push(...group.odds.map((odd, index): ProviderQuote => ({
        provider, category: "FOOTBALL", providerEventId: record.matchId,
        providerMarketId: marketId, providerSelectionId: `${marketId}:${selections[index]!.toLowerCase()}`,
        marketType, scope, selection: selections[index]!, line: marketLine,
        rawOdds: odd.priceText, rawFormat: "MALAY",
        status, isLive: timing!.isLive, sourceTimestampMs: null,
        receivedMonotonicMs: options.receivedMonotonicMs, sequence: options.sequence
      })));
    }
    if (supported.length > 0 && recordMarkets.length === 0) continue;
    events.push({
      provider, category: "FOOTBALL", providerEventId: record.matchId,
      competition: classified.competition, seasonStage: null, startAtUtcMs: timing!.startAtUtcMs,
      participantA: teams[0]!, participantB: teams[1]!, eventScope: "REGULATION", bestOf: null,
      isLive: timing!.isLive, rematchCandidate: timing!.isLive, fixtureDiscriminator: null,
      isVirtual: false, sportVariant: "FOOTBALL",
      liveState: timing!.isLive ? { period: timing!.period, scoreHome: null, scoreAway: null, clockMs: timing!.clockMs } : null
    });
    markets.push(...recordMarkets);
    quotes.push(...recordQuotes);
  }
  return { events, markets, quotes, diagnostics };
}

export function normalizeCmdCatalog(
  records: readonly CmdCatalogInputRecord[],
  options: CmdCatalogOptions
): NormalizedCmdCatalog {
  return normalizeObservedFootballCatalog("CMD", records, options);
}
