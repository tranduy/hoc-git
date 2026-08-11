import type { SbobetCatalogInputRecord, SbobetCatalogMarket, SbobetCatalogSelection } from "@tool-chenh/adapters";

const pairPattern = /^(-?(?:0|1)(?:\.\d+)?)\*(\d+[had])$/u;

function halfGoalLine(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 && Number.isInteger(parsed * 2) && !Number.isInteger(parsed);
}

function pair(value: unknown, selection: SbobetCatalogSelection["selection"]): SbobetCatalogSelection | null {
  if (typeof value !== "string") return null;
  const match = pairPattern.exec(value);
  if (match === null || Number(match[1]) === 0) return null;
  return { selectionId: match[2]!, selection, priceText: match[1]!, locked: false };
}

function market(value: unknown, type: "FT_TOTAL" | "FT_AH"): SbobetCatalogMarket | null {
  if (typeof value !== "string") return null;
  const tokens = value.trim().split(/\s+/u);
  const line = tokens[0];
  if (line === undefined || !halfGoalLine(line)) return null;
  const first = pair(tokens[1], type === "FT_TOTAL" ? "OVER" : "HOME");
  const second = pair(tokens[2], type === "FT_TOTAL" ? "UNDER" : "AWAY");
  if (first === null || second === null) return null;
  const favored = type === "FT_AH" ? tokens[3] : null;
  const marketId = type === "FT_AH" ? tokens[4] : tokens[3];
  if (typeof marketId !== "string" || !/^\d{4,30}$/u.test(marketId) ||
    (type === "FT_AH" && favored !== "h" && favored !== "a")) return null;
  const selections = type === "FT_AH" ? [
    { ...first, lineText: favored === "h" ? line : null },
    { ...second, lineText: favored === "a" ? line : null }
  ] : [first, second];
  return { marketId, marketType: type, lineText: type === "FT_TOTAL" ? line : null, selections };
}

export function extractSbobetDirectCatalogRecords(
  body: unknown, fallbackRecords: readonly SbobetCatalogInputRecord[]
): readonly SbobetCatalogInputRecord[] {
  const fallback = new Map(fallbackRecords.map((record) => [record.eventId, record]));
  const records = new Map<string, SbobetCatalogInputRecord>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 20 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((child) => visit(child, depth + 1)); return; }
    const raw = value as Record<string, unknown>;
    const eventId = typeof raw["8"] === "number" || typeof raw["8"] === "string" ? String(raw["8"]) : null;
    const teams = [raw["2"], raw["3"]];
    const markets = raw["7"];
    const existing = eventId === null ? undefined : fallback.get(eventId);
    if (eventId !== null && existing !== undefined && teams.every((team) => typeof team === "string") &&
      typeof markets === "object" && markets !== null && !Array.isArray(markets)) {
      const parsed = Object.entries(markets as Record<string, unknown>).flatMap(([key, rows]) => {
        if (key !== "3" && key !== "5" || !Array.isArray(rows)) return [];
        return rows.flatMap((row) => {
          const candidate = market(row, key === "3" ? "FT_TOTAL" : "FT_AH");
          return candidate === null ? [] : [candidate];
        });
      });
      const unique = parsed.filter((candidate, index) => parsed.findIndex((other) => other.marketId === candidate.marketId) === index);
      const parsedStart = typeof raw["0"] === "string" ? Date.parse(raw["0"]) : Number.NaN;
      if (unique.length > 0) records.set(eventId, {
        ...existing,
        ...(Number.isFinite(parsedStart) ? { startAtUtcMs: parsedStart } : {}),
        teamNames: teams as readonly string[],
        markets: unique
      });
    }
    Object.values(raw).forEach((child) => visit(child, depth + 1));
  };
  visit(body, 0);
  return [...records.values()];
}
