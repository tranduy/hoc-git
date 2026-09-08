import { isSupportedFootballTwoWayLine,
  type SbobetCatalogInputRecord, type SbobetCatalogMarket,
  type SbobetCatalogSelection } from "@tool-chenh/adapters";
import { footballBinaryMarketSpec, type NativeMarketObservation } from "@tool-chenh/contracts";

type Row = readonly unknown[];

function row(value: unknown): Row | null { return Array.isArray(value) ? value : null; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function identity(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : text(value);
}
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

function selection(value: unknown, allowMissingLine = false): BtiSelection | null {
  const item = row(value);
  const formats = row(item?.[6]);
  const id = identity(item?.[0]);
  const side = item?.[7];
  const rawLine = item?.[13];
  const line = allowMissingLine && (rawLine === null || rawLine === undefined || rawLine === "") ? 0 : rawLine;
  const malay = text(formats?.[5]);
  if (id === "" || typeof side !== "number" || !Number.isFinite(side) ||
    (!allowMissingLine && side !== 1 && side !== 3) || !halfLine(line) ||
    !/^-?(?:0|1)(?:\.\d+)?$/u.test(malay) || Number(malay) === 0) return null;
  return { id, name: localized(item?.[1]) || localized(item?.[2]) || text(item?.[2]),
    side, line, malay, locked: item?.[3] === true };
}

function detailSelection(value: unknown, allowMissingLine = false): BtiSelection | null {
  const item = row(value);
  const formats = row(item?.[8]);
  const id = identity(item?.[0]);
  const name = localized(item?.[2]) || text(item?.[2]);
  const side = item?.[9];
  const rawLine = item?.[16];
  const line = typeof rawLine === "number" && Number.isFinite(rawLine) ? rawLine
    : allowMissingLine && (rawLine === null || rawLine === undefined || rawLine === "") ? 0 : Number.NaN;
  const malay = text(formats?.[5]);
  if (id === "" || name === "" || typeof side !== "number" || !Number.isFinite(side) ||
    typeof line !== "number" || !Number.isFinite(line) || Math.abs(line) > 100 ||
    !/^-?(?:0|1)(?:\.\d+)?$/u.test(malay) || Number(malay) === 0 ||
    item?.[13] === true) return null;
  return { id, name, side, line, malay, locked: item?.[5] === true };
}

function normalizedLabel(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/[đð]/giu, "d").toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, " ").trim();
}

function sameName(actual: string, expected: string): boolean {
  return actual === expected || (actual.length >= 4 && expected.length >= 4 &&
    (actual.includes(expected) || expected.includes(actual)));
}

function namedTeam(label: string, expectedTeams?: readonly [string, string]): "HOME" | "AWAY" | null {
  if (expectedTeams === undefined) return null;
  const evidence = normalizedLabel(label);
  const home = normalizedLabel(expectedTeams[0]);
  const away = normalizedLabel(expectedTeams[1]);
  const prefix = evidence.split(/\b(?:team|doi|total|tong|cuoc|tai|xiu)\b/u)[0]?.trim() ?? "";
  const homeMatch = sameName(prefix, home);
  const awayMatch = sameName(prefix, away);
  return homeMatch === awayMatch ? null : homeMatch ? "HOME" : "AWAY";
}

function marketType(code: string, label = "", expectedTeams?: readonly [string, string]): SbobetCatalogMarket["marketType"] | null {
  const evidence = normalizedLabel(label);
  const exactBinary: Readonly<Record<string, SbobetCatalogMarket["marketType"]>> = {
    QA38: "FT_ODD_EVEN",
    QA262: "FH_ODD_EVEN",
    QA267: "SH_ODD_EVEN",
    QA158: "FT_BTTS",
    QA2934: "FH_BTTS",
    QA2936: "SH_BTTS",
    QA616: "CORNER_FT_ODD_EVEN",
    QA4409: "SENDING_OFF"
  };
  const exact = exactBinary[code];
  if (exact !== undefined) return exact;
  if (/\b(?:draw no bet|dnb|european handicap)\b/u.test(evidence) ||
    /\b(?:hoa duoc hoan tien|chap chau au)\b/u.test(evidence)) return null;
  if (/\b(?:3 way|three way|3 chieu|3 cua)\b/u.test(evidence) ||
    /^(?:HC270|HC271|HC359|OU621|OU6309)$/u.test(code)) return null;

  const exactLines: Readonly<Record<string, SbobetCatalogMarket["marketType"]>> = {
    HC39: "FT_AH", HC0: "FT_AH", HC1: "FH_AH", HC2: "SH_AH",
    OU39: "FT_TOTAL", OU0: "FT_TOTAL", OU200: "FT_TOTAL", OU249: "FT_TOTAL",
    OU1: "FH_TOTAL", OU201: "FH_TOTAL", OU2: "SH_TOTAL",
    HC619: "CORNER_FT_AH", HC14: "CORNER_FH_AH",
    OU619: "CORNER_FT_TOTAL", OU13: "CORNER_FT_TOTAL", OU14: "CORNER_FH_TOTAL",
    HC10: "CARD_FT_AH", OU10: "CARD_FT_TOTAL", OU6010: "CARD_FT_TOTAL",
    OU4301: "CARD_FH_TOTAL"
  };
  const exactLine = exactLines[code];
  if (exactLine !== undefined) return exactLine;

  // BTI uses a distinct code for each participant's full-time team total.
  // The participant in the native label is part of the canonical identity;
  // an unresolvable or first/second-half team total must stay unmapped.
  if (code === "OU7") {
    const team = namedTeam(label, expectedTeams);
    return team === null ? null : `${team}_FT_TOTAL`;
  }
  const exactTeamBinary: Readonly<Record<string, "FT_CLEAN_SHEET" | "FT_WIN_BOTH_HALVES" |
    "FT_WIN_TO_NIL" | "FT_TO_WIN">> = {
    QA272: "FT_CLEAN_SHEET",
    QA6095: "FT_WIN_BOTH_HALVES",
    QA5185: "FT_WIN_TO_NIL",
    QA6078: "FT_TO_WIN"
  };
  const teamBinary = exactTeamBinary[code];
  if (teamBinary !== undefined) {
    const team = namedTeam(label, expectedTeams);
    return team === null ? null : `${team}_${teamBinary}`;
  }
  // A plausible translated label cannot prove a native market's statistic,
  // period or settlement. Unknown codes stay visible as unmapped observations.
  return null;
}

interface BtiNativeMarket {
  readonly eventId: string;
  readonly marketId: string;
  readonly observationMarketId: string;
  readonly code: string;
  readonly label: string;
  readonly values: readonly unknown[];
  readonly detail: boolean;
  readonly closed: boolean;
  readonly eventClosed?: boolean;
  readonly teamNames?: readonly [string, string];
}

function rawNativeMarkets(payload: unknown): readonly BtiNativeMarket[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return [];
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.data)) {
    return root.data.flatMap((eventValue): BtiNativeMarket[] => {
      const event = row(eventValue);
      if (event === null) return [];
      const eventId = identity(event[0]);
      const participants = row(event[8]) ?? [];
      const names = participants.slice(0, 2).map((participant) => {
        const item = row(participant);
        return localized(item?.[1]) || text(item?.[2]);
      });
      const teamNames = names.length === 2 && names.every(Boolean) ? names as [string, string] : undefined;
      const primaryMarkets = row(event[20]) ?? [];
      return [...primaryMarkets, ...(row(event[33]) ?? [])].flatMap((marketValue, index) => {
        const market = row(marketValue);
        if (market === null) return [];
        const typeValue = row(market[5]);
        const code = text(typeValue?.[0]) || localized(typeValue?.[0]) ||
          text(typeValue?.[1]) || localized(typeValue?.[1]) || text(market[1]) || localized(market[1]) || "UNKNOWN";
        const label = `${text(market[1]) || localized(market[1])} ${text(typeValue?.[1]) ||
          localized(typeValue?.[1])}`.trim();
        const marketId = identity(market[0]);
        // Position preserves every unnamed row in this response. It is evidence
        // identity only; a missing provider ID must never become a quote identity.
        const partition = index < primaryMarkets.length ? 20 : 33;
        const position = index < primaryMarkets.length ? index : index - primaryMarkets.length;
        return [{ eventId, marketId, code, label,
          observationMarketId: marketId || `${eventId}:native:detail:${partition}:${position}`,
          values: row(market[13]) ?? [], detail: true, closed: market[15] === true || market[23] === true,
          eventClosed: event[32] === true,
          ...(teamNames === undefined ? {} : { teamNames }) }];
      });
    });
  }
  const output: BtiNativeMarket[] = [];
  const leagues = row(root.serializedData) ?? [];
  for (const leagueValue of leagues) {
    const league = row(leagueValue);
    for (const eventValue of row(league?.[12]) ?? []) {
      const event = row(eventValue);
      if (event === null) continue;
      const eventId = identity(event[0]);
      const names = rosterNames(event);
      const teamNames = names.length === 2 && names.every(Boolean) ? names as [string, string] : undefined;
      const visit = (candidate: unknown, path: string): void => {
        const item = row(candidate);
        if (item === null) return;
        const metadata = row(item[3]);
        const code = text(metadata?.[0]);
        if (metadata !== null && Array.isArray(item[7])) {
          const marketId = identity(item[0]);
          output.push({ eventId, marketId, observationMarketId: marketId || `${eventId}:native:roster:${path}`,
            code: code || "UNKNOWN",
            label: text(metadata?.[1]), values: row(item[7]) ?? [], detail: false, closed: false,
            ...(teamNames === undefined ? {} : { teamNames }) });
          return;
        }
        item.forEach((value, index) => visit(value, `${path}:${index}`));
      };
      visit(event[8], "8");
    }
  }
  return output;
}

function excludedNativeReason(code: string, label: string): string | null {
  const evidence = normalizedLabel(`${code} ${label}`);
  if (/\b(?:draw no bet|dnb|hoa duoc hoan tien|european handicap|chap chau au)\b/u.test(evidence) ||
    /^HC(?:150|151|157|2220)$/u.test(code)) return "PUSH_OR_REFUND_SETTLEMENT";
  if (/^(?:ML|1X2)/u.test(code) || /\b(?:1x2|match winner|moneyline)\b/u.test(evidence)) {
    return "THREE_WAY_OUTCOME_DOMAIN";
  }
  if (/\b(?:3 way|three way|3 chieu|3 cua)\b/u.test(evidence) ||
    /^(?:HC270|HC271|HC359|OU621|OU6309)$/u.test(code)) return "THREE_WAY_OUTCOME_DOMAIN";
  return null;
}

export function extractBtiNativeMarketIdentities(
  payload: unknown
): readonly { eventId: string; marketId: string }[] {
  return rawNativeMarkets(payload).map(({ eventId, observationMarketId }) => ({ eventId, marketId: observationMarketId }));
}

export function extractBtiNativeMarketObservations(
  payload: unknown,
  observedAtMs: number
): readonly NativeMarketObservation[] {
  const observations: NativeMarketObservation[] = [];
  const resolvedEvents = new Set(extractBtiCatalogRecords(payload).map((record) => record.eventId));
  for (const native of rawNativeMarkets(payload)) {
    const parseSelection = native.detail ? detailSelection : selection;
    const normalized = normalizedMarket(native.marketId, native.code, native.values, parseSelection,
      native.label, native.teamNames, native.detail);
    const labels = native.values.map((value) => {
      const item = row(value);
      const label = native.detail
        ? localized(item?.[2]) || text(item?.[2])
        : localized(item?.[1]) || localized(item?.[2]) || text(item?.[2]);
      return label;
    });
    const outcomeLabels = labels.filter(Boolean).slice(0, 32);
    if (native.closed || native.eventClosed) {
      observations.push({ provider: "BTI", category: "FOOTBALL", providerEventId: native.eventId || "UNKNOWN_EVENT",
        providerMarketId: native.observationMarketId,
        nativeType: native.code || "UNKNOWN", nativeLabel: native.label || null, nativeScope: null,
        outcomeLabels, observedAtMs, disposition: "EXCLUDED", reason: native.eventClosed ? "EVENT_CLOSED" : "MARKET_CLOSED" });
      continue;
    }
    if (normalized.length > 0) {
      if (!resolvedEvents.has(native.eventId)) {
        observations.push({ provider: "BTI", category: "FOOTBALL", providerEventId: native.eventId || "UNKNOWN_EVENT",
          providerMarketId: native.observationMarketId, nativeType: native.code || "UNKNOWN",
          nativeLabel: native.label || null, nativeScope: null, outcomeLabels, observedAtMs,
          disposition: "EXCLUDED", reason: "EVENT_IDENTITY_UNRESOLVED" });
        continue;
      }
      const accounted = new Set<number>();
      for (const market of normalized) {
        const spec = footballBinaryMarketSpec(market.marketType);
        const positions = market.selections.flatMap((selection) => {
          const index = native.values.findIndex((value, position) => {
            if (accounted.has(position)) return false;
            const candidate = parseSelection(value, spec?.linePolicy === "NONE");
            if (candidate?.id !== selection.selectionId) return false;
            const line = market.marketType.endsWith("_AH") && candidate.side === 3 ? -candidate.line : candidate.line;
            return market.lineText === null || String(line) === market.lineText;
          });
          if (index < 0) return [];
          accounted.add(index);
          return [index];
        });
        observations.push({ provider: "BTI", category: "FOOTBALL", providerEventId: native.eventId || "UNKNOWN_EVENT",
          providerMarketId: market.marketId, nativeType: native.code || "UNKNOWN", nativeLabel: native.label || null,
          nativeScope: spec?.scope ?? null, outcomeLabels: positions.map((position) => labels[position]!).filter(Boolean),
          observedAtMs, disposition: "NORMALIZED",
          reason: "CANONICAL_MARKET_MAPPED" });
      }
      if (accounted.size < native.values.length) {
        observations.push({ provider: "BTI", category: "FOOTBALL", providerEventId: native.eventId,
          providerMarketId: native.observationMarketId, nativeType: native.code || "UNKNOWN", nativeLabel: native.label || null,
          nativeScope: null, outcomeLabels: labels.filter((_label, index) => !accounted.has(index))
            .map((label) => label || "UNNAMED_SELECTION").slice(0, 32), observedAtMs, disposition: "EXCLUDED",
          reason: "UNPAIRED_OR_INVALID_NATIVE_SELECTIONS" });
      }
      continue;
    }
    const excluded = excludedNativeReason(native.code, native.label);
    const mapped = marketType(native.code, native.label, native.teamNames) !== null;
    observations.push({ provider: "BTI", category: "FOOTBALL", providerEventId: native.eventId || "UNKNOWN_EVENT",
      providerMarketId: native.observationMarketId,
      nativeType: native.code || "UNKNOWN", nativeLabel: native.label || null, nativeScope: null,
      outcomeLabels, observedAtMs, disposition: excluded !== null || mapped ? "EXCLUDED" : "UNMAPPED",
      reason: excluded ?? (mapped ? "INVALID_TWO_WAY_SHAPE" : "NATIVE_TYPE_UNMAPPED") });
  }
  return observations;
}

function normalizedMarket(
  marketId: string,
  code: string,
  values: readonly unknown[],
  parseSelection: (value: unknown, allowMissingLine?: boolean) => BtiSelection | null,
  label = "",
  expectedTeams?: readonly [string, string],
  validateSelectionNames = true
): readonly SbobetCatalogMarket[] {
  const type = marketType(code, label, expectedTeams);
  if (marketId === "" || type === null) return [];
  const spec = footballBinaryMarketSpec(type);
  if (spec?.linePolicy === "NONE") {
    if (values.length !== 2) return [];
    const candidates = values.map((value) => parseSelection(value, true))
      .filter((item): item is BtiSelection => item !== null);
    if (candidates.length !== 2 || candidates[0]!.id === candidates[1]!.id) return [];
    const outcomeFor = (name: string): "ODD" | "EVEN" | "YES" | "NO" | null => {
      const normalized = normalizedLabel(name);
      if (/^(?:odd|le)$/u.test(normalized)) return "ODD";
      if (/^(?:even|chan)$/u.test(normalized)) return "EVEN";
      if (/^(?:yes|co)$/u.test(normalized)) return "YES";
      if (/^(?:no|khong)$/u.test(normalized)) return "NO";
      return null;
    };
    const selections = candidates.map((item) => ({
      selectionId: item.id,
      selection: outcomeFor(item.name),
      priceText: item.malay,
      locked: item.locked
    }));
    if (selections.some(({ selection }) => selection === null) ||
      new Set(selections.map(({ selection }) => selection)).size !== 2 ||
      selections.some(({ selection }) => !spec.outcomes.includes(selection!))) return [];
    return [{ marketId, marketType: type, lineText: null,
      selections: selections as SbobetCatalogSelection[] }];
  }
  const isHandicap = type.endsWith("_AH");
  const candidates = values.map((value) => parseSelection(value, false))
    .filter((item): item is BtiSelection => item !== null)
    .filter((item) => halfLine(item.line) && (item.side === 1 || item.side === 3));
  const grouped = new Map<string, BtiSelection[]>();
  for (const item of candidates) {
    const key = isHandicap ? String(item.side === 1 ? item.line : -item.line) : String(item.line);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()].flatMap(([line, pair]) => {
    const home = pair.find((item) => item.side === 1);
    const away = pair.find((item) => item.side === 3);
    if (home === undefined || away === undefined || pair.length !== 2 || home.id === away.id) return [];
    if (validateSelectionNames && expectedTeams !== undefined) {
      const homeName = normalizedLabel(home.name);
      const awayName = normalizedLabel(away.name);
      if (isHandicap) {
        const expectedHome = normalizedLabel(expectedTeams[0]);
        const expectedAway = normalizedLabel(expectedTeams[1]);
        if (!sameName(homeName, expectedHome) || !sameName(awayName, expectedAway)) return [];
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
    return [{ marketId: `${marketId}:${line}`, marketType: type, lineText: line, selections,
      ...(isHandicap ? { handicapLineFormat: "SIGNED" as const } : {}) }];
  });
}

function markets(value: unknown, names: readonly string[]): readonly SbobetCatalogMarket[] {
  const found: Row[] = [];
  const visit = (candidate: unknown): void => {
    const item = row(candidate);
    if (item === null) return;
    const metadata = row(item[3]);
    if (identity(item[0]) !== "" && metadata !== null && Array.isArray(item[7])) found.push(item);
    else item.forEach(visit);
  };
  visit(value);
  return found.flatMap((market): SbobetCatalogMarket[] => {
    const code = text(row(market[3])?.[0]);
    return [...normalizedMarket(identity(market[0]), code, row(market[7]) ?? [], selection,
      text(row(market[3])?.[1]), names.length === 2 ? names as [string, string] : undefined, false)];
  });
}

function detailMarkets(value: unknown, teamNames: readonly [string, string]): readonly SbobetCatalogMarket[] {
  const candidates = row(value) ?? [];
  return candidates.flatMap((value): SbobetCatalogMarket[] => {
    const market = row(value);
    if (market === null || market[15] === true || market[23] === true) return [];
    const marketTypeValue = row(market[5]);
    const code = text(marketTypeValue?.[0]) || localized(marketTypeValue?.[0]) ||
      text(marketTypeValue?.[1]) || localized(marketTypeValue?.[1]) || text(market[1]) || localized(market[1]);
    const label = `${text(market[1]) || localized(market[1])} ${text(marketTypeValue?.[1]) ||
      localized(marketTypeValue?.[1])}`;
    return [...normalizedMarket(identity(market[0]), code, row(market[13]) ?? [], detailSelection, label, teamNames)];
  });
}

function detailRecords(payload: Record<string, unknown>): readonly SbobetCatalogInputRecord[] {
  const events = row(payload.data) ?? [];
  return events.flatMap((eventValue): SbobetCatalogInputRecord[] => {
    const event = row(eventValue);
    if (event === null || event[32] === true) return [];
    const eventId = identity(event[0]);
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
      !Number.isFinite(startAtUtcMs) || names.length !== 2 || names.some((name) => name === "")) return [];
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
      const eventId = identity(event?.[0]);
      const names = event === null ? [] : rosterNames(event);
      const scores = row(event?.[4]);
      const eventMarkets = markets(event?.[8], names);
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
