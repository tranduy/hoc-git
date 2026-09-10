import type { SbobetCatalogMarket, SbobetCatalogSelection } from "@tool-chenh/adapters";
import { isFootballCategoricalSelection } from "@tool-chenh/contracts";

type Shape = "SCORE" | "RANGE" | "HALF_FULL" | "RESULT_BTTS" | "DC_BTTS" | "RESULT_TOTAL" |
  "HIGHEST_HALF" | "RESULT" | "DRAW_NO_BET" | "THREE_WAY_TOTAL";
interface Layout {
  readonly type: SbobetCatalogMarket["marketType"];
  readonly shape: Shape;
  readonly idIndex: number;
}
// Native tG IDs and row indices, not the different bet-placement Gt enum.
// Proof: sbobet-categorical-native.fixture.json (public f8af9179 / c37303b3).
export const sbobetCategoricalLayouts: Readonly<Record<string, Layout>> = {
  "10": { type: "FT_CORRECT_SCORE", shape: "SCORE", idIndex: 2 },
  "11": { type: "FH_CORRECT_SCORE", shape: "SCORE", idIndex: 2 },
  "14": { type: "FT_GOAL_RANGE", shape: "RANGE", idIndex: 2 },
  "15": { type: "FH_GOAL_RANGE", shape: "RANGE", idIndex: 2 },
  "16": { type: "FT_DRAW_NO_BET", shape: "DRAW_NO_BET", idIndex: 2 },
  "17": { type: "CORNER_FT_1X2", shape: "RESULT", idIndex: 3 },
  "18": { type: "CORNER_FH_1X2", shape: "RESULT", idIndex: 3 },
  "65": { type: "FT_HIGHEST_SCORING_HALF", shape: "HIGHEST_HALF", idIndex: 3 },
  "68": { type: "FT_HALF_FULL_RESULT", shape: "HALF_FULL", idIndex: 2 },
  "75": { type: "FH_DRAW_NO_BET", shape: "DRAW_NO_BET", idIndex: 2 },
  "81": { type: "FT_RESULT_BTTS", shape: "RESULT_BTTS", idIndex: 2 },
  "82": { type: "FT_RESULT_TOTAL", shape: "RESULT_TOTAL", idIndex: 2 },
  "87": { type: "HOME_FT_HIGHEST_SCORING_HALF", shape: "HIGHEST_HALF", idIndex: 3 },
  "88": { type: "AWAY_FT_HIGHEST_SCORING_HALF", shape: "HIGHEST_HALF", idIndex: 3 },
  "98": { type: "FT_DOUBLE_CHANCE_BTTS", shape: "DC_BTTS", idIndex: 2 },
  "131": { type: "CORNER_FT_RANGE", shape: "RANGE", idIndex: 2 },
  "132": { type: "HOME_FT_GOAL_RANGE", shape: "RANGE", idIndex: 2 },
  "133": { type: "AWAY_FT_GOAL_RANGE", shape: "RANGE", idIndex: 2 },
  "134": { type: "HOME_CORNER_FT_RANGE", shape: "RANGE", idIndex: 2 },
  "135": { type: "AWAY_CORNER_FT_RANGE", shape: "RANGE", idIndex: 2 },
  "136": { type: "CORNER_FH_RANGE", shape: "RANGE", idIndex: 2 },
  "140": { type: "CORNER_FH_THREE_WAY_TOTAL", shape: "THREE_WAY_TOTAL", idIndex: 4 }
};

function labelSelection(label: string, shape: Shape): string | null {
  if (shape === "SCORE") {
    // SBO's v/U constants 9-9 / 9:9 mean OTHER, not the literal score 9-9.
    if (label === "9:9") return null;
    const score = /^(0|[1-9]\d?):(0|[1-9]\d?)$/u.exec(label);
    return score ? `SCORE_${score[1]}_${score[2]}` : null;
  }
  if (shape === "RANGE") {
    const range = /^(0|[1-9]\d?)(?:[:-](0|[1-9]\d?)|(\+))$/u.exec(label);
    return range ? `RANGE_${range[1]}_${range[3] ? "PLUS" : range[2]}` : null;
  }
  if (shape === "HALF_FULL") {
    const result: Readonly<Record<string, string>> = { "1": "HOME", "2": "AWAY", "3": "DRAW" };
    return /^[123]{2}$/u.test(label) ? `${result[label[0]!]}_${result[label[1]!]}` : null;
  }
  if (shape === "RESULT_BTTS" || shape === "DC_BTTS") {
    if (!/^[123][45]$/u.test(label)) return null;
    // These tables deliberately differ from HALF_FULL: 2 = DRAW here.
    const outcomes = shape === "RESULT_BTTS" ? ["HOME", "DRAW", "AWAY"] : ["HOME_DRAW", "HOME_AWAY", "DRAW_AWAY"];
    return `${outcomes[Number(label[0]) - 1]}_${label[1] === "4" ? "YES" : "NO"}`;
  }
  if (shape === "RESULT_TOTAL") {
    const code = /^([1-6]):(?:0|[1-9]\d*)(?:\.[05])?$/u.exec(label);
    return code ? ["HOME_OVER", "HOME_UNDER", "DRAW_OVER", "DRAW_UNDER", "AWAY_OVER", "AWAY_UNDER"][Number(code[1]) - 1]! : null;
  }
  return null;
}

export function sbobetCategoricalUnknownReason(group: string, label: string): string | null {
  const layout = sbobetCategoricalLayouts[group];
  if (!layout || ["HIGHEST_HALF", "RESULT", "DRAW_NO_BET", "THREE_WAY_TOTAL"].includes(layout.shape)) return null;
  if (layout.shape === "SCORE" && label === "9:9") return "OTHER_SCORE_DOMAIN_REQUIRED";
  return labelSelection(label, layout.shape) === null ? "NATIVE_OUTCOME_UNMAPPED" : null;
}

export function parseSbobetCategoricalMarket(value: unknown, group: string): SbobetCatalogMarket | null {
  const descriptor = sbobetCategoricalLayouts[group];
  if (!descriptor || typeof value !== "string") return null;
  const tokens = value.trim().split(/\s+/u);
  const { type, shape, idIndex } = descriptor;
  const marketId = tokens[idIndex];
  const suspended = tokens[idIndex + 1];
  if (!marketId || !/^\d{4,30}$/u.test(marketId) || (suspended !== undefined && suspended !== "0" && suspended !== "1")) return null;
  let lineText: string | null = null;
  let outcomes: readonly string[];
  let firstIndex = 0;
  if (shape === "HIGHEST_HALF") outcomes = ["FIRST_HALF", "SECOND_HALF", "EQUAL"];
  else if (shape === "RESULT") outcomes = ["HOME", "AWAY", "DRAW"];
  else if (shape === "DRAW_NO_BET") outcomes = ["HOME", "AWAY"];
  else if (shape === "THREE_WAY_TOTAL") {
    if (!/^(?:0|[1-9]\d*)(?:\.0+)?$/u.test(tokens[0]!)) return null;
    lineText = String(Number(tokens[0])); firstIndex = 1; outcomes = ["OVER", "UNDER", "EXACT"];
  } else {
    const selection = labelSelection(tokens[0]!, shape);
    if (selection === null) return null;
    outcomes = [selection]; firstIndex = 1;
    if (shape === "RESULT_TOTAL") lineText = tokens[0]!.split(":")[1]!;
  }
  const selections = outcomes.flatMap((selection, index): SbobetCatalogSelection[] => {
    if (!isFootballCategoricalSelection(type, selection)) return [];
    const token = tokens[firstIndex + index];
    const match = /^((?:0|[1-9]\d*)(?:\.\d+)?)\*(\d+[had])$/u.exec(token ?? "");
    if (!match || !Number.isFinite(Number(match[1])) || Number(match[1]) <= 1 ||
      !match[2]!.endsWith(["h", "a", "d"][index]!)) return [];
    // Public z/te forces DECIMAL for all these native groups, irrespective of
    // the account's chosen odds style. Never infer Malay from price magnitude.
    return [{ selectionId: match[2]!, selection, priceText: match[1]!, priceFormat: "DECIMAL", locked: suspended !== "0" }];
  });
  return selections.length ? { marketId, marketType: type, lineText, selections } : null;
}
