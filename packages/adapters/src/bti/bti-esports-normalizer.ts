import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";

export interface BtiEsportsSelectionRecord {
  readonly id: string;
  readonly side: number;
  readonly name: string;
  readonly decimal: string;
  readonly locked: boolean;
}

export interface BtiEsportsMarketRecord {
  readonly sportId: string;
  readonly sportCode: string;
  readonly leagueId: string;
  readonly leagueName: string;
  readonly eventId: string;
  readonly startAt: string;
  readonly isLive: boolean;
  readonly eventSuspended: boolean;
  readonly participantA: string;
  readonly participantB: string;
  readonly marketId: string;
  readonly marketCode: string;
  readonly marketName: string;
  readonly marketIsLive: boolean;
  readonly marketSuspended: boolean;
  readonly selections: readonly BtiEsportsSelectionRecord[];
}

export interface NormalizedBtiEsportsCatalog {
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
  readonly diagnostics: readonly string[];
}

function plainDecimal(value: string): string | null {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(trimmed) || Number(trimmed) <= 1) return null;
  return trimmed;
}

export function normalizeBtiLolRecords(records: readonly BtiEsportsMarketRecord[], options: {
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}): NormalizedBtiEsportsCatalog {
  const events: ProviderEvent[] = [];
  const markets: ProviderMarket[] = [];
  const quotes: ProviderQuote[] = [];
  const diagnostics: string[] = [];
  if (!Number.isFinite(options.receivedMonotonicMs) || !Number.isSafeInteger(options.sequence) || options.sequence < 0) {
    return { events, markets, quotes, diagnostics: ["BTI_ESPORTS_OPTIONS_INVALID"] };
  }

  const eventIds = new Set<string>();
  const marketIds = new Set<string>();
  for (const record of records) {
    const participantA = record.participantA.trim();
    const participantB = record.participantB.trim();
    const startAtUtcMs = Date.parse(record.startAt);
    const expectedMarketCode = record.isLive ? "ML39" : "ML0";
    const home = record.selections.find((selection) => selection.side === 1);
    const away = record.selections.find((selection) => selection.side === 3);
    const priceA = home === undefined ? null : plainDecimal(home.decimal);
    const priceB = away === undefined ? null : plainDecimal(away.decimal);
    if (record.sportId !== "64" || record.sportCode !== "LOL" || record.leagueId.trim() === "" ||
      record.leagueName.trim() === "" || record.eventId.trim() === "" || record.marketId.trim() === "" ||
      !Number.isFinite(startAtUtcMs) || participantA === "" || participantB === "" || participantA === participantB ||
      record.marketCode !== expectedMarketCode || record.marketIsLive !== record.isLive ||
      record.selections.length !== 2 || home === undefined || away === undefined ||
      home.name.trim() !== participantA || away.name.trim() !== participantB || priceA === null || priceB === null ||
      home.id.trim() === "" || away.id.trim() === "" || home.id === away.id || marketIds.has(record.marketId)) {
      diagnostics.push("BTI_ESPORTS_MARKET_REJECTED");
      continue;
    }

    const status = record.eventSuspended || record.marketSuspended || home.locked || away.locked
      ? "SUSPENDED" as const : "OPEN" as const;
    if (!eventIds.has(record.eventId)) {
      events.push({
        provider: "BTI", category: "LOL", providerEventId: record.eventId,
        competition: record.leagueName.trim(), seasonStage: null, startAtUtcMs,
        participantA, participantB, eventScope: "SERIES", bestOf: null, isLive: record.isLive,
        rematchCandidate: null, fixtureDiscriminator: null, gameVariant: "LOL_PC",
        liveState: record.isLive
          ? { seriesScoreA: null, seriesScoreB: null, currentMap: null, mapState: null }
          : null
      });
      eventIds.add(record.eventId);
    }
    marketIds.add(record.marketId);
    markets.push({
      provider: "BTI", category: "LOL", providerEventId: record.eventId, providerMarketId: record.marketId,
      marketType: "SERIES_WINNER", scope: "SERIES", line: null,
      settlementProfile: "lol-series-winner", status
    });
    quotes.push(...([home, away] as const).map((selection, index): ProviderQuote => ({
      provider: "BTI", category: "LOL", providerEventId: record.eventId, providerMarketId: record.marketId,
      providerSelectionId: selection.id, marketType: "SERIES_WINNER", scope: "SERIES",
      selection: index === 0 ? "TEAM_A" : "TEAM_B", line: null,
      rawOdds: index === 0 ? priceA : priceB, rawFormat: "DECIMAL", status,
      isLive: record.isLive, sourceTimestampMs: null,
      receivedMonotonicMs: options.receivedMonotonicMs, sequence: options.sequence
    })));
  }
  return { events, markets, quotes, diagnostics };
}
