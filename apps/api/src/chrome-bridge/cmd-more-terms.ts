import type { MarketType, NativeMarketObservation } from "@tool-chenh/contracts";

interface Leg {
  readonly index: number;
  readonly marketType: MarketType;
  readonly selection: string;
  readonly selectionId: string;
  readonly line: string | null;
}
export interface CmdMoreTerms {
  readonly legs: readonly Leg[];
  readonly outcomeLabels: readonly string[];
  readonly nativeSelections: NonNullable<NativeMarketObservation["nativeSelections"]>;
  readonly reason: string | null;
}

/** CMD's own GetAllOdds/onExtraBetTableLoaded layout, not another book's codes.
 * Proof: saved public BetViewHdpOU asset, offsets 358123..371993 (renderer),
 * 158704 (BETTYPE), 175263 (decimal formatters), 376862 (native click tuple).
 * The CS final slot is an AOS bitmask; it is metadata, never an odds selection.
 */
export function cmdMoreTerms(eventId: string, period: "FT" | "FH", path: string, row: readonly unknown[]): CmdMoreTerms | null {
  const ft = period === "FT";
  const flag = ft ? 0 : 1;
  const legs: Leg[] = [];
  const labels = row.map((_, i) => `OUTCOME_${i + 1}`);
  const identities = new Map<number, string>();
  let shape = true, wholeClosed = false, unresolvedAos = false;
  const add = (index: number, marketType: MarketType, selection: string, type: string, team: string, parameter = 0, line: string | null = null): void => {
    const selectionId = `${eventId}:${type}:${team}:${parameter}:${flag}`;
    labels[index] = selection; identities.set(index, selectionId);
    legs.push({ index, marketType, selection, selectionId, line });
  };
  const lowDecimal = (price: unknown): boolean => typeof price === "number" && price > 0 && price < 1;
  if (path === (ft ? "4" : "2")) {
    const width = ft ? 5 : 4;
    const count = width * width;
    shape = row.length === count + 2 && Number.isSafeInteger(row[count + 1]) && Number(row[count + 1]) >= 0;
    if (shape) {
      for (let i = 0; i < count; i++) add(i, ft ? "FT_CORRECT_SCORE" : "FH_CORRECT_SCORE",
        `SCORE_${Math.floor(i / width)}_${i % width}`, "CS", "Home", Math.floor(i / width) * 10 + i % width);
      identities.set(count, `${eventId}:CS:Home:-99:${flag}`); labels[count] = "AOS_DOMAIN_UNPROVEN";
      labels[count + 1] = "AOS_SCORE_MASK_METADATA";
      unresolvedAos = validCmdMoreDecimal(row[count]);
    }
  } else if (ft && path === "6") {
    shape = row.length === 9;
    if (shape) for (let i = 0; i < 9; i++) {
      const names = ["HOME", "DRAW", "AWAY"], codes = ["H", "D", "A"];
      const code = `${codes[Math.floor(i / 3)]}${codes[i % 3]}`;
      add(i, "FT_HALF_FULL_RESULT", `${names[Math.floor(i / 3)]}_${names[i % 3]}`, code, code);
    }
  } else if (path === (ft ? "5" : "3")) {
    shape = row.length === 5; wholeClosed = row.some(lowDecimal);
    if (shape) {
      for (const [type, indexes, nativeType] of [[ft ? "FT_FIRST_GOAL_TEAM" : "FH_FIRST_GOAL_TEAM", [0, 2, 4], "FG"],
        [ft ? "FT_LAST_GOAL_TEAM" : "FH_LAST_GOAL_TEAM", [1, 3, 4], "LG"]] as const) {
        indexes.forEach((index, i) => add(index, type, ["HOME", "AWAY", "NONE"][i]!, i === 2 ? "NG" : nativeType, i === 1 ? "Away" : "Home"));
      }
    }
  } else if (path === (ft ? "7" : "4")) {
    shape = row.length === 5 && typeof row[0] === "boolean" && typeof row[1] === "number" &&
      Number.isSafeInteger(row[1]) && (row[1] === -999 || row[1] >= 0 && row[1] <= 99);
    wholeClosed = row[1] === -999 || row.slice(2).some(lowDecimal);
    if (shape) {
      labels[0] = "HOME_GIVES_HANDICAP_METADATA"; labels[1] = "HANDICAP_METADATA";
      const magnitude = Number(row[1]);
      for (let i = 0; i < 3; i++) add(i + 2, ft ? "FT_EUROPEAN_HANDICAP" : "FH_EUROPEAN_HANDICAP",
        ["HOME", "DRAW", "AWAY"][i]!, "HP3", i === 2 ? "Away" : "Home",
        (row[0] ? -1 : 1) * (magnitude * 10 + i + 1), String((row[0] ? -1 : 1) * magnitude));
    }
  } else if (path === (ft ? "8.0" : "5.0")) {
    const ranges = ft ? [[0, 1, 1], [2, 3, 23], [4, 6, 46], [7, "PLUS", 70]] as const
      : [[0, 1, 1], [2, 3, 23], [4, "PLUS", 40]] as const;
    shape = row.length === ranges.length;
    if (shape) ranges.forEach(([lower, upper, parameter], i) => add(i, ft ? "FT_GOAL_RANGE" : "FH_GOAL_RANGE", `RANGE_${lower}_${upper}`, "TG", "Home", parameter));
  } else if (path === (ft ? "8.1" : "5.1") || ft && (path === "8.2" || path === "8.3")) {
    const team = path === "8.2" ? "HOME" : path === "8.3" ? "AWAY" : null;
    const cap = ft && team === null ? 6 : 3;
    shape = row.length === cap + 1;
    if (shape) for (let i = 0; i <= cap; i++) add(i, team === "HOME" ? "HOME_FT_GOAL_RANGE" : team === "AWAY" ? "AWAY_FT_GOAL_RANGE"
      : ft ? "FT_GOAL_RANGE" : "FH_GOAL_RANGE", `RANGE_${i}_${i === cap ? "PLUS" : i}`,
    team === "HOME" ? "HTG" : team === "AWAY" ? "ATG" : "ETG", team === "AWAY" ? "Away" : "Home", i === cap ? cap * 10 : i);
  } else return null;

  const nativeSelections = [...identities].sort(([a], [b]) => a - b).map(([index, selectionId]) => ({
    selectionId, outcomeId: null, line: null, price: typeof row[index] === "number" ? String(row[index]) : null,
    rawFormat: "DECIMAL" as const, ...(wholeClosed || row[index] === -999 || row[index] === 0 || lowDecimal(row[index])
      ? { status: "CLOSED" as const } : validCmdMoreDecimal(row[index]) ? { status: "OPEN" as const } : {})
  }));
  return { legs: shape && !wholeClosed ? legs.filter(leg => validCmdMoreDecimal(row[leg.index])) : [],
    outcomeLabels: labels, nativeSelections,
    reason: !shape ? "INVALID_NATIVE_MORE_SHAPE" : wholeClosed ? "NATIVE_MARKET_CLOSED"
      : unresolvedAos ? "CANONICAL_MARKET_MAPPED_WITH_UNRESOLVED_AOS" : null };
}

export function validCmdMoreDecimal(price: unknown): price is number {
  return typeof price === "number" && Number.isFinite(price) && price > 1;
}
