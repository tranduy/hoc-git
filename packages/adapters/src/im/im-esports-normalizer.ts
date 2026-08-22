import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";

export interface ImEsportsSelectionRecord {
  readonly code: number;
  readonly name: string;
  readonly odds: number;
  readonly handicap: number;
  readonly locked: boolean;
}

export interface ImEsportsMarketRecord {
  readonly sportId: number;
  readonly sportName: string;
  readonly leagueId: number;
  readonly leagueName: string;
  readonly parentMatchNo: number;
  readonly parentHomeId: number;
  readonly parentHomeName: string;
  readonly parentAwayId: number;
  readonly parentAwayName: string;
  readonly parentDate: string;
  readonly matchNo: number;
  readonly gameTypeCode: string;
  readonly gameTypeName: string;
  readonly marketGroup: string;
  readonly gameOrder: number;
  readonly status: number;
  readonly isLive: boolean;
  readonly matchDate: string;
  readonly selections: readonly ImEsportsSelectionRecord[];
}

export interface NormalizedImEsportsCatalog {
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
  readonly diagnostics: readonly string[];
}

function bestOf(name: string): number | null {
  const match = /\bBO([1-9])\b/iu.exec(name);
  return match === null ? null : Number(match[1]);
}

function decimal(value: number): string | null {
  if (!Number.isFinite(value) || value <= 1) return null;
  const output = String(value);
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(output) ? output : null;
}

function marketIdentity(record: ImEsportsMarketRecord): {
  readonly marketType: "SERIES_WINNER" | "MAP_WINNER";
  readonly scope: "SERIES" | `MAP_${1 | 2 | 3 | 4 | 5}`;
  readonly settlementProfile: "lol-series-winner" | "lol-map-winner";
} | null {
  if (record.gameTypeCode === "SeriesWin" && record.gameOrder === 0) {
    return { marketType: "SERIES_WINNER", scope: "SERIES", settlementProfile: "lol-series-winner" };
  }
  if (record.gameTypeCode === "GameWin" && Number.isSafeInteger(record.gameOrder) &&
    record.gameOrder >= 1 && record.gameOrder <= 5) {
    const scope = `MAP_${record.gameOrder}` as `MAP_${1 | 2 | 3 | 4 | 5}`;
    return { marketType: "MAP_WINNER", scope, settlementProfile: "lol-map-winner" };
  }
  return null;
}

export function normalizeImLolRecords(records: readonly ImEsportsMarketRecord[], options: {
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}): NormalizedImEsportsCatalog {
  const events: ProviderEvent[] = [];
  const markets: ProviderMarket[] = [];
  const quotes: ProviderQuote[] = [];
  const diagnostics: string[] = [];
  if (!Number.isFinite(options.receivedMonotonicMs) || !Number.isSafeInteger(options.sequence) || options.sequence < 0) {
    return { events, markets, quotes, diagnostics: ["IM_ESPORTS_OPTIONS_INVALID"] };
  }
  const eventIds = new Set<string>();
  const marketIds = new Set<string>();
  const seriesBestOf = new Map<number, number | null>();
  for (const record of records) {
    if (record.sportId === 45 && record.sportName === "League of Legends" &&
      record.gameTypeCode === "SeriesWin" && record.gameOrder === 0) {
      seriesBestOf.set(record.parentMatchNo, bestOf(record.gameTypeName));
    }
  }
  for (const record of records) {
    const identity = marketIdentity(record);
    if (record.sportId !== 45 || record.sportName !== "League of Legends" || identity === null ||
      record.parentHomeName.trim().length === 0 || record.parentAwayName.trim().length === 0 ||
      record.parentHomeName.trim() === record.parentAwayName.trim()) continue;
    const eventId = String(record.parentMatchNo);
    const marketId = String(record.matchNo);
    const startAtUtcMs = Date.parse(record.parentDate);
    const selections = record.selections.filter((item) => item.code === 1 || item.code === 2);
    const teamA = selections.find((item) => item.code === 1);
    const teamB = selections.find((item) => item.code === 2);
    const priceA = teamA === undefined ? null : decimal(teamA.odds);
    const priceB = teamB === undefined ? null : decimal(teamB.odds);
    if (!Number.isFinite(startAtUtcMs) || selections.length !== 2 || teamA === undefined || teamB === undefined ||
      priceA === null || priceB === null || teamA.handicap !== 0 || teamB.handicap !== 0 || marketIds.has(marketId)) {
      diagnostics.push("IM_ESPORTS_MARKET_REJECTED");
      continue;
    }
    if (!eventIds.has(eventId)) {
      events.push({
        provider: "IM", category: "LOL", providerEventId: eventId, competition: record.leagueName,
        seasonStage: null, startAtUtcMs, participantA: record.parentHomeName.trim(),
        participantB: record.parentAwayName.trim(), eventScope: "SERIES",
        bestOf: seriesBestOf.get(record.parentMatchNo) ?? null,
        isLive: record.isLive, rematchCandidate: null, fixtureDiscriminator: null, gameVariant: "LOL_PC",
        liveState: record.isLive ? { seriesScoreA: null, seriesScoreB: null, currentMap: null, mapState: null } : null
      });
      eventIds.add(eventId);
    }
    marketIds.add(marketId);
    const status = record.status === 1 && !teamA.locked && !teamB.locked ? "OPEN" as const : "SUSPENDED" as const;
    markets.push({
      provider: "IM", category: "LOL", providerEventId: eventId, providerMarketId: marketId,
      marketType: identity.marketType, scope: identity.scope, line: null,
      settlementProfile: identity.settlementProfile, status
    });
    quotes.push(...([teamA, teamB] as const).map((selection, index): ProviderQuote => ({
      provider: "IM", category: "LOL", providerEventId: eventId, providerMarketId: marketId,
      providerSelectionId: `${marketId}:${selection.code}`, marketType: identity.marketType, scope: identity.scope,
      selection: index === 0 ? "TEAM_A" : "TEAM_B", line: null, rawOdds: index === 0 ? priceA : priceB,
      rawFormat: "DECIMAL", status, isLive: record.isLive, sourceTimestampMs: null,
      receivedMonotonicMs: options.receivedMonotonicMs, sequence: options.sequence
    })));
  }
  return { events, markets, quotes, diagnostics };
}
