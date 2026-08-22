import type { BtiEsportsMarketRecord, BtiEsportsSelectionRecord } from "@tool-chenh/adapters";
import type { Page } from "playwright";

type Row = readonly unknown[];

function row(value: unknown): Row | null { return Array.isArray(value) ? value : null; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function localized(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return text(record.VI) || text(record.EN);
}

function selection(value: unknown): BtiEsportsSelectionRecord | null {
  const item = row(value);
  const formats = row(item?.[6]);
  const id = text(item?.[0]);
  const name = localized(item?.[1]);
  const side = item?.[7];
  const decimal = text(formats?.[1]);
  if (id === "" || name === "" || (side !== 1 && side !== 3) || decimal === "") return null;
  return { id, name, side, decimal, locked: item?.[3] === true };
}

export function extractBtiEsportsRecords(payload: unknown): readonly BtiEsportsMarketRecord[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) ||
    !Array.isArray((payload as Record<string, unknown>).serializedData)) {
    throw new Error("BTI_ESPORTS_SCHEMA_CHANGED");
  }
  const leagues = (payload as { serializedData: readonly unknown[] }).serializedData;
  return leagues.flatMap((leagueValue): BtiEsportsMarketRecord[] => {
    const league = row(leagueValue);
    const leagueId = text(league?.[0]);
    const leagueName = text(league?.[1]);
    const sportCode = text(league?.[6]);
    const sportId = text(league?.[10]);
    const events = row(league?.[12]) ?? [];
    if (leagueId === "" || leagueName === "" || sportId === "" || sportCode === "") return [];
    return events.flatMap((eventValue): BtiEsportsMarketRecord[] => {
      const event = row(eventValue);
      const eventId = text(event?.[0]);
      const participants = row(event?.[1]) ?? [];
      const participantA = localized(row(participants[0])?.[1]);
      const participantB = localized(row(participants[1])?.[1]);
      const startAt = text(event?.[3]);
      const isLive = event?.[5] === true;
      const eventSuspended = event?.[6] === true;
      const marketContainer = row(event?.[8]);
      const marketRows = row(marketContainer?.[3]) ?? [];
      if (eventId === "" || participantA === "" || participantB === "" || startAt === "") return [];
      return marketRows.flatMap((marketValue): BtiEsportsMarketRecord[] => {
        const market = row(marketValue);
        const marketId = text(market?.[0]);
        const marketName = text(market?.[1]);
        const marketCode = text(row(market?.[3])?.[0]);
        const selections = (row(market?.[7]) ?? []).map(selection)
          .filter((candidate): candidate is BtiEsportsSelectionRecord => candidate !== null);
        if (marketId === "" || marketName === "" || marketCode === "") return [];
        return [{ sportId, sportCode, leagueId, leagueName, eventId, startAt, isLive, eventSuspended,
          participantA, participantB, marketId, marketCode, marketName,
          marketIsLive: market?.[8] === true, marketSuspended: market?.[9] === true, selections }];
      });
    });
  });
}

export interface BtiEsportsCatalogSnapshot {
  readonly records: readonly BtiEsportsMarketRecord[];
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

export class PlaywrightBtiEsportsPageReader {
  async readCatalogFromPage(page: Page): Promise<BtiEsportsCatalogSnapshot> {
    const payloads = await page.evaluate(async () => {
      const paths = ["/api/eventlist/asia/leagues/v2/64/live/initial",
        "/api/eventlist/asia/leagues/v2/64/prematch/initial"];
      return Promise.all(paths.map(async (path) => {
        const response = await fetch(path, { credentials: "include" });
        if (!response.ok) throw new Error("BTI_ESPORTS_CATALOG_UNAVAILABLE");
        return response.json() as Promise<unknown>;
      }));
    });
    const records = payloads.flatMap(extractBtiEsportsRecords);
    return { records, observedAtMs: Date.now(), receivedMonotonicMs: performance.now() };
  }
}
