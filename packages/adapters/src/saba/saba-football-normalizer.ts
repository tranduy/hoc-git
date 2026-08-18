import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { isSupportedFootballTwoWayLine } from "../football-market-policy.js";

export interface SabaFootballNormalizeOptions {
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}

export interface NormalizedSabaFootballCatalog {
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
  readonly diagnostics: readonly string[];
}

type RawRecord = Readonly<Record<string, unknown>>;

function id(value: unknown): string | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim().length === 0) return null;
  return String(value).trim();
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function malay(value: unknown): string | null {
  const numeric = finite(value);
  if (numeric === null || numeric === 0 || Math.abs(numeric) > 1) return null;
  const normalized = String(numeric);
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(normalized) ? normalized : null;
}

function isVirtualFootball(competition: string, participants: readonly string[]): boolean {
  const evidence = `${competition} ${participants.join(" ")}`.normalize("NFKC").toLocaleLowerCase("en");
  return /(?:soccer marble|e[\s-]?soccer|\bvirtual\b|simulated reality|spinner world cup|\bpes\b|\(pg\)|\(et\))/u.test(evidence);
}

function canonicalHomeHandicap(record: RawRecord): string | null {
  const homeMagnitude = finite(record.hdp1);
  const awayMagnitude = finite(record.hdp2);
  if (homeMagnitude === null || awayMagnitude === null || homeMagnitude < 0 || awayMagnitude < 0 ||
    (homeMagnitude > 0 && awayMagnitude > 0)) return null;
  const value = awayMagnitude - homeMagnitude;
  if (!Number.isFinite(value)) return null;
  const canonical = String(value);
  return isSupportedFootballTwoWayLine(canonical) ? canonical : null;
}

function canonicalTotalLine(record: RawRecord): string | null {
  const total = finite(record.hdp1);
  const secondary = finite(record.hdp2);
  if (total === null || secondary !== 0 || total <= 0) return null;
  const canonical = String(total);
  return isSupportedFootballTwoWayLine(canonical) ? canonical : null;
}

export function normalizeSabaFootballRecords(
  records: readonly RawRecord[],
  options: SabaFootballNormalizeOptions
): NormalizedSabaFootballCatalog {
  const events: ProviderEvent[] = [];
  const markets: ProviderMarket[] = [];
  const quotes: ProviderQuote[] = [];
  const diagnostics: string[] = [];
  if (!Number.isFinite(options.observedAtMs) || !Number.isFinite(options.receivedMonotonicMs) ||
    !Number.isSafeInteger(options.sequence) || options.sequence < 0) {
    return { events, markets, quotes, diagnostics: ["SABA_FOOTBALL_OPTIONS_INVALID"] };
  }

  const leagues = new Map<string, string>();
  for (const record of records) {
    if (record.type !== "l") continue;
    const leagueId = id(record.leagueid);
    const name = text(record.leaguenameen);
    if (leagueId !== null && name !== null && (record.sporttype === undefined || record.sporttype === 1)) {
      leagues.set(leagueId, name);
    }
  }

  const matches = new Map<string, RawRecord>();
  for (const record of records) {
    if (record.type !== "m") continue;
    const matchId = id(record.matchid);
    if (matchId !== null) matches.set(matchId, { ...(matches.get(matchId) ?? {}), ...record });
  }

  const acceptedMatches = new Set<string>();
  for (const [matchId, match] of matches) {
    const leagueId = id(match.leagueid);
    const participantA = text(match.hteamnameen);
    const participantB = text(match.ateamnameen);
    const kickoffSeconds = finite(match.kickofftime);
    const competition = leagueId === null ? null : leagues.get(leagueId) ?? text(match.leaguenameen);
    if (match.sporttype !== 1 || leagueId === null || participantA === null || participantB === null ||
      participantA === participantB || competition === null || kickoffSeconds === null || kickoffSeconds < 0) {
      diagnostics.push("SABA_FOOTBALL_EVENT_REJECTED");
      continue;
    }
    const isVirtual = isVirtualFootball(competition, [participantA, participantB]);
    // ET/PEN are separately settled derivative events on SABA, not the same
    // regulation-time ticket. Virtual events are outside this Football feed.
    if (isVirtual || participantsHaveDerivativeSuffix([participantA, participantB])) {
      diagnostics.push("SABA_FOOTBALL_EVENT_UNSUPPORTED");
      continue;
    }
    const isLive = match.marketid === "L";
    events.push({
      provider: "SABA", category: "FOOTBALL", providerEventId: matchId, competition,
      seasonStage: null, startAtUtcMs: kickoffSeconds * 1_000, participantA, participantB,
      eventScope: "REGULATION", bestOf: null, isLive, rematchCandidate: isLive,
      fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL",
      liveState: isLive ? { period: null, scoreHome: null, scoreAway: null, clockMs: null } : null
    });
    acceptedMatches.add(matchId);
  }

  const seenMarkets = new Set<string>();
  for (const record of records) {
    if (record.type !== "o" || ![1, 3, 7, 8].includes(record.bettype as number) ||
      (record.parenttypeid !== undefined && record.parenttypeid !== record.bettype)) continue;
    const matchId = id(record.matchid);
    const oddsId = id(record.oddsid);
    if (matchId === null || !acceptedMatches.has(matchId)) continue;
    const marketType = record.bettype === 1 ? "FT_AH" as const
      : record.bettype === 3 ? "FT_TOTAL" as const
        : record.bettype === 7 ? "FH_AH" as const : "FH_TOTAL" as const;
    const isHandicap = marketType === "FT_AH" || marketType === "FH_AH";
    const isFirstHalf = marketType === "FH_AH" || marketType === "FH_TOTAL";
    const scope = isFirstHalf ? "FIRST_HALF" as const : "FULL_TIME" as const;
    const line = isHandicap ? canonicalHomeHandicap(record) : canonicalTotalLine(record);
    const firstPrice = malay(record.odds1a);
    const secondPrice = malay(record.odds2a);
    if (oddsId === null || line === null || firstPrice === null || secondPrice === null || seenMarkets.has(oddsId)) {
      diagnostics.push("SABA_FOOTBALL_MARKET_REJECTED");
      continue;
    }
    seenMarkets.add(oddsId);
    const status = record.oddsstatus === "running" && record.enable !== 0 ? "OPEN" as const : "SUSPENDED" as const;
    const isLive = matches.get(matchId)?.marketid === "L";
    markets.push({
      provider: "SABA", category: "FOOTBALL", providerEventId: matchId, providerMarketId: oddsId,
      marketType, scope, line,
      settlementProfile: isFirstHalf ? "football-first-half-including-added-time"
        : "football-regulation-including-added-time", status
    });
    const selections = isHandicap ? ["HOME", "AWAY"] as const : ["OVER", "UNDER"] as const;
    quotes.push(...selections.map((selection, index): ProviderQuote => ({
      provider: "SABA", category: "FOOTBALL", providerEventId: matchId, providerMarketId: oddsId,
      providerSelectionId: `${oddsId}:${selection.toLowerCase()}`, marketType, scope,
      selection, line, rawOdds: index === 0 ? firstPrice : secondPrice, rawFormat: "MALAY", status, isLive,
      sourceTimestampMs: null, receivedMonotonicMs: options.receivedMonotonicMs, sequence: options.sequence
    })));
  }

  return { events, markets, quotes, diagnostics };
}

function participantsHaveDerivativeSuffix(participants: readonly string[]): boolean {
  return participants.some((participant) => /\((?:ET|PEN)\)\s*$/iu.test(participant));
}
