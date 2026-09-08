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

const pairPattern = /^(-?(?:0|[1-9]\d*)(?:\.\d+)?)\*(\d+[had])$/u;

function pair(value: unknown, selection: SbobetCatalogSelection["selection"],
  format: "MALAY" | "DECIMAL", locked: boolean): SbobetCatalogSelection | null {
  if (typeof value !== "string") return null;
  const match = pairPattern.exec(value);
  if (match === null) return null;
  const price = Number(match[1]);
  if (!Number.isFinite(price) || (format === "DECIMAL" ? price <= 1 : price === 0 || Math.abs(price) > 1)) return null;
  const expectedSide = selection === "HOME" || selection === "OVER" || selection === "ODD" || selection === "YES" ? "h" : "a";
  if (!match[2]!.endsWith(expectedSide)) return null;
  return { selectionId: match[2]!, selection, priceText: match[1]!, locked,
    ...(format === "DECIMAL" ? { priceFormat: format } : {}) };
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

interface SbobetNativeMarketLayout {
  readonly type: SbobetTwoWayMarketType;
  readonly layout: "TOTAL" | "HANDICAP" | "ODD_EVEN" | "BTTS" | "YES_NO" | "LINE_YES_NO";
  readonly format: "MALAY" | "DECIMAL";
}

// Public bundle f8af9179 module 75895 z/T8 forces Decimal for these More
// markets independently of the requested style. Chunk 7409 c37303b3 binds
// native groups to their row maps and ODD/EVEN or YES/NO outcome order.
// Card group IDs use tG (native), not the separate Gt bet-placement enum.
const sbobetMarketByGroup: Readonly<Record<string, SbobetNativeMarketLayout>> = {
  "3": { type: "FT_TOTAL", layout: "TOTAL", format: "MALAY" },
  "4": { type: "FH_TOTAL", layout: "TOTAL", format: "MALAY" },
  "5": { type: "FT_AH", layout: "HANDICAP", format: "MALAY" },
  "6": { type: "FH_AH", layout: "HANDICAP", format: "MALAY" },
  "8": { type: "FT_ODD_EVEN", layout: "ODD_EVEN", format: "DECIMAL" },
  "9": { type: "FH_ODD_EVEN", layout: "ODD_EVEN", format: "DECIMAL" },
  "19": { type: "CORNER_FT_AH", layout: "HANDICAP", format: "MALAY" },
  "20": { type: "CORNER_FH_AH", layout: "HANDICAP", format: "MALAY" },
  "21": { type: "CORNER_FT_TOTAL", layout: "TOTAL", format: "MALAY" },
  "22": { type: "CORNER_FH_TOTAL", layout: "TOTAL", format: "MALAY" },
  "31": { type: "CARD_FT_TOTAL", layout: "TOTAL", format: "MALAY" },
  "32": { type: "CARD_FH_TOTAL", layout: "TOTAL", format: "MALAY" },
  "33": { type: "CARD_FT_AH", layout: "HANDICAP", format: "MALAY" },
  "34": { type: "CARD_FH_AH", layout: "HANDICAP", format: "MALAY" },
  "36": { type: "FT_BTTS", layout: "BTTS", format: "DECIMAL" },
  "37": { type: "FH_BTTS", layout: "BTTS", format: "DECIMAL" },
  "56": { type: "CORNER_FT_ODD_EVEN", layout: "ODD_EVEN", format: "DECIMAL" },
  "57": { type: "CORNER_FH_ODD_EVEN", layout: "ODD_EVEN", format: "DECIMAL" },
  "60": { type: "SENDING_OFF", layout: "YES_NO", format: "DECIMAL" },
  "61": { type: "HOME_CORNER_FT_TOTAL", layout: "TOTAL", format: "DECIMAL" },
  "62": { type: "HOME_CORNER_FH_TOTAL", layout: "TOTAL", format: "DECIMAL" },
  "63": { type: "AWAY_CORNER_FT_TOTAL", layout: "TOTAL", format: "DECIMAL" },
  "64": { type: "AWAY_CORNER_FH_TOTAL", layout: "TOTAL", format: "DECIMAL" },
  "69": { type: "HOME_FT_SCORE_BOTH_HALVES", layout: "YES_NO", format: "DECIMAL" },
  "70": { type: "AWAY_FT_SCORE_BOTH_HALVES", layout: "YES_NO", format: "DECIMAL" },
  "71": { type: "HOME_FT_WIN_BOTH_HALVES", layout: "YES_NO", format: "DECIMAL" },
  "72": { type: "AWAY_FT_WIN_BOTH_HALVES", layout: "YES_NO", format: "DECIMAL" },
  "73": { type: "HOME_FT_WIN_EITHER_HALF", layout: "YES_NO", format: "DECIMAL" },
  "74": { type: "AWAY_FT_WIN_EITHER_HALF", layout: "YES_NO", format: "DECIMAL" },
  "76": { type: "HOME_FT_ODD_EVEN", layout: "ODD_EVEN", format: "DECIMAL" },
  "77": { type: "AWAY_FT_ODD_EVEN", layout: "ODD_EVEN", format: "DECIMAL" },
  "78": { type: "HOME_FT_WIN_TO_NIL", layout: "YES_NO", format: "DECIMAL" },
  "79": { type: "AWAY_FT_WIN_TO_NIL", layout: "YES_NO", format: "DECIMAL" },
  "80": { type: "SH_TOTAL", layout: "TOTAL", format: "DECIMAL" },
  "83": { type: "HOME_FT_CLEAN_SHEET", layout: "YES_NO", format: "DECIMAL" },
  "84": { type: "AWAY_FT_CLEAN_SHEET", layout: "YES_NO", format: "DECIMAL" },
  "85": { type: "SH_AH", layout: "HANDICAP", format: "DECIMAL" },
  "86": { type: "SH_ODD_EVEN", layout: "ODD_EVEN", format: "DECIMAL" },
  "99": { type: "FT_BOTH_HALVES_OVER_TOTAL", layout: "LINE_YES_NO", format: "DECIMAL" },
  "100": { type: "FT_BOTH_HALVES_UNDER_TOTAL", layout: "LINE_YES_NO", format: "DECIMAL" },
  "101": { type: "HOME_FT_TOTAL", layout: "TOTAL", format: "DECIMAL" },
  "102": { type: "AWAY_FT_TOTAL", layout: "TOTAL", format: "DECIMAL" }
};
const sbobetThreeWayGroups = new Set(["1", "2", "17", "18", "29", "30", "68", "81", "82", "87", "88", "89", "90", "97"]);
const sbobetRefundGroups = new Set(["16", "75", "150", "151"]);

function nativeMarketIdIndex(layout: SbobetNativeMarketLayout): number {
  return layout.layout === "ODD_EVEN" || layout.layout === "YES_NO" ? 2 : layout.layout === "HANDICAP" ? 4 : 3;
}

function market(value: unknown, groupKey: string): SbobetCatalogMarket | null {
  const descriptor = sbobetMarketByGroup[groupKey];
  if (typeof value !== "string" || descriptor === undefined) return null;
  const { type, layout, format } = descriptor;
  const tokens = value.trim().split(/\s+/u);
  const line = tokens[0];
  const isTotal = layout === "TOTAL";
  const isHandicap = layout === "HANDICAP";
  const hasLine = isTotal || isHandicap || layout === "LINE_YES_NO";
  if (hasLine && (line === undefined || !isSupportedFootballTwoWayLine(line))) return null;
  // The observed BTTS POINT field is a zero placeholder, not a goal line.
  if (layout === "BTTS" && (line === undefined || !/^-?0(?:\.0+)?$/u.test(line))) return null;
  const idIndex = nativeMarketIdIndex(descriptor);
  const suspended = tokens[idIndex + 1];
  if (suspended !== undefined && suspended !== "0" && suspended !== "1") return null;
  const firstIndex = layout === "ODD_EVEN" || layout === "YES_NO" ? 0 : 1;
  const first = pair(tokens[firstIndex], isTotal ? "OVER" : isHandicap ? "HOME" : layout === "ODD_EVEN" ? "ODD" : "YES",
    format, suspended === "1");
  const second = pair(tokens[firstIndex + 1], isTotal ? "UNDER" : isHandicap ? "AWAY" : layout === "ODD_EVEN" ? "EVEN" : "NO",
    format, suspended === "1");
  if (first === null || second === null) return null;
  const favored = isHandicap ? tokens[3] : null;
  const marketId = tokens[idIndex];
  const zeroHandicap = isHandicap && Number(line) === 0;
  if (typeof marketId !== "string" || !/^\d{4,30}$/u.test(marketId) ||
    (isHandicap && favored !== "h" && favored !== "a" && !(zeroHandicap && favored === "-"))) return null;
  const selections = zeroHandicap ? [
    { ...first, lineText: "0" }, { ...second, lineText: "0" }
  ] : isHandicap ? [
    { ...first, lineText: favored === "h" ? line! : null },
    { ...second, lineText: favored === "a" ? line! : null }
  ] : [first, second];
  return { marketId, marketType: type, lineText: isTotal || layout === "LINE_YES_NO" ? line! : null, selections,
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
  if (fallbackRecords.length === 0) return [];
  const fallback = new Map(fallbackRecords.map((record) => [record.eventId, record]));
  const records = new Map<string, SbobetCatalogInputRecord>();
  const components = new Map<string, {
    readonly raw: Record<string, unknown>; readonly groups: ReadonlySet<string>; readonly combinable: boolean;
  }>();
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: body, depth: 0 }];
  const visited = new Set<object>();
  const maxVisitedNodes = 50_000;
  while (stack.length > 0 && visited.size < maxVisitedNodes) {
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
      let combinable = nativeGroups.length > 0 && nativeGroups.every(([, rows]) => Array.isArray(rows) && rows.length > 0);
      const parsed = nativeGroups.flatMap(([key, rows]) => {
        if (sbobetMarketByGroup[key] === undefined || !Array.isArray(rows)) return [];
        return rows.flatMap((row) => {
          const candidate = market(row, key);
          if (candidate === null) combinable = false;
          return candidate === null ? [] : [candidate];
        });
      });
      const unique = parsed.filter((candidate, index) => parsed.findIndex((other) => other.marketId === candidate.marketId) === index);
      // Keep the event even when every native group is not mapped yet. The
      // accompanying inventory observation makes new native groups measurable.
      // An explicit empty container is valid empty membership; only the caller
      // knows whether this receipt is authoritative detail or a sparse delta.
      const record = validContainer ? eventRecord(raw, existing, unique) : null;
      if (record !== null) {
        const prior = records.get(eventId);
        const component = components.get(eventId);
        const groups = new Set(nativeGroups.map(([key]) => key));
        // Observed getEvent emits separate goal/corner components for the same
        // native event. Combine only disjoint groups with exact explicit native
        // teams/kickoff. Empty, overlapping, or conflicting components retain
        // later-container replacement; this is not a sparse-update union.
        const sameEvent = component !== undefined && ["0", "2", "3"].every((key) =>
          typeof raw[key] === "string" && raw[key] !== "" && raw[key] === component.raw[key]) &&
          Number.isFinite(Date.parse(String(raw["0"])));
        const priorIds = new Set(prior?.markets.map((item) => item.marketId));
        if (prior !== undefined && component !== undefined && component.combinable && combinable && sameEvent &&
          [...groups].every((key) => !component.groups.has(key)) &&
          record.markets.every((item) => !priorIds.has(item.marketId))) {
          records.set(eventId, { ...record, markets: [...prior.markets, ...record.markets] });
          components.set(eventId, { raw, groups: new Set([...component.groups, ...groups]), combinable });
        } else {
          records.set(eventId, record);
          components.set(eventId, { raw, groups, combinable });
        }
      }
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
        const descriptor = sbobetMarketByGroup[groupKey];
        const mappedType = descriptor?.type ?? null;
        for (const [rowIndex, rawRow] of rows.entries()) {
          const parsed = market(rawRow, groupKey);
          const rowText = typeof rawRow === "string" ? rawRow : "";
          const tokens = rowText.trim().split(/\s+/u);
          // Unknown groups have no proven market-ID position. Their opaque
          // inventory identity must never collide with a retained mapped row.
          const nativeMarketId = descriptor === undefined
            ? undefined
            : tokens[nativeMarketIdIndex(descriptor)];
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
        sbobetMarketByGroup[observation.nativeType] !== undefined &&
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
