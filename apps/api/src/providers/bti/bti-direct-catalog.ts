import { isSupportedFootballTwoWayLine,
  type SbobetCatalogInputRecord, type SbobetCatalogMarket,
  type SbobetCatalogSelection } from "@tool-chenh/adapters";

type Row = readonly unknown[];

function row(value: unknown): Row | null { return Array.isArray(value) ? value : null; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function localized(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const values = value as Record<string, unknown>;
  return text(values.VI) || text(values.EN) || text(values.VN) ||
    Object.values(values).map(text).find((candidate) => candidate !== "") || "";
}
function rosterNames(event: Row): readonly string[] {
  const participants = row(event[1]) ?? [];
  const names = participants.slice(0, 2).map((participant) => {
    const item = row(participant);
    return localized(item?.[1]) || text(item?.[2]);
  });
  if (names.length === 2 && names.every((name) => name !== "")) return names;
  const display = text(event[2]);
  const split = display.split(/\s+(?:v(?:s\.?)?|[-\u2013\u2014])\s+/iu).map((name) => name.trim());
  return split.length === 2 && split.every((name) => name !== "") ? split : names;
}
function halfLine(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100 &&
    isSupportedFootballTwoWayLine(String(value));
}

interface BtiSelection {
  readonly id: string;
  readonly name: string;
  readonly side: number;
  readonly line: number;
  readonly malay: string;
  readonly locked: boolean;
}

function selection(value: unknown): BtiSelection | null {
  const item = row(value);
  const formats = row(item?.[6]);
  const id = text(item?.[0]);
  const side = item?.[7];
  const line = item?.[13];
  const malay = text(formats?.[5]);
  if (id === "" || (side !== 1 && side !== 3) || !halfLine(line) || !/^-?(?:0|1)(?:\.\d+)?$/u.test(malay) || Number(malay) === 0) return null;
  return { id, name: localized(item?.[1]) || localized(item?.[2]) || text(item?.[2]),
    side, line, malay, locked: item?.[3] === true };
}

function detailSelection(value: unknown): BtiSelection | null {
  const item = row(value);
  const formats = row(item?.[8]);
  const id = text(item?.[0]);
  const name = localized(item?.[2]) || text(item?.[2]);
  const side = item?.[9];
  const line = item?.[16];
  const malay = text(formats?.[5]);
  if (id === "" || name === "" || (side !== 1 && side !== 3) || !halfLine(line) ||
    !/^-?(?:0|1)(?:\.\d+)?$/u.test(malay) || Number(malay) === 0 ||
    item?.[13] === true) return null;
  return { id, name, side, line, malay, locked: item?.[5] === true };
}

function normalizedLabel(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, " ").trim();
}

function marketType(code: string, label = ""): SbobetCatalogMarket["marketType"] | null {
  const evidence = normalizedLabel(label);
  const handicap = /^HC(?:39|0|1)$/u.test(code) || /\b(?:asian handicap|handicap|ah)\b/u.test(evidence);
  const total = /^OU(?:39|0|1|201|249)$/u.test(code) || /\b(?:total|over under|ou)\b/u.test(evidence);
  if (handicap === total) return null;
  const firstHalf = code === "HC1" || code === "OU1" || code === "OU201" ||
    /\b(?:first half|1st half|1h)\b/u.test(evidence);
  const secondHalf = /\b(?:second half|2nd half|2h)\b/u.test(evidence);
  if (firstHalf && secondHalf) return null;
  const corner = /\bcorners?\b/u.test(evidence);
  const card = /\b(?:cards?|bookings?)\b/u.test(evidence);
  if ((corner && card) || ((corner || card) && secondHalf)) return null;
  const kind = handicap ? "AH" : "TOTAL";
  if (corner) return `CORNER_${firstHalf ? "FH" : "FT"}_${kind}`;
  if (card) return `CARD_${firstHalf ? "FH" : "FT"}_${kind}`;
  if (secondHalf) return `SH_${kind}`;
  return firstHalf ? `FH_${kind}` : `FT_${kind}`;
}

function normalizedMarket(
  marketId: string,
  code: string,
  values: readonly unknown[],
  parseSelection: (value: unknown) => BtiSelection | null,
  label = "",
  expectedTeams?: readonly [string, string]
): readonly SbobetCatalogMarket[] {
  const type = marketType(code, label);
  if (marketId === "" || type === null) return [];
  const isHandicap = type.endsWith("_AH");
  const candidates = values.map(parseSelection).filter((item): item is BtiSelection => item !== null);
  const grouped = new Map<string, BtiSelection[]>();
  for (const item of candidates) {
    const key = isHandicap ? String(item.side === 1 ? item.line : -item.line) : String(item.line);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()].flatMap(([line, pair]) => {
    const home = pair.find((item) => item.side === 1);
    const away = pair.find((item) => item.side === 3);
    if (home === undefined || away === undefined || pair.length !== 2 || home.id === away.id) return [];
    if (expectedTeams !== undefined) {
      const homeName = normalizedLabel(home.name);
      const awayName = normalizedLabel(away.name);
      if (isHandicap) {
        const expectedHome = normalizedLabel(expectedTeams[0]);
        const expectedAway = normalizedLabel(expectedTeams[1]);
        const sameTeam = (actual: string, expected: string): boolean => actual === expected ||
          (actual.length >= 4 && expected.length >= 4 && (actual.includes(expected) || expected.includes(actual)));
        if (!sameTeam(homeName, expectedHome) || !sameTeam(awayName, expectedAway)) return [];
      } else if (!/^(?:over|tai|tren)(?:\b|\d)/u.test(homeName) ||
        !/^(?:under|xiu|duoi)(?:\b|\d)/u.test(awayName)) return [];
    }
    const selections: SbobetCatalogSelection[] = [home, away].map((item, index) => ({
      selectionId: item.id,
      selection: isHandicap ? (index === 0 ? "HOME" : "AWAY") : (index === 0 ? "OVER" : "UNDER"),
      priceText: item.malay,
      locked: item.locked,
      ...(isHandicap ? { lineText: `${item.line >= 0 ? "+" : ""}${item.line}` } : {})
    }));
    return [{ marketId: `${marketId}:${line}`, marketType: type, lineText: line, selections }];
  });
}

function markets(value: unknown): readonly SbobetCatalogMarket[] {
  const found: Row[] = [];
  const visit = (candidate: unknown): void => {
    const item = row(candidate);
    if (item === null) return;
    const metadata = row(item[3]);
    const code = text(metadata?.[0]);
    if ((code === "HC39" || code === "HC0" || code === "HC1" ||
      code === "OU39" || code === "OU0" || code === "OU1") && Array.isArray(item[7])) found.push(item);
    else item.forEach(visit);
  };
  visit(value);
  return found.flatMap((market): SbobetCatalogMarket[] => {
    const code = text(row(market[3])?.[0]);
    return [...normalizedMarket(text(market[0]), code, row(market[7]) ?? [], selection)];
  });
}

function detailMarkets(value: unknown, teamNames: readonly [string, string]): readonly SbobetCatalogMarket[] {
  const candidates = row(value) ?? [];
  return candidates.flatMap((value): SbobetCatalogMarket[] => {
    const market = row(value);
    if (market === null || market[15] === true || market[23] === true) return [];
    const marketTypeValue = row(market[5]);
    const code = text(marketTypeValue?.[0]) || text(marketTypeValue?.[1]) || text(market[1]);
    const label = `${text(market[1])} ${text(marketTypeValue?.[1])}`;
    return [...normalizedMarket(text(market[0]), code, row(market[13]) ?? [], detailSelection, label, teamNames)];
  });
}

function detailRecords(payload: Record<string, unknown>): readonly SbobetCatalogInputRecord[] {
  const events = row(payload.data) ?? [];
  return events.flatMap((eventValue): SbobetCatalogInputRecord[] => {
    const event = row(eventValue);
    if (event === null || event[32] === true) return [];
    const eventId = text(event[0]);
    const leagueName = text(event[2]);
    const participants = row(event[8]) ?? [];
    const names = participants.slice(0, 2).map((participant) => {
      const item = row(participant);
      return localized(item?.[1]) || text(item?.[2]);
    });
    const isLive = event[13];
    const startAtUtcMs = Date.parse(text(event[11]));
    if (names.length !== 2 || names.some((name) => name === "")) return [];
    const teamNames = names as [string, string];
    const combined = [...detailMarkets(event[20], teamNames), ...detailMarkets(event[33], teamNames)];
    const unique = new Map(combined.map((market) => [market.marketId, market]));
    if (eventId === "" || leagueName === "" || (isLive !== true && isLive !== false) ||
      !Number.isFinite(startAtUtcMs) || names.length !== 2 || names.some((name) => name === "") ||
      unique.size === 0) return [];
    return [{ eventId, leagueName, timeText: isLive ? "LIVE" : "PREMATCH", scoreText: null,
      ...(isLive ? {} : { startAtUtcMs }), teamNames: names, markets: [...unique.values()] }];
  });
}

export function extractBtiCatalogRecords(payload: unknown): readonly SbobetCatalogInputRecord[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) return detailRecords(record);
  const leagues = row(record.serializedData) ?? [];
  return leagues.flatMap((leagueValue): SbobetCatalogInputRecord[] => {
    const league = row(leagueValue);
    const leagueName = text(league?.[1]);
    const events = row(league?.[12]) ?? [];
    if (leagueName === "") return [];
    return events.flatMap((eventValue): SbobetCatalogInputRecord[] => {
      const event = row(eventValue);
      const eventId = text(event?.[0]);
      const names = event === null ? [] : rosterNames(event);
      const scores = row(event?.[4]);
      const eventMarkets = markets(event?.[8]);
      const isLive = event?.[5] === true;
      const startAtUtcMs = isLive ? null : Date.parse(text(event?.[3]));
      if (eventId === "" || (event?.[5] !== true && event?.[5] !== false) ||
        (!isLive && !Number.isFinite(startAtUtcMs)) || names.length !== 2 ||
        names.some((name) => name === "")) return [];
      const scoreText = isLive && typeof scores?.[0] === "string" && typeof scores?.[1] === "string"
        ? `${scores[0]} - ${scores[1]}` : null;
      return [{ eventId, leagueName, timeText: isLive ? "LIVE" : "PREMATCH", scoreText,
        ...(isLive ? {} : { startAtUtcMs }), teamNames: names, markets: eventMarkets }];
    });
  });
}
