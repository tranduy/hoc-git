import type { SbobetCatalogInputRecord, SbobetCatalogMarket, SbobetCatalogSelection } from "@tool-chenh/adapters";

export interface SbobetMarketGroupShape {
  readonly groupKey: string;
  readonly rowCount: number;
  readonly rowShapes: readonly {
    readonly tokenCount: number;
    readonly tokenKinds: readonly string[];
  }[];
}

export interface SbobetMarketLabelEvidence {
  readonly label: "FIRST_HALF_OVER_UNDER" | "FIRST_HALF_HANDICAP" |
    "SECOND_HALF_OVER_UNDER" | "SECOND_HALF_HANDICAP";
  readonly nearbyNumericKeys: readonly string[];
  readonly contextShape: string;
}

export interface SbobetMarketDomCandidate {
  readonly eventId: string;
  readonly groupKey: string;
  readonly selectionIds: readonly string[];
}

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

function diagnosticTokenKind(value: string): string {
  if (/^-?(?:0|[1-9]\d*)\.\d+$/u.test(value)) return "LINE";
  if (/^-?(?:0|1)(?:\.\d+)?\*\d+h$/u.test(value)) return "ODDS_SELECTION_H";
  if (/^-?(?:0|1)(?:\.\d+)?\*\d+a$/u.test(value)) return "ODDS_SELECTION_A";
  if (/^-?(?:0|1)(?:\.\d+)?\*\d+d$/u.test(value)) return "ODDS_SELECTION_D";
  if (/^\d{4,30}$/u.test(value)) return "INTEGER_ID";
  if (/^-?\d+$/u.test(value)) return "INTEGER";
  if (/^[had]$/u.test(value)) return "SIDE";
  return "OTHER";
}

export function inspectSbobetMarketGroups(body: unknown): readonly SbobetMarketGroupShape[] {
  const groups = new Map<string, SbobetMarketGroupShape>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 20 || groups.size >= 32 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.slice(0, 64).forEach((child) => visit(child, depth + 1));
      return;
    }
    const record = value as Record<string, unknown>;
    const marketGroups = record["7"];
    if (marketGroups !== null && typeof marketGroups === "object" && !Array.isArray(marketGroups)) {
      for (const [groupKey, rows] of Object.entries(marketGroups as Record<string, unknown>)) {
        if (groups.size >= 32 || !/^\d{1,4}$/u.test(groupKey) || !Array.isArray(rows)) continue;
        const rowShapes = rows.slice(0, 8).flatMap((row) => {
          if (typeof row !== "string") return [];
          const tokens = row.trim().split(/\s+/u).slice(0, 16);
          return [{ tokenCount: tokens.length, tokenKinds: tokens.map(diagnosticTokenKind) }];
        });
        const previous = groups.get(groupKey);
        const combined = [...(previous?.rowShapes ?? []), ...rowShapes].slice(0, 8);
        groups.set(groupKey, { groupKey, rowCount: combined.length, rowShapes: combined });
      }
    }
    Object.values(record).slice(0, 64).forEach((child) => visit(child, depth + 1));
  };
  visit(body, 0);
  return [...groups.values()].sort((left, right) => Number(left.groupKey) - Number(right.groupKey));
}

export function extractSbobetMarketDomCandidates(
  body: unknown,
  allowedGroupKeys: readonly string[]
): readonly SbobetMarketDomCandidate[] {
  const allowed = new Set(allowedGroupKeys.filter((key) => /^\d{1,4}$/u.test(key)).slice(0, 8));
  const candidates = new Map<string, SbobetMarketDomCandidate>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 20 || candidates.size >= 32 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.slice(0, 64).forEach((child) => visit(child, depth + 1));
      return;
    }
    const record = value as Record<string, unknown>;
    const eventIdValue = record["8"];
    const eventId = typeof eventIdValue === "string" || typeof eventIdValue === "number"
      ? String(eventIdValue) : null;
    const groups = record["7"];
    if (eventId !== null && /^\d{1,30}$/u.test(eventId) && groups !== null && typeof groups === "object" &&
      !Array.isArray(groups)) {
      for (const [groupKey, rows] of Object.entries(groups as Record<string, unknown>)) {
        if (!allowed.has(groupKey) || !Array.isArray(rows)) continue;
        for (const row of rows.slice(0, 8)) {
          if (typeof row !== "string") continue;
          const selectionIds = [...row.matchAll(/\*(-?\d{1,40}[had])/gu)].map((match) => match[1]!)
            .filter((selectionId) => /^\d{1,40}[had]$/u.test(selectionId)).slice(0, 4);
          if (selectionIds.length < 2) continue;
          const key = `${eventId}:${groupKey}:${selectionIds.join("|")}`;
          candidates.set(key, { eventId, groupKey, selectionIds });
          if (candidates.size >= 32) return;
        }
      }
    }
    Object.values(record).slice(0, 64).forEach((child) => visit(child, depth + 1));
  };
  visit(body, 0);
  return [...candidates.values()];
}

export function inspectSbobetMarketLabelEvidence(source: string): readonly SbobetMarketLabelEvidence[] {
  const bounded = source.slice(0, 10_000_000);
  const patterns = [
    { label: "FIRST_HALF_OVER_UNDER" as const,
      expression: /(?:first|1st)\s*half\s*(?:over\s*\/?\s*under|total)|(?:hiệp|hiep)\s*1\s*(?:tài\s*xỉu|tai\s*xiu)/giu },
    { label: "FIRST_HALF_HANDICAP" as const,
      expression: /(?:first|1st)\s*half\s*(?:asian\s*)?handicap|(?:chấp|chap)\s*(?:hiệp|hiep)\s*1/giu },
    { label: "SECOND_HALF_OVER_UNDER" as const,
      expression: /(?:(?:second|2nd)\s*half|2h)\s*(?:over\s*\/?\s*under|total)|(?:hiệp|hiep)\s*2.{0,30}(?:tài\s*\/?\s*xỉu|tai\s*\/?\s*xiu)|(?:tài\s*\/?\s*xỉu|tai\s*\/?\s*xiu).{0,30}(?:hiệp|hiep)\s*2/giu },
    { label: "SECOND_HALF_HANDICAP" as const,
      expression: /(?:(?:second|2nd)\s*half|2h)\s*(?:asian\s*)?handicap|(?:hiệp|hiep)\s*2.{0,30}(?:chấp|chap)|(?:chấp|chap).{0,30}(?:hiệp|hiep)\s*2/giu }
  ];
  const evidence: SbobetMarketLabelEvidence[] = [];
  for (const { label, expression } of patterns) {
    for (const match of bounded.matchAll(expression)) {
      if (evidence.length >= 16 || match.index === undefined) break;
      const prefix = bounded.slice(Math.max(0, match.index - 96), match.index);
      const keys = [...prefix.matchAll(/(?:^|[,{;])\s*["']?(\d{1,5})["']?\s*:/gu)]
        .map((candidate) => candidate[1]!)
        .slice(-1);
      const contextShape = bounded.slice(Math.max(0, match.index - 96), match.index + match[0].length + 96)
        .replace(/https?:\/\/[^\s"']+/gu, "URL")
        .replace(/\d{6,}/gu, "N")
        .replace(/[A-Za-z_$][A-Za-z0-9_$-]*/gu, "W")
        .replace(/\s+/gu, " ")
        .slice(0, 240);
      evidence.push({ label, nearbyNumericKeys: [...new Set(keys)], contextShape });
    }
  }
  return evidence;
}

function market(value: unknown, type: "FT_TOTAL" | "FT_AH" | "FH_TOTAL" | "FH_AH"): SbobetCatalogMarket | null {
  if (typeof value !== "string") return null;
  const tokens = value.trim().split(/\s+/u);
  const line = tokens[0];
  if (line === undefined || !halfGoalLine(line)) return null;
  const isTotal = type === "FT_TOTAL" || type === "FH_TOTAL";
  const isHandicap = type === "FT_AH" || type === "FH_AH";
  const first = pair(tokens[1], isTotal ? "OVER" : "HOME");
  const second = pair(tokens[2], isTotal ? "UNDER" : "AWAY");
  if (first === null || second === null) return null;
  const favored = isHandicap ? tokens[3] : null;
  const marketId = isHandicap ? tokens[4] : tokens[3];
  if (typeof marketId !== "string" || !/^\d{4,30}$/u.test(marketId) ||
    (isHandicap && favored !== "h" && favored !== "a")) return null;
  const selections = isHandicap ? [
    { ...first, lineText: favored === "h" ? line : null },
    { ...second, lineText: favored === "a" ? line : null }
  ] : [first, second];
  return { marketId, marketType: type, lineText: isTotal ? line : null, selections };
}

export function extractSbobetDirectCatalogRecords(
  body: unknown, fallbackRecords: readonly SbobetCatalogInputRecord[]
): readonly SbobetCatalogInputRecord[] {
  const fallback = new Map(fallbackRecords.map((record) => [record.eventId, record]));
  const records = new Map<string, SbobetCatalogInputRecord>();
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: body, depth: 0 }];
  const visited = new Set<object>();
  const maxVisitedNodes = 50_000;
  while (stack.length > 0 && visited.size < maxVisitedNodes && records.size < fallback.size) {
    const current = stack.pop()!;
    const value = current.value;
    if (current.depth > 20 || value === null || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], depth: current.depth + 1 });
      }
      continue;
    }
    const raw = value as Record<string, unknown>;
    const eventId = typeof raw["8"] === "number" || typeof raw["8"] === "string" ? String(raw["8"]) : null;
    const teams = [raw["2"], raw["3"]];
    const markets = raw["7"];
    const existing = eventId === null ? undefined : fallback.get(eventId);
    if (eventId !== null && existing !== undefined && teams.every((team) => typeof team === "string") &&
      typeof markets === "object" && markets !== null && !Array.isArray(markets)) {
      const parsed = Object.entries(markets as Record<string, unknown>).flatMap(([key, rows]) => {
        const marketType = key === "3" ? "FT_TOTAL" as const : key === "4" ? "FH_TOTAL" as const
          : key === "5" ? "FT_AH" as const : key === "6" ? "FH_AH" as const : null;
        if (marketType === null || !Array.isArray(rows)) return [];
        return rows.flatMap((row) => {
          const candidate = market(row, marketType);
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
    const children = Object.values(raw);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ value: children[index], depth: current.depth + 1 });
    }
  }
  return [...records.values()];
}
