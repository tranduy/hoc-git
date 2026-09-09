import type { NativeMarketObservation, OddsFormat, ProviderEvent, ProviderId,
  ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { footballBinaryMarketSpec, footballResultMarketSpec } from "@tool-chenh/contracts";
import { isSupportedFootballSplitLine, isSupportedFootballTwoWayLine } from "../football-market-policy.js";
import { isSabaMultiMatchAggregate } from "../saba/saba-multi-match-aggregate.js";

export interface CmdCatalogOdd {
  readonly marketOddsId: string;
  readonly selectionId?: string;
  readonly priceFormat?: OddsFormat;
  readonly priceText: string;
  readonly status: string | null;
  readonly greyedOut: string | null;
  readonly lineText?: string | null;
}

export interface CmdCatalogGroup {
  readonly betTypeIds: readonly string[];
  readonly labels: readonly string[];
  readonly odds: readonly CmdCatalogOdd[];
  /** Collector-proven limitation; retain the full native group without publishing quotes. */
  readonly normalizationBlockReason?: "NATIVE_MR_ODDS_UNPROVEN" | "NATIVE_MARKET_HIDDEN" | "NATIVE_MARKET_PERMISSION_UNPROVEN" | undefined;
}

export interface CmdCatalogInputRecord {
  readonly sportId: "1" | "43";
  readonly leagueId: string;
  readonly leagueName: string;
  readonly matchId: string;
  readonly timeText: string;
  /** Undefined is a legacy capture; null is an explicitly unproven public timezone. */
  readonly providerTimezoneOffsetMinutes?: number | null;
  readonly teamNames: readonly string[];
  readonly groups: readonly CmdCatalogGroup[];
}

export interface CmdCatalogOptions {
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly timezoneOffsetMinutes: number;
  readonly sequence: number;
  /** Collector-owned provider calendar date; never inferred from terminal time. */
  readonly explicitProviderDate?: string;
  readonly requireExplicitDateForUndatedKickoff?: boolean;
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

type CmdCanonicalOutcome = ProviderQuote["selection"];

interface CmdResolvedSemantics {
  readonly marketType: ProviderMarket["marketType"];
  readonly scope: ProviderMarket["scope"];
  readonly isHandicap: boolean;
  readonly settlementProfile: string;
  readonly linePolicy: "LINE" | "NONE";
  readonly selections: readonly CmdCanonicalOutcome[];
}

function cmdResultType(betType: string, provider: ProviderId): ProviderMarket["marketType"] | null {
  if (betType === "5") return "FT_1X2";
  if (provider === "CMD" && betType === "FH:5" || provider === "SABA" && betType === "15") return "FH_1X2";
  if (provider === "CMD" && betType === "DOUBLE_CHANCE" || provider === "SABA" && betType === "24") return "FT_DOUBLE_CHANCE";
  return null;
}

function normalizedOutcomeLabel(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").trim().toLocaleLowerCase("en-US");
}

function provedOddEvenSelections(group: CmdCatalogGroup): readonly ["ODD", "EVEN"] | readonly ["EVEN", "ODD"] | null {
  if (group.odds.length !== 2) return null;
  const outcomeLabels = group.labels.map(normalizedOutcomeLabel)
    .filter((label) => ["o", "odd", "le", "e", "even", "chan"].includes(label));
  if (outcomeLabels.length !== 2) return null;
  const outcomes = outcomeLabels.map((label) => ["o", "odd", "le"].includes(label) ? "ODD" : "EVEN");
  if (outcomes[0] === outcomes[1]) return null;
  return outcomes as ["ODD", "EVEN"] | ["EVEN", "ODD"];
}

function cmdGroupSemantics(group: CmdCatalogGroup, family: CmdEventFamily, provider: ProviderId): CmdResolvedSemantics | null {
  if (group.betTypeIds.length !== 1) return null;
  const betType = group.betTypeIds[0]!;
  const resultType = family === "GOALS" ? cmdResultType(betType, provider) : null;
  if (resultType !== null) {
    const spec = footballResultMarketSpec(resultType)!;
    const names: Readonly<Record<string, CmdCanonicalOutcome>> = {
      HOME: "HOME", DRAW: "DRAW", AWAY: "AWAY", "1X": "HOME_DRAW", "12": "HOME_AWAY", "X2": "DRAW_AWAY",
      HOME_DRAW: "HOME_DRAW", HOME_AWAY: "HOME_AWAY", DRAW_AWAY: "DRAW_AWAY"
    };
    const selections = group.labels.map(label => names[label.trim().toUpperCase()]);
    if (group.odds.length === 0 || group.odds.length > 3 || selections.length !== group.odds.length ||
      selections.some(value => value === undefined || !spec.outcomes.includes(value as never)) ||
      new Set(selections).size !== selections.length) return null;
    return { marketType: resultType, scope: spec.scope, isHandicap: false,
      settlementProfile: spec.settlementProfile, linePolicy: "NONE", selections: selections as CmdCanonicalOutcome[] };
  }
  const lineSemantics = cmdMarketSemantics(betType, family);
  if (lineSemantics !== null) {
    return { ...lineSemantics, linePolicy: "LINE",
      selections: lineSemantics.isHandicap ? ["HOME", "AWAY"] : ["OVER", "UNDER"] };
  }
  // A CMD/SABA DOM group with native type 2 is only promoted when its two
  // rendered selection labels independently prove the Odd/Even outcome domain.
  // This prevents a coincidental two-price group from being guessed as binary.
  // SABA's published BetType Selection Information names 12 as first-half
  // Odd/Even; 24 is Double Chance. Labels still have to prove each outcome.
  const isFirstHalf = betType === "FH:2" || provider === "SABA" && betType === "12";
  const selections = (["2", "MAIN:2", "FH:2"].includes(betType) || provider === "SABA" && betType === "12") && family !== "CARDS"
    ? provedOddEvenSelections(group) : null;
  if (selections === null) return null;
  const marketType = family === "GOALS"
    ? isFirstHalf ? "FH_ODD_EVEN" : "FT_ODD_EVEN"
    : isFirstHalf ? "CORNER_FH_ODD_EVEN" : "CORNER_FT_ODD_EVEN";
  const spec = footballBinaryMarketSpec(marketType)!;
  return { marketType, scope: spec.scope, isHandicap: false,
    settlementProfile: spec.settlementProfile, linePolicy: "NONE", selections };
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

function observedEventScope(teams: readonly string[]): "REGULATION" | "EXTRA_TIME" | "PENALTY_SHOOTOUT" | "UNKNOWN" {
  // Exact native participant suffixes identify a separately settled event.
  // Keep the suffix in its name; folding is only for this classification.
  const scopes = teams.map(team => {
    const suffix = /\(\s*([^()]*)\s*\)\s*$/u.exec(team)?.[1];
    const marker = suffix === undefined ? "" : normalizedOutcomeLabel(suffix);
    if (/^(?:et|extra\s+time|hiep\s+phu)$/u.test(marker)) return "EXTRA_TIME";
    if (/^(?:pen|penalties|penalty\s+shootout|luan\s+luu)$/u.test(marker)) return "PENALTY_SHOOTOUT";
    return "REGULATION";
  });
  return scopes.every(scope => scope === "REGULATION") ? "REGULATION"
    : scopes.length === 2 && scopes[0] === scopes[1] ? scopes[0]! : "UNKNOWN";
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
  if (parts.length === 2 && !isSupportedFootballSplitLine(parts[0]!, parts[1]!)) return null;
  const value = parts.reduce((sum, part) => sum + part, 0) / parts.length;
  return Number.isFinite(value) ? String(value) : null;
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

function canonicalHomeHandicap(odds: readonly CmdCatalogOdd[], allowZero = false): string | null {
  if (odds.length !== 2) return null;
  const evidence = odds.flatMap((odd, index) => {
    const raw = odd.lineText?.trim();
    if (raw === undefined || raw === null || raw.length === 0) return [];
    const parsed = handicapValue(raw);
    if (parsed === null || (parsed === 0 && !allowZero)) return [Number.NaN];
    const explicitSign = /^[+-]/u.test(raw);
    const selectionLine = explicitSign ? parsed : -Math.abs(parsed);
    return [index === 0 ? selectionLine : -selectionLine];
  });
  if (evidence.length === 0 || evidence.some((value) => !Number.isFinite(value)) ||
    evidence.some((value) => value !== evidence[0])) return null;
  return String(evidence[0]);
}

function undatedStartAt(hour: number, minute: number, options: CmdCatalogOptions): number | null {
  let calendar: Date;
  if (options.explicitProviderDate !== undefined) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(options.explicitProviderDate);
    if (match === null) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day) return null;
  } else {
    if (options.requireExplicitDateForUndatedKickoff === true) return null;
    calendar = new Date(options.observedAtMs + options.timezoneOffsetMinutes * 60_000);
  }
  return Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), calendar.getUTCDate(),
    hour, minute) - options.timezoneOffsetMinutes * 60_000;
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
  // "TRỰC TIẾP" beside a kick-off time is the book advertising a stream on a
  // fixture that has not started - the time is when it will. Read on the SABA
  // lobby 2026-09-01: of 236 rows, 73 carried "TRỰC TIẾP 11:30PM" and only 17 a
  // real clock, and every one of the 73 was published as in-play with no period
  // and no clock. They were then paired as live tickets whose prices never
  // moved, because the matches had not kicked off.
  const streamedKickoff = /^TRỰC TIẾP\s+(\d{1,2}):(\d{2})(AM|PM)?$/u.exec(normalized);
  if (streamedKickoff !== null) {
    const meridiem = streamedKickoff[3];
    const rawHour = Number(streamedKickoff[1]);
    const minute = Number(streamedKickoff[2]);
    if (rawHour > 23 || minute > 59 || (meridiem !== undefined && (rawHour < 1 || rawHour > 12))) return null;
    const hour = meridiem === undefined ? rawHour
      : meridiem === "PM" ? (rawHour % 12) + 12 : rawHour % 12;
    const timestamp = undatedStartAt(hour, minute, options);
    if (timestamp === null) return null;
    return { startAtUtcMs: timestamp, isLive: false, period: null, clockMs: null };
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
  const collectorClock = options.requireExplicitDateForUndatedKickoff === true ||
    options.explicitProviderDate !== undefined ? /^(\d{1,2}):(\d{2})(AM|PM)$/u.exec(normalized) : null;
  if (collectorClock !== null) {
    const rawHour = Number(collectorClock[1]), minute = Number(collectorClock[2]);
    if (rawHour < 1 || rawHour > 12 || minute > 59) return null;
    const hour = rawHour % 12 + (collectorClock[3] === "PM" ? 12 : 0);
    const timestamp = undatedStartAt(hour, minute, options);
    return timestamp === null ? null : { startAtUtcMs: timestamp, isLive: false, period: null, clockMs: null };
  }
  const todayClock = /^(\d{1,2}):(\d{2})(?:LIVE)?$/u.exec(normalized);
  if (todayClock !== null) {
    const hour = Number(todayClock[1]);
    const minute = Number(todayClock[2]);
    if (hour > 23 || minute > 59) return null;
    const timestamp = undatedStartAt(hour, minute, options);
    if (timestamp === null) return null;
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

function validResultPrice(odd: CmdCatalogOdd): boolean {
  if (odd.selectionId !== undefined && odd.selectionId.trim().length === 0) return false;
  if (!signedDecimalPattern.test(odd.priceText)) return false;
  const price = Number(odd.priceText);
  if (!Number.isFinite(price)) return false;
  switch (odd.priceFormat) {
    case "DECIMAL": return price > 1;
    case "MALAY": return price !== 0 && Math.abs(price) <= 1;
    case "HK": return price > 0;
    case "AMERICAN": return Math.abs(price) >= 100;
    default: return false;
  }
}

function oddStatus(odd: CmdCatalogOdd): ProviderQuote["status"] {
  if (odd.status === "CLOSED") return "CLOSED";
  return odd.greyedOut?.toLowerCase() === "true" || odd.status === "SUSPENDED" ? "SUSPENDED" : "OPEN";
}

function recordEventTime(provider: ProviderId, record: CmdCatalogInputRecord, options: CmdCatalogOptions) {
  const offset = record.providerTimezoneOffsetMinutes;
  if (provider !== "SABA" || offset === undefined) return eventTime(record.timeText, options);
  if (offset === null || !Number.isInteger(offset) || Math.abs(offset) > 840) return null;
  return eventTime(record.timeText, { ...options, timezoneOffsetMinutes: offset });
}

export function observeNativeCmdMarkets(
  provider: ProviderId,
  records: readonly CmdCatalogInputRecord[],
  options: CmdCatalogOptions
): readonly NativeMarketObservation[] {
  const observations: NativeMarketObservation[] = [];
  for (const [recordIndex, record] of records.entries()) {
    const classified = classifyCmdEvent(record.leagueName, record.teamNames);
    const unsupportedPeriod = classified !== null && observedEventScope(classified.teams) !== "REGULATION";
    const isSabaAggregate = provider === "SABA" &&
      isSabaMultiMatchAggregate(record.leagueName, record.teamNames);
    const comparableEvent = record.sportId === "1" && record.matchId.trim() !== "" && classified !== null &&
      !virtualFootballEvidence(classified.competition, classified.teams) && !isSabaAggregate &&
      (provider !== "SABA" || recordEventTime(provider, record, options) !== null);
    for (const [groupIndex, group] of record.groups.entries()) {
      const nativeType = group.betTypeIds.length === 0 ? "UNKNOWN" : group.betTypeIds.join("+");
      const uniqueIds = [...new Set(group.odds.map((odd) => odd.marketOddsId.trim()).filter(Boolean))];
      const fallbackId = `${record.matchId || `UNKNOWN_EVENT_${recordIndex}`}:native:${nativeType}:${groupIndex}`;
      const providerMarketId = uniqueIds.length === 1 ? uniqueIds[0]! : fallbackId;
      const semantics = classified === null ? null : cmdGroupSemantics(group, classified.family, provider);
      const marketLine = semantics === null || semantics.linePolicy === "NONE" ? null : semantics.isHandicap
        ? canonicalHomeHandicap(group.odds, provider === "SABA") : line(group.labels);
      const resultMarket = semantics !== null && footballResultMarketSpec(semantics.marketType) !== null;
      const expectedSelections = semantics?.selections.length ?? 2;
      const validResultIds = group.odds.flatMap((odd, index) => validResultPrice(odd)
        ? [odd.selectionId ?? `${providerMarketId}:${semantics?.selections[index]}`] : []);
      const validShape = semantics !== null && exactMarketId(group, expectedSelections) !== null &&
        (semantics.linePolicy === "NONE" || isSupportedFootballTwoWayLine(marketLine)) &&
        (resultMarket ? validResultIds.length > 0 && new Set(validResultIds).size === validResultIds.length
          : group.odds.every((odd) => validMalay(odd.priceText)));
      const threeWay = group.betTypeIds.length === 1 && (nativeType === "5" ||
        provider === "CMD" && nativeType === "FH:5" || provider === "SABA" && nativeType === "15");
      const disposition: NativeMarketObservation["disposition"] = !comparableEvent || unsupportedPeriod || group.normalizationBlockReason !== undefined ||
        group.betTypeIds.length !== 1 || semantics !== null && !validShape || threeWay && !resultMarket
        ? "EXCLUDED" : semantics === null ? "UNMAPPED" : "NORMALIZED";
      const reason = !comparableEvent ? "EVENT_NOT_COMPARABLE"
        : unsupportedPeriod ? "EVENT_PERIOD_SETTLEMENT_UNSUPPORTED"
        : group.normalizationBlockReason !== undefined ? group.normalizationBlockReason
        : group.betTypeIds.length !== 1 ? "AMBIGUOUS_NATIVE_TYPE"
        : resultMarket && !validShape && group.odds.every(odd => odd.priceFormat === undefined) ? "NATIVE_ODDS_FORMAT_UNPROVEN"
        : threeWay && !resultMarket ? "NATIVE_RESULT_OUTCOME_UNPROVEN"
        : semantics === null ? "NATIVE_TYPE_UNMAPPED"
        : !validShape ? "INVALID_TWO_WAY_SHAPE" : "CANONICAL_MARKET_MAPPED";
      const canonicalOutcomes = semantics?.selections ?? ["OUTCOME_1", "OUTCOME_2"];
      const rawFormat = semantics !== null && !resultMarket && group.normalizationBlockReason !== "NATIVE_MR_ODDS_UNPROVEN" ? "MALAY" : undefined;
      observations.push({ provider, category: "FOOTBALL",
        providerEventId: record.matchId || `UNKNOWN_EVENT_${recordIndex}`, providerMarketId,
        nativeType, nativeLabel: group.labels.join(" | ").slice(0, 512) || null,
        nativeScope: semantics?.scope ?? (threeWay ? nativeType === "5" ? "FULL_TIME" : "FIRST_HALF" : null),
        outcomeLabels: group.odds.map((_, index) => canonicalOutcomes[index] ?? `OUTCOME_${index + 1}`),
        // DOM capture provides one market ID for the group, but no native
        // selection ID. Preserve its ordered raw prices without inventing IDs
        // or assigning unlabeled 1X2 slots to HOME, DRAW and AWAY.
        nativeSelections: group.odds.map((odd) => ({ selectionId: odd.selectionId ?? null, outcomeId: null,
          line: odd.lineText ?? null, price: odd.priceText,
          ...(odd.priceFormat === undefined && rawFormat === undefined ? {} : { rawFormat: odd.priceFormat ?? rawFormat }),
          ...(odd.status === "OPEN" || odd.status === "SUSPENDED" || odd.status === "CLOSED" ||
            odd.greyedOut?.toLowerCase() === "true" || odd.greyedOut?.toLowerCase() === "false"
            ? { status: oddStatus(odd) } : {}) })),
        observedAtMs: options.observedAtMs, disposition, reason });
    }
  }
  return observations;
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
    const timing = recordEventTime(provider, record, options);
    const classified = classifyCmdEvent(record.leagueName, record.teamNames);
    const teams = classified?.teams ?? [];
    const eventScope = observedEventScope(teams);
    const supported = record.groups.filter((group) => {
      if (classified === null || eventScope !== "REGULATION" || group.normalizationBlockReason !== undefined) return false;
      const semantics = cmdGroupSemantics(group, classified.family, provider);
      return semantics !== null && (!semantics.isHandicap || group.odds.some((odd) => odd.lineText !== undefined));
    });
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
    if (provider === "SABA" && isSabaMultiMatchAggregate(record.leagueName, record.teamNames)) {
      diagnostics.push("CMD_CATALOG_EVENT_UNSUPPORTED");
      continue;
    }
    if (eventScope !== "REGULATION") diagnostics.push("EVENT_PERIOD_SETTLEMENT_UNSUPPORTED");
    for (const group of supported) {
      const semantics = cmdGroupSemantics(group, classified.family, provider)!;
      const selections = semantics.selections;
      const marketId = exactMarketId(group, selections.length);
      if (footballResultMarketSpec(semantics.marketType) !== null) {
        const valid = group.odds.flatMap((odd, index) => validResultPrice(odd) ? [{ odd, selection: selections[index]! }] : []);
        if (marketId === null || valid.length === 0 || new Set(valid.map(({ odd, selection }) =>
          odd.selectionId ?? `${marketId}:${selection.toLowerCase()}`)).size !== valid.length) {
          diagnostics.push("CMD_CATALOG_MARKET_REJECTED");
          continue;
        }
        const { marketType, scope, settlementProfile } = semantics;
        recordMarkets.push({ provider, category: "FOOTBALL", providerEventId: record.matchId, providerMarketId: marketId,
          marketType, scope, line: null, settlementProfile, status: valid.some(({ odd }) => oddStatus(odd) === "OPEN") ? "OPEN" : "SUSPENDED" });
        recordQuotes.push(...valid.map(({ odd, selection }): ProviderQuote => ({ provider, category: "FOOTBALL",
          providerEventId: record.matchId, providerMarketId: marketId,
          providerSelectionId: odd.selectionId ?? `${marketId}:${selection.toLowerCase()}`, marketType, scope, selection,
          line: null, rawOdds: odd.priceText, rawFormat: odd.priceFormat!, status: oddStatus(odd), isLive: timing!.isLive,
          sourceTimestampMs: null, receivedMonotonicMs: options.receivedMonotonicMs, sequence: options.sequence })));
        continue;
      }
      const marketLine = semantics.linePolicy === "NONE" ? null
        : semantics.isHandicap ? canonicalHomeHandicap(group.odds, provider === "SABA") : line(group.labels);
      const pricesValid = group.odds.every((odd) => validMalay(odd.priceText));
      if (marketId === null || semantics.linePolicy === "LINE" && !isSupportedFootballTwoWayLine(marketLine) || !pricesValid) {
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
      participantA: teams[0]!, participantB: teams[1]!, eventScope, bestOf: null,
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
