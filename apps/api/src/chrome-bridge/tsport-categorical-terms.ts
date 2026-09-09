import { isValidProviderPlayerIdentity, type MarketType, type ProviderPlayerIdentity } from "@tool-chenh/contracts";

interface Terms {
  readonly marketType: MarketType;
  readonly lineText: string | null;
  /** AP slots 0 / 2 / 3, not the order of digits inside a combination code. */
  readonly selections: readonly string[];
  readonly handicapLineFormat?: "SIGNED";
  readonly player?: ProviderPlayerIdentity;
}

const rangeTypes: Readonly<Record<string, readonly [MarketType, MarketType]>> = {
  "14": ["FT_GOAL_RANGE", "FT_TOTAL"], "15": ["FH_GOAL_RANGE", "FH_TOTAL"],
  "132": ["HOME_FT_GOAL_RANGE", "HOME_FT_TOTAL"], "133": ["AWAY_FT_GOAL_RANGE", "AWAY_FT_TOTAL"],
  "131": ["CORNER_FT_RANGE", "CORNER_FT_TOTAL"], "136": ["CORNER_FH_RANGE", "CORNER_FH_TOTAL"],
  "134": ["HOME_CORNER_FT_RANGE", "HOME_CORNER_FT_TOTAL"], "135": ["AWAY_CORNER_FT_RANGE", "AWAY_CORNER_FT_TOTAL"]
};
const slotTypes: Readonly<Record<string, readonly [MarketType, readonly string[]]>> = {
  "65": ["FT_HIGHEST_SCORING_HALF", ["FIRST_HALF", "SECOND_HALF", "EQUAL"]],
  "87": ["HOME_FT_HIGHEST_SCORING_HALF", ["FIRST_HALF", "SECOND_HALF", "EQUAL"]],
  "88": ["AWAY_FT_HIGHEST_SCORING_HALF", ["FIRST_HALF", "SECOND_HALF", "EQUAL"]],
  "17": ["CORNER_FT_1X2", ["HOME", "AWAY", "DRAW"]], "18": ["CORNER_FH_1X2", ["HOME", "AWAY", "DRAW"]],
  "29": ["CARD_FT_1X2", ["HOME", "AWAY", "DRAW"]], "30": ["CARD_FH_1X2", ["HOME", "AWAY", "DRAW"]],
  "138": ["YELLOW_CARD_FT_1X2", ["HOME", "AWAY", "DRAW"]],
  "143": ["YELLOW_CARD_FT_DOUBLE_CHANCE", ["HOME_DRAW", "DRAW_AWAY", "HOME_AWAY"]],
  "150": ["FT_HOME_NO_BET", ["DRAW", "AWAY"]],
  "151": ["FT_AWAY_NO_BET", ["HOME", "DRAW"]],
  "23": ["ET_1X2", ["HOME", "AWAY", "DRAW"]],
  "24": ["ET_FH_1X2", ["HOME", "AWAY", "DRAW"]]
};
export const tsportCategoricalGroups = new Set(["10", "11", "16", "75", "68", "81", "82", "98", "146", "147", "153",
  ...Object.keys(rangeTypes), ...Object.keys(slotTypes)]);

const single = (marketType: MarketType, selection: string, lineText: string | null = null): Terms =>
  ({ marketType, selections: [selection], lineText });

/** Tables verified against AP's own public renderer, not another book's numeric codes.
 * See docs/apsport-categorical-normalization-2026-09-10.md for the evidence and exclusions.
 * Only boundary ranges have the same win/loss partition as a half-unit total.
 */
export function decodeTsportCategoricalTerms(group: string, line: string | null, live: boolean,
  context?: { readonly playerId: string | null; readonly playerName: string | null }): Terms | null {
  if (line === null) return null;
  if (group === "146" || group === "153") {
    if (!/^[1-9]\d{0,2}(?:\.0+)?$/u.test(line)) return null;
    const lineText = String(Number(line));
    if (group === "146") return { marketType: "FT_GOAL_NUMBER_TEAM", lineText, selections: ["HOME", "AWAY", "NO_GOAL"] };
    const player = { providerPlayerId: context?.playerId ?? "", name: context?.playerName ?? "", teamSide: null };
    return isValidProviderPlayerIdentity(player)
      ? { marketType: "PLAYER_FT_GOAL_NUMBER_SCORER", lineText, selections: ["YES"], player } : null;
  }
  if (group === "147") {
    // AP's decimal-looking field is the score at which the remainder wager begins.
    const score = /^(0|[1-9]\d?)\.(0|[1-9]\d?)$/u.exec(line);
    return score === null ? null : { marketType: "FT_REMAINING_RESULT", lineText: null,
      selections: ["HOME", "AWAY", "DRAW"].map(side => `FROM_SCORE_${score[1]}_${score[2]}_${side}`) };
  }
  if (group === "10" || group === "11") {
    const score = /^(0|[1-9]\d?):(0|[1-9]\d?)$/u.exec(line);
    // 9:9 is AOS (any other score), whose complement depends on the offered score list.
    if (score === null || line === "9:9") return null;
    if (line === "0:0") return single(group === "10" ? "FT_TOTAL" : "FH_TOTAL", "UNDER", "0.5");
    return single(group === "10" ? "FT_CORRECT_SCORE" : "FH_CORRECT_SCORE", `SCORE_${score[1]}_${score[2]}`);
  }
  const rangeTypesForGroup = rangeTypes[group];
  if (rangeTypesForGroup !== undefined) {
    const interval = /^(0|[1-9]\d?)[:-](0|[1-9]\d?)$/u.exec(line);
    const tail = /^([1-9]\d?)\+$/u.exec(line);
    if (tail !== null) return single(rangeTypesForGroup[1], "OVER", String(Number(tail[1]) - 0.5));
    if (interval === null || Number(interval[1]) > Number(interval[2])) return null;
    if (interval[1] === "0") return single(rangeTypesForGroup[1], "UNDER", String(Number(interval[2]) + 0.5));
    return single(rangeTypesForGroup[0], `RANGE_${interval[1]}_${interval[2]}`);
  }
  if (group === "16" || group === "75") {
    if (!/^0(?:\.0+)?$/u.test(line)) return null;
    // Live AH can settle on remaining goals; do not equate that with the full-period DNB result.
    return live ? { marketType: group === "16" ? "FT_DRAW_NO_BET" : "FH_DRAW_NO_BET",
      lineText: null, selections: ["HOME", "AWAY"] }
      : { marketType: group === "16" ? "FT_AH" : "FH_AH", lineText: "0",
        handicapLineFormat: "SIGNED", selections: ["HOME", "AWAY"] };
  }
  const slots = slotTypes[group];
  if (slots !== undefined) return /^0(?:\.0+)?$/u.test(line)
    ? { marketType: slots[0], selections: slots[1], lineText: null } : null;
  if (group === "68") {
    if (!/^[123]{2}$/u.test(line)) return null;
    const outcomes: Readonly<Record<string, string>> = { "1": "HOME", "2": "AWAY", "3": "DRAW" };
    return single("FT_HALF_FULL_RESULT", `${outcomes[line[0]!]}_${outcomes[line[1]!]}`);
  }
  if (group === "81" || group === "98") {
    if (!/^[123][45]$/u.test(line)) return null;
    const outcomes = group === "81" ? ["HOME", "DRAW", "AWAY"] : ["HOME_DRAW", "HOME_AWAY", "DRAW_AWAY"];
    return single(group === "81" ? "FT_RESULT_BTTS" : "FT_DOUBLE_CHANCE_BTTS",
      `${outcomes[Number(line[0]) - 1]}_${line[1] === "4" ? "YES" : "NO"}`);
  }
  if (group === "82") {
    const value = /^([1-6]):((?:0|[1-9]\d?)\.5)$/u.exec(line);
    if (value === null) return null;
    const selections = ["HOME_OVER", "HOME_UNDER", "DRAW_OVER", "DRAW_UNDER", "AWAY_OVER", "AWAY_UNDER"];
    return single("FT_RESULT_TOTAL", selections[Number(value[1]) - 1]!, value[2]!);
  }
  return null;
}
