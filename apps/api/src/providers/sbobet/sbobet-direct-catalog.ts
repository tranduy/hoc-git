import { isSupportedFootballTwoWayLine, normalizeSbobetCatalog,
  type SbobetCatalogInputRecord, type SbobetCatalogMarket,
  type SbobetCatalogSelection } from "@tool-chenh/adapters";
import { footballBinaryMarketSpec, type NativeMarketObservation } from "@tool-chenh/contracts";

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

function pair(value: unknown, selection: SbobetCatalogSelection["selection"]): SbobetCatalogSelection | null {
  if (typeof value !== "string") return null;
  const match = pairPattern.exec(value);
  if (match === null || Number(match[1]) === 0 || Math.abs(Number(match[1])) > 1) return null;
  const expectedSide = selection === "HOME" || selection === "OVER" ? "h" : "a";
  if (!match[2]!.endsWith(expectedSide)) return null;
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

type SbobetTwoWayMarketType = Exclude<SbobetCatalogMarket["marketType"], "FT_1X2">;

const totalMarketTypes = new Set<SbobetTwoWayMarketType>([
  "FT_TOTAL", "FH_TOTAL", "SH_TOTAL", "CORNER_FT_TOTAL", "CORNER_FH_TOTAL",
  "CARD_FT_TOTAL", "CARD_FH_TOTAL"
]);
const sbobetMarketTypeByGroup: Readonly<Record<string, SbobetTwoWayMarketType>> = {
  "3": "FT_TOTAL", "4": "FH_TOTAL", "5": "FT_AH", "6": "FH_AH",
  "19": "CORNER_FT_AH", "20": "CORNER_FH_AH",
  "21": "CORNER_FT_TOTAL", "22": "CORNER_FH_TOTAL",
  "31": "CARD_FT_TOTAL", "32": "CARD_FH_TOTAL",
  "33": "CARD_FT_AH", "34": "CARD_FH_AH",
  "80": "SH_TOTAL", "85": "SH_AH"
};
const sbobetThreeWayGroups = new Set(["1", "2", "17", "18", "29", "30", "68", "81", "82", "87", "88", "89", "90", "97"]);
const sbobetRefundGroups = new Set(["75", "150", "151"]);

function market(value: unknown, type: SbobetTwoWayMarketType): SbobetCatalogMarket | null {
  if (typeof value !== "string") return null;
  const tokens = value.trim().split(/\s+/u);
  const line = tokens[0];
  if (line === undefined || !isSupportedFootballTwoWayLine(line)) return null;
  const isTotal = totalMarketTypes.has(type);
  const isHandicap = !isTotal;
  const first = pair(tokens[1], isTotal ? "OVER" : "HOME");
  const second = pair(tokens[2], isTotal ? "UNDER" : "AWAY");
  if (first === null || second === null) return null;
  const favored = isHandicap ? tokens[3] : null;
  const marketId = isHandicap ? tokens[4] : tokens[3];
  if (typeof marketId !== "string" || !/^\d{4,30}$/u.test(marketId) ||
    (isHandicap && favored !== "h" && favored !== "a")) return null;
  const zeroHandicap = isHandicap && Number(line) === 0;
  const selections = zeroHandicap ? [
    { ...first, lineText: "0" }, { ...second, lineText: "0" }
  ] : isHandicap ? [
    { ...first, lineText: favored === "h" ? line : null },
    { ...second, lineText: favored === "a" ? line : null }
  ] : [first, second];
  return { marketId, marketType: type, lineText: isTotal ? line : null, selections,
    ...(zeroHandicap ? { handicapLineFormat: "SIGNED" as const } : {}) };
}

function eventRecord(raw: Record<string, unknown>, existing: SbobetCatalogInputRecord,
  markets: readonly SbobetCatalogMarket[]): SbobetCatalogInputRecord | null {
  const teams = [raw["2"] === undefined ? existing.teamNames[0] : raw["2"],
    raw["3"] === undefined ? existing.teamNames[1] : raw["3"]];
  if (!teams.every((team) => typeof team === "string")) return null;
  const parsedStart = typeof raw["0"] === "string" ? Date.parse(raw["0"]) : Number.NaN;
  return { ...existing,
    ...(Number.isFinite(parsedStart) ? { startAtUtcMs: parsedStart } : {}),
    teamNames: teams as readonly string[], markets };
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
    const markets = raw["7"];
    const existing = eventId === null ? undefined : fallback.get(eventId);
    if (eventId !== null && existing !== undefined &&
      typeof markets === "object" && markets !== null && !Array.isArray(markets)) {
      const nativeGroups = Object.entries(markets as Record<string, unknown>);
      const validContainer = nativeGroups.every(([, rows]) => Array.isArray(rows));
      const parsed = nativeGroups.flatMap(([key, rows]) => {
        const marketType = sbobetMarketTypeByGroup[key] ?? null;
        if (marketType === null || !Array.isArray(rows)) return [];
        return rows.flatMap((row) => {
          const candidate = market(row, marketType);
          return candidate === null ? [] : [candidate];
        });
      });
      const unique = parsed.filter((candidate, index) => parsed.findIndex((other) => other.marketId === candidate.marketId) === index);
      // Keep the event even when every native group is not mapped yet. The
      // accompanying inventory observation makes new native groups measurable.
      // An explicit empty container is valid empty membership; only the caller
      // knows whether this receipt is authoritative detail or a sparse delta.
      const record = validContainer ? eventRecord(raw, existing, unique) : null;
      if (record !== null) records.set(eventId, record);
    }
    const children = Object.values(raw);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ value: children[index], depth: current.depth + 1 });
    }
  }
  return [...records.values()];
}

export function extractSbobetNativeMarketObservations(
  body: unknown,
  fallbackRecords: readonly SbobetCatalogInputRecord[],
  observedAtMs: number
): readonly NativeMarketObservation[] {
  const fallback = new Map(fallbackRecords.map((record) => [record.eventId, record]));
  const observations: NativeMarketObservation[] = [];
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: body, depth: 0 }];
  const visited = new Set<object>();
  while (stack.length > 0 && visited.size < 50_000 && observations.length < 100_000) {
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
    const eventIdValue = raw["8"];
    const eventId = typeof eventIdValue === "number" || typeof eventIdValue === "string"
      ? String(eventIdValue) : null;
    const groups = raw["7"];
    if (eventId !== null && fallback.has(eventId) && groups !== null && typeof groups === "object" && !Array.isArray(groups)) {
      const nativeGroups = Object.entries(groups as Record<string, unknown>);
      const validContainer = nativeGroups.every(([, rows]) => Array.isArray(rows));
      for (const [groupKey, rows] of nativeGroups) {
        if (!Array.isArray(rows)) {
          observations.push({ provider: "SBOBET", category: "FOOTBALL", providerEventId: eventId,
            providerMarketId: `${eventId}:native:${groupKey}:group`, nativeType: groupKey,
            nativeLabel: null, nativeScope: null, outcomeLabels: [], observedAtMs,
            disposition: "EXCLUDED", reason: "INVALID_NATIVE_GROUP_SHAPE" });
          continue;
        }
        const mappedType = sbobetMarketTypeByGroup[groupKey] ?? null;
        for (const [rowIndex, rawRow] of rows.entries()) {
          const parsed = mappedType === null ? null : market(rawRow, mappedType);
          const rowText = typeof rawRow === "string" ? rawRow : "";
          const tokens = rowText.trim().split(/\s+/u);
          // Unknown groups have no proven market-ID position. Their opaque
          // inventory identity must never collide with a retained mapped row.
          const nativeMarketId = mappedType === null
            ? undefined
            : tokens[totalMarketTypes.has(mappedType) ? 3 : 4];
          const fallbackMarketId = nativeMarketId !== undefined && /^\d{4,30}$/u.test(nativeMarketId)
            ? nativeMarketId : `${eventId}:native:${groupKey}:${rowIndex}`;
          const selectionSides = [...rowText.matchAll(/\*\d{1,40}([had])/gu)].map((match) => match[1]!.toUpperCase());
          const spec = mappedType === null ? null : footballBinaryMarketSpec(mappedType);
          const candidate = parsed === null || !validContainer ? null : eventRecord(raw, fallback.get(eventId)!, [parsed]);
          const normalized = candidate !== null && normalizeSbobetCatalog([candidate], {
            observedAtMs, receivedMonotonicMs: 0, sequence: 0
          }).markets.length === 1;
          const excludedReason = typeof rawRow !== "string" ? "INVALID_NATIVE_ROW_SHAPE"
            : parsed !== null && !validContainer ? "INVALID_NATIVE_GROUP_SHAPE"
            : parsed !== null && !normalized ? "NORMALIZATION_REJECTED"
            : sbobetThreeWayGroups.has(groupKey) ? "THREE_WAY_OUTCOME_DOMAIN"
            : sbobetRefundGroups.has(groupKey) ? "PUSH_OR_REFUND_SETTLEMENT" : null;
          observations.push({ provider: "SBOBET", category: "FOOTBALL", providerEventId: eventId,
            providerMarketId: parsed?.marketId ?? fallbackMarketId, nativeType: groupKey,
            nativeLabel: null, nativeScope: spec?.scope ?? null,
            outcomeLabels: selectionSides,
            observedAtMs, disposition: normalized ? "NORMALIZED"
              : excludedReason !== null || mappedType !== null ? "EXCLUDED" : "UNMAPPED",
            reason: normalized ? "CANONICAL_MARKET_MAPPED" : excludedReason ??
              (mappedType !== null ? "INVALID_TWO_WAY_SHAPE" : "NATIVE_TYPE_UNMAPPED") });
        }
      }
    }
    const children = Object.values(raw);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ value: children[index], depth: current.depth + 1 });
    }
  }
  return observations;
}

export function mergeSbobetSocketCatalogRecords(
  bootstrap: readonly SbobetCatalogInputRecord[],
  bodies: readonly unknown[]
): readonly SbobetCatalogInputRecord[] {
  const records = new Map(bootstrap.map((record) => [record.eventId, record]));
  for (const body of bodies.slice(-500)) {
    const retained = [...records.values()];
    const updates = extractSbobetDirectCatalogRecords(body, retained);
    const observations = extractSbobetNativeMarketObservations(body, retained, 0);
    for (const record of updates) {
      const existing = records.get(record.eventId);
      const incomingIds = new Set(record.markets.map((candidate) => candidate.marketId));
      const invalidatedIds = new Set(observations.filter((observation) =>
        observation.providerEventId === record.eventId &&
        sbobetMarketTypeByGroup[observation.nativeType] !== undefined &&
        /^\d{4,30}$/u.test(observation.providerMarketId) && !incomingIds.has(observation.providerMarketId))
        .map((observation) => observation.providerMarketId));
      records.set(record.eventId, { ...record,
        markets: [...new Map([...(existing?.markets ?? []).filter((candidate) => !invalidatedIds.has(candidate.marketId)),
          ...record.markets]
          .map((candidate) => [candidate.marketId, candidate])).values()] });
    }
  }
  return [...records.values()];
}
