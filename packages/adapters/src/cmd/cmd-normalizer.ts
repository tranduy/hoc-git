import type { ProviderEvent, ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";

export interface CmdCatalogOdd {
  readonly marketOddsId: string;
  readonly priceText: string;
  readonly status: string | null;
  readonly greyedOut: string | null;
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

const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const signedDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function line(labels: readonly string[]): string | null {
  const candidate = labels.find((label) => /^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/u.test(label));
  if (candidate === undefined) return null;
  const parts = candidate.split("/").map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0 || part > 100)) return null;
  const value = parts.reduce((sum, part) => sum + part, 0) / parts.length;
  return Number.isFinite(value) ? String(value) : null;
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
  if (normalized === "TRỰC TIẾP" || /^\dH\d+'$/u.test(normalized)) {
    const clock = /^(\d)H(\d+)'$/u.exec(normalized);
    return {
      startAtUtcMs: options.observedAtMs,
      isLive: true,
      period: clock === null ? null : `${clock[1]}H`,
      clockMs: clock === null ? null : Number(clock[2]) * 60_000
    };
  }
  const match = /^(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})(AM|PM)$/u.exec(normalized);
  if (match === null) return null;
  const observed = new Date(options.observedAtMs);
  const month = Number(match[1]);
  const day = Number(match[2]);
  let hour = Number(match[3]) % 12;
  if (match[5] === "PM") hour += 12;
  const minute = Number(match[4]);
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

function validDecimal(value: string): boolean {
  return decimalPattern.test(value) && Number(value) > 1;
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
    const teams = record.teamNames.map((team) => team.trim()).filter((team) => team.length > 0);
    const supported = record.groups.filter((group) => group.betTypeIds.length === 1 && ["3", "5"].includes(group.betTypeIds[0]!));
    let invalid = record.sportId !== "1" || record.matchId.trim().length === 0 || record.leagueName.trim().length === 0 ||
      teams.length !== 2 || teams[0] === teams[1] || timing === null;
    const recordMarkets: ProviderMarket[] = [];
    const recordQuotes: ProviderQuote[] = [];
    if (invalid) {
      diagnostics.push("CMD_CATALOG_RECORD_REJECTED");
      continue;
    }
    for (const group of supported) {
      const betType = group.betTypeIds[0]!;
      const selections = betType === "3" ? ["OVER", "UNDER"] as const : ["HOME", "DRAW", "AWAY"] as const;
      const marketId = exactMarketId(group, selections.length);
      const marketLine = betType === "3" ? line(group.labels) : null;
      const pricesValid = group.odds.every((odd) => betType === "3" ? validMalay(odd.priceText) : validDecimal(odd.priceText));
      if (marketId === null || (betType === "3" && marketLine === null) || !pricesValid) {
        invalid = true;
        break;
      }
      const marketType = betType === "3" ? "FT_TOTAL" as const : "FT_1X2" as const;
      const status = commonMarketStatus(group);
      recordMarkets.push({
        provider, category: "FOOTBALL", providerEventId: record.matchId,
        providerMarketId: marketId, marketType, scope: "FULL_TIME", line: marketLine,
        settlementProfile: "football-regulation-including-added-time", status
      });
      recordQuotes.push(...group.odds.map((odd, index): ProviderQuote => ({
        provider, category: "FOOTBALL", providerEventId: record.matchId,
        providerMarketId: marketId, providerSelectionId: `${marketId}:${selections[index]!.toLowerCase()}`,
        marketType, scope: "FULL_TIME", selection: selections[index]!, line: marketLine,
        rawOdds: odd.priceText, rawFormat: betType === "3" ? "MALAY" : "DECIMAL",
        status, isLive: timing!.isLive, sourceTimestampMs: null,
        receivedMonotonicMs: options.receivedMonotonicMs, sequence: options.sequence
      })));
    }
    if (invalid) {
      diagnostics.push("CMD_CATALOG_RECORD_REJECTED");
      continue;
    }
    events.push({
      provider, category: "FOOTBALL", providerEventId: record.matchId,
      competition: record.leagueName.trim(), seasonStage: null, startAtUtcMs: timing!.startAtUtcMs,
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
