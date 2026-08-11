import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";

export interface SabaEsportsNormalizeOptions {
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}

export interface NormalizedSabaEsportsCatalog {
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

function malay(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0 || Math.abs(value) > 1) return null;
  const normalized = String(value);
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(normalized) ? normalized : null;
}

function mapScope(resourceId: unknown): "MAP_1" | "MAP_2" | "MAP_3" | "MAP_4" | "MAP_5" | null {
  const match = /^0?([1-5])$/u.exec(String(resourceId ?? ""));
  return match === null ? null : `MAP_${match[1]}` as "MAP_1" | "MAP_2" | "MAP_3" | "MAP_4" | "MAP_5";
}

export function normalizeSabaLolRecords(
  records: readonly RawRecord[],
  options: SabaEsportsNormalizeOptions
): NormalizedSabaEsportsCatalog {
  const events: ProviderEvent[] = [];
  const markets: ProviderMarket[] = [];
  const quotes: ProviderQuote[] = [];
  const diagnostics: string[] = [];
  if (!Number.isFinite(options.observedAtMs) || !Number.isFinite(options.receivedMonotonicMs) ||
    !Number.isSafeInteger(options.sequence) || options.sequence < 0) {
    return { events, markets, quotes, diagnostics: ["SABA_ESPORTS_OPTIONS_INVALID"] };
  }

  const leagues = new Map<string, string>();
  for (const record of records) {
    if (record.type !== "l") continue;
    const leagueId = id(record.leagueid);
    const name = text(record.leaguenameen);
    // Live SABA evidence identifies real LoL as league-group 25. Virtual LoL
    // and other esports use different groups and must never be cross-mapped.
    if (leagueId !== null && name !== null && record.leaguegroupid === 25 && /^League of Legends\s+-\s+/u.test(name)) {
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
    const kickoffSeconds = match.kickofftime;
    const bestOf = match.bestofmap;
    const competition = leagueId === null ? null : leagues.get(leagueId) ?? text(match.leaguenameen);
    if (leagueId === null || participantA === null || participantB === null || participantA === participantB ||
      competition === null || typeof kickoffSeconds !== "number" || !Number.isFinite(kickoffSeconds) ||
      kickoffSeconds < 0 || (bestOf !== null && bestOf !== undefined &&
      (!Number.isSafeInteger(bestOf) || (bestOf as number) < 1 || (bestOf as number) > 9))) {
      diagnostics.push("SABA_ESPORTS_EVENT_REJECTED");
      continue;
    }
    // `eventstatus=running` means the market is open even for future events.
    // SABA's market bucket is the authoritative lifecycle evidence: L=live,
    // T=today and E=early/pre-match.
    const isLive = match.marketid === "L";
    events.push({
      provider: "SABA", category: "LOL", providerEventId: matchId, competition,
      seasonStage: null, startAtUtcMs: kickoffSeconds * 1_000,
      participantA, participantB, eventScope: "SERIES", bestOf: typeof bestOf === "number" ? bestOf : null,
      isLive, rematchCandidate: null, fixtureDiscriminator: null, gameVariant: "LOL_PC",
      liveState: isLive ? { seriesScoreA: null, seriesScoreB: null, currentMap: null,
        mapState: text(match.eventstatus) } : null
    });
    acceptedMatches.add(matchId);
  }

  const seenMarkets = new Set<string>();
  for (const record of records) {
    if (record.type !== "o") continue;
    const matchId = id(record.matchid);
    const oddsId = id(record.oddsid);
    const betType = record.bettype;
    const scope = betType === 20 ? "SERIES" as const : betType === 9001 ? mapScope(record.resourceid) : null;
    const marketType = betType === 20 ? "SERIES_WINNER" as const : betType === 9001 ? "MAP_WINNER" as const : null;
    const priceA = malay(record.odds1a);
    const priceB = malay(record.odds2a);
    if (marketType === null) continue;
    if (matchId === null || !acceptedMatches.has(matchId)) continue;
    if (oddsId === null || scope === null || priceA === null || priceB === null || seenMarkets.has(oddsId)) {
      diagnostics.push("SABA_ESPORTS_MARKET_REJECTED");
      continue;
    }
    seenMarkets.add(oddsId);
    const status = record.oddsstatus === "running" ? "OPEN" as const : "SUSPENDED" as const;
    markets.push({
      provider: "SABA", category: "LOL", providerEventId: matchId, providerMarketId: oddsId,
      marketType, scope, line: null, settlementProfile: "saba-esports-two-way-moneyline", status
    });
    quotes.push(...(["TEAM_A", "TEAM_B"] as const).map((selection, index): ProviderQuote => ({
      provider: "SABA", category: "LOL", providerEventId: matchId, providerMarketId: oddsId,
      providerSelectionId: `${oddsId}:${selection === "TEAM_A" ? "a" : "b"}`, marketType, scope,
      selection, line: null, rawOdds: index === 0 ? priceA : priceB, rawFormat: "MALAY", status,
      isLive: matches.get(matchId)?.marketid === "L", sourceTimestampMs: null,
      receivedMonotonicMs: options.receivedMonotonicMs, sequence: options.sequence
    })));
  }
  return { events, markets, quotes, diagnostics };
}
