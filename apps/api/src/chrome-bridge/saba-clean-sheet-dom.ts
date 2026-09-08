import type { CmdCatalogInputRecord, CmdCatalogOptions } from "@tool-chenh/adapters";
import type { NativeMarketObservation, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { NormalizedCatalogPart } from "./catalog-part-merge.js";

export type SabaDomCleanSheetOptions = Pick<CmdCatalogOptions,
  "observedAtMs" | "receivedMonotonicMs" | "sequence">;

const CLEAN_SHEET_LABELS = ["GIU SACH LUOI", "DOI NHA CO", "DOI NHA KHONG",
  "DOI KHACH CO", "DOI KHACH KHONG"] as const;

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/Đ/gu, "D").replace(/đ/gu, "d")
    .replace(/\s+/gu, " ").trim().toUpperCase();
}

function decimal(value: string): string | null {
  const trimmed = value.trim();
  if (!/^(?:[1-9]\d*)(?:\.\d+)?$/u.test(trimmed)) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 1 ? String(numeric) : null;
}

function aggregateRecord(record: CmdCatalogInputRecord): boolean {
  const competition = fold(record.leagueName);
  if (!/^(?:\*\s*)?.+\s+-\s+DOI NHA\s*\/\s*DOI KHACH$/u.test(competition) ||
    record.teamNames.length !== 2) return false;
  const participant = (value: string, role: "DOI NHA" | "DOI KHACH") =>
    new RegExp(`^${role}\\s*-\\s*(\\S(?:.*\\S)?)\\s*-\\s*(\\d+)\\s+TRAN DAU$`, "u")
      .exec(fold(value));
  const home = participant(record.teamNames[0]!, "DOI NHA");
  const away = participant(record.teamNames[1]!, "DOI KHACH");
  return home !== null && away !== null && Number(home[2]) >= 2 && home[1] === away[1] &&
    home[2] === away[2];
}

function goalsEvent(catalog: NormalizedCatalogPart, record: CmdCatalogInputRecord):
NormalizedCatalogPart["events"][number] | null {
  const matches = catalog.events.filter((event) => event.provider === "SABA" &&
    event.category === "FOOTBALL" && event.providerEventId === record.matchId);
  if (matches.length !== 1) return null;
  const event = matches[0]!;
  if (event.category !== "FOOTBALL" || record.sportId !== "1" ||
    event.eventScope !== "REGULATION" || event.isVirtual !== false ||
    event.sportVariant !== "FOOTBALL" || record.teamNames.length !== 2 ||
    event.competition !== record.leagueName || event.participantA !== record.teamNames[0] ||
    event.participantB !== record.teamNames[1] || aggregateRecord(record)) return null;
  const context = fold(`${record.leagueName} ${record.teamNames.join(" ")}`);
  if (/\s-\sCORNERS?$/u.test(fold(record.leagueName)) ||
    /\s-\sBOOKINGS?$/u.test(fold(record.leagueName)) ||
    /\b(?:CORNERS?|BOOKINGS?|CARDS?)\b/u.test(context) ||
    /(?:SOCCER MARBLE|E[\s-]?SOCCER|\bVIRTUAL\b|SIMULATED REALITY|SPINNER WORLD CUP|\bPES\b|\(PG\)|\(ET\))/u
      .test(context)) return null;
  return event;
}

function marketStatus(group: CmdCatalogInputRecord["groups"][number]): "OPEN" | "SUSPENDED" {
  const suspended = group.odds.some((odd) => odd.greyedOut?.trim().toLowerCase() === "true" || (() => {
    const status = odd.status?.trim().toLowerCase();
    return status !== undefined && status !== null && status !== "" && status !== "running" && status !== "open";
  })());
  return suspended ? "SUSPENDED" : "OPEN";
}

function validOptions(options: SabaDomCleanSheetOptions): boolean {
  return Number.isSafeInteger(options.observedAtMs) && options.observedAtMs >= 0 &&
    Number.isFinite(options.receivedMonotonicMs) && options.receivedMonotonicMs >= 0 &&
    options.receivedMonotonicMs <= Number.MAX_SAFE_INTEGER &&
    Number.isSafeInteger(options.sequence) && options.sequence >= 0;
}

export function augmentSabaDomCleanSheet(
  catalog: NormalizedCatalogPart,
  record: CmdCatalogInputRecord,
  options: SabaDomCleanSheetOptions
): NormalizedCatalogPart {
  if (!validOptions(options)) return catalog;
  const event = goalsEvent(catalog, record);
  if (event === null) return catalog;

  const matchingGroups = record.groups.filter((group) =>
    (group.betTypeIds.length === 0 || group.betTypeIds.length === 1 && group.betTypeIds[0] === "13") &&
    group.labels.length === CLEAN_SHEET_LABELS.length &&
    group.labels.every((label, index) => fold(label) === CLEAN_SHEET_LABELS[index]) &&
    group.odds.length === 4);
  if (matchingGroups.length !== 1) return catalog;
  const group = matchingGroups[0]!;
  const ids = [...new Set(group.odds.map((odd) => odd.marketOddsId.trim()))];
  if (ids.length !== 1 || !/^\d+$/u.test(ids[0]!) ||
    group.odds.some((odd) => odd.lineText !== undefined && odd.lineText !== null)) return catalog;
  const providerMarketId = ids[0]!;
  const prices = group.odds.map(({ priceText }) => decimal(priceText));
  if (prices.some((price) => price === null)) return catalog;

  const observations = catalog.nativeMarketObservations ?? [];
  const matchingObservations = observations.map((observation, index) => ({ observation, index }))
    .filter(({ observation }) => observation.provider === "SABA" && observation.category === "FOOTBALL" &&
      observation.providerEventId === event.providerEventId && observation.providerMarketId === providerMarketId &&
      (observation.nativeType === "UNKNOWN" || observation.nativeType === "13") &&
      observation.disposition !== "NORMALIZED");
  if (matchingObservations.length !== 1) return catalog;

  const definitions = [{ suffix: "home-clean-sheet", marketType: "HOME_FT_CLEAN_SHEET",
    settlementProfile: "football-home-clean-sheet", values: [["YES", prices[0]!], ["NO", prices[1]!]] },
  { suffix: "away-clean-sheet", marketType: "AWAY_FT_CLEAN_SHEET",
    settlementProfile: "football-away-clean-sheet", values: [["YES", prices[2]!], ["NO", prices[3]!]] }] as const;
  const marketIds = definitions.map(({ suffix }) => `${providerMarketId}:${suffix}`);
  const selectionIds = definitions.flatMap(({ suffix }) => [
    `${providerMarketId}:${suffix}:yes`, `${providerMarketId}:${suffix}:no`
  ]);
  if (catalog.markets.some((market) => marketIds.includes(market.providerMarketId)) ||
    catalog.quotes.some((quote) => selectionIds.includes(quote.providerSelectionId))) return catalog;

  const status = marketStatus(group);
  const markets = definitions.map(({ suffix, marketType, settlementProfile }): ProviderMarket => ({
    provider: "SABA", category: "FOOTBALL", providerEventId: event.providerEventId,
    providerMarketId: `${providerMarketId}:${suffix}`, marketType, scope: "FULL_TIME", line: null,
    settlementProfile, status
  }));
  const quotes = definitions.flatMap(({ suffix, marketType, values }) => {
    const derivedId = `${providerMarketId}:${suffix}`;
    return values.map(([selection, rawOdds]): ProviderQuote => ({
      provider: "SABA", category: "FOOTBALL", providerEventId: event.providerEventId,
      providerMarketId: derivedId, providerSelectionId: `${derivedId}:${selection.toLowerCase()}`,
      marketType, scope: "FULL_TIME", selection, line: null, rawOdds, rawFormat: "DECIMAL", status,
      isLive: event.isLive, sourceTimestampMs: null,
      receivedMonotonicMs: options.receivedMonotonicMs, sequence: options.sequence
    }));
  });
  const target = matchingObservations[0]!;
  const replacement: NativeMarketObservation = { ...target.observation, nativeType: "13",
    nativeScope: "FULL_TIME", outcomeLabels: ["HOME_YES", "HOME_NO", "AWAY_YES", "AWAY_NO"],
    observedAtMs: options.observedAtMs, disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED" };
  const nativeMarketObservations = observations.map((observation, index) =>
    index === target.index ? replacement : observation);
  return { ...catalog, markets: [...catalog.markets, ...markets], quotes: [...catalog.quotes, ...quotes],
    nativeMarketObservations };
}
