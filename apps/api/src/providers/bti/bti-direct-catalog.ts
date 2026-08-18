import { isSupportedFootballTwoWayLine,
  type SbobetCatalogInputRecord, type SbobetCatalogMarket,
  type SbobetCatalogSelection } from "@tool-chenh/adapters";

type Row = readonly unknown[];

function row(value: unknown): Row | null { return Array.isArray(value) ? value : null; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function localized(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const values = value as Record<string, unknown>;
  return text(values.VI) || text(values.EN);
}
function halfLine(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100 &&
    isSupportedFootballTwoWayLine(String(value));
}

interface BtiSelection {
  readonly id: string;
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
  return { id, side, line, malay, locked: item?.[3] === true };
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
    const type = code === "HC39" || code === "HC0" ? "FT_AH" as const
      : code === "HC1" ? "FH_AH" as const
        : code === "OU1" ? "FH_TOTAL" as const : "FT_TOTAL" as const;
    const isHandicap = type === "FT_AH" || type === "FH_AH";
    const candidates = (row(market[7]) ?? []).map(selection).filter((item): item is BtiSelection => item !== null);
    const grouped = new Map<string, BtiSelection[]>();
    for (const item of candidates) {
      const key = isHandicap ? String(item.side === 1 ? item.line : -item.line) : String(item.line);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()].flatMap(([line, pair]) => {
      const home = pair.find((item) => item.side === 1);
      const away = pair.find((item) => item.side === 3);
      if (home === undefined || away === undefined || pair.length !== 2) return [];
      const selections: SbobetCatalogSelection[] = [home, away].map((item, index) => ({
        selectionId: item.id,
        selection: isHandicap ? (index === 0 ? "HOME" : "AWAY") : (index === 0 ? "OVER" : "UNDER"),
        priceText: item.malay,
        locked: item.locked,
        ...(isHandicap ? { lineText: `${item.line >= 0 ? "+" : ""}${item.line}` } : {})
      }));
      return [{ marketId: `${text(market[0])}:${line}`, marketType: type, lineText: line, selections }];
    });
  });
}

export function extractBtiCatalogRecords(payload: unknown): readonly SbobetCatalogInputRecord[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return [];
  const leagues = row((payload as Record<string, unknown>).serializedData) ?? [];
  return leagues.flatMap((leagueValue): SbobetCatalogInputRecord[] => {
    const league = row(leagueValue);
    const leagueName = text(league?.[1]);
    const events = row(league?.[12]) ?? [];
    if (leagueName === "") return [];
    return events.flatMap((eventValue): SbobetCatalogInputRecord[] => {
      const event = row(eventValue);
      const eventId = text(event?.[0]);
      const participants = row(event?.[1]) ?? [];
      const names = participants.slice(0, 2).map((participant) => localized(row(participant)?.[1]));
      const scores = row(event?.[4]);
      const eventMarkets = markets(event?.[8]);
      const isLive = event?.[5] === true;
      const startAtUtcMs = isLive ? null : Date.parse(text(event?.[3]));
      if (eventId === "" || (event?.[5] !== true && event?.[5] !== false) ||
        (!isLive && !Number.isFinite(startAtUtcMs)) || names.length !== 2 ||
        names.some((name) => name === "") || eventMarkets.length === 0) return [];
      const scoreText = isLive && typeof scores?.[0] === "string" && typeof scores?.[1] === "string"
        ? `${scores[0]} - ${scores[1]}` : null;
      return [{ eventId, leagueName, timeText: isLive ? "LIVE" : "PREMATCH", scoreText,
        ...(isLive ? {} : { startAtUtcMs }), teamNames: names, markets: eventMarkets }];
    });
  });
}
