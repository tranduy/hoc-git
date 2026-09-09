import { isValidProviderPlayerIdentity, type MarketType } from "@tool-chenh/contracts";
import type { BtiNamedSelection } from "./bti-categorical-terms.js";

export interface BtiPlayerIdentity {
  readonly providerPlayerId: string;
  readonly name: string;
  readonly teamSide: "HOME" | "AWAY" | null;
}
export interface BtiPlayerTerms {
  readonly marketType: MarketType;
  readonly selection: "YES" | "OVER" | "NO_SCORER";
  readonly lineText: string | null;
  readonly player?: BtiPlayerIdentity;
}

const namedPredicates: Readonly<Record<string, readonly [MarketType, string]>> = {
  QA5018: ["PLAYER_FH_ANYTIME_SCORER", "3"],
  QA4879: ["PLAYER_FT_TWO_PLUS_GOALS", "-1"],
  QA4880: ["PLAYER_FT_THREE_PLUS_GOALS", "-1"],
  QA5019: ["PLAYER_FT_SCORE_OR_ASSIST", "0"],
  QA1572: ["PLAYER_FT_BOOKED", "0"],
  QA1610: ["PLAYER_FT_SENT_OFF", "0"],
  QA2144: ["PLAYER_FT_FIRST_BOOKED", "0"],
  QA5017: ["PLAYER_FT_SCORE_BOTH_HALVES", "0"],
  QA5172: ["PLAYER_FT_TEAM_FIRST_SCORER", "1"],
  QA5173: ["PLAYER_FT_TEAM_FIRST_SCORER", "1"],
  QA5212: ["PLAYER_FT_HEADED_GOAL", "0"],
  QA5213: ["PLAYER_FT_OUTSIDE_BOX_GOAL", "1"],
  QA5215: ["PLAYER_FT_FREE_KICK_GOAL", "1"],
  QA5508: ["PLAYER_FT_HIT_WOODWORK", "0"]
};
const playerTotals: Readonly<Record<string, MarketType>> = {
  QA5401: "PLAYER_FT_SHOTS_TOTAL", QA5402: "PLAYER_FT_SHOTS_ON_TARGET_TOTAL",
  QA5510: "PLAYER_FH_SHOTS_TOTAL", QA5509: "PLAYER_FH_SHOTS_ON_TARGET_TOTAL",
  QA5403: "PLAYER_FT_FOULS_TOTAL", QA5404: "PLAYER_FT_ASSISTS_TOTAL",
  QA5405: "PLAYER_FT_TACKLES_TOTAL", QA5406: "PLAYER_FT_OFFSIDES_TOTAL", QA5407: "PLAYER_FT_SAVES_TOTAL"
};
export const btiPlayerCodes: ReadonlySet<string> = new Set(["QA1337", ...Object.keys(namedPredicates), ...Object.keys(playerTotals)]);

function nameKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/đ/giu, "d")
    .toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function playerName(value: string, teams?: readonly [string, string]): string | null {
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (name.length === 0 || name.length > 256 ||
    !/^[\p{L}\p{M}][\p{L}\p{M} .'’,\-]*(?:\s\([\p{L}\p{M}\d .'’\-]+\))?$/u.test(name)) return null;
  const key = nameKey(name);
  // The native table also contains non-player entries with positive numeric IDs.
  // A named source subject is retained only when it is a single player, not a
  // No Score option, a team placeholder, a composite, or an outcome sentence.
  if (/^(?:no score|no scorer|no goals?|no goalscorer|khong ghi ban|khong ban thang|khong co cau thu ghi ban|own goals?|phan luoi|none|other|any other)(?:\s|$)/u.test(key) ||
    /\b(?:to score|to win|substitute)\b/u.test(key) || /\sor(?:\s|$)/u.test(key)) return null;
  const withoutClubSuffix = (text: string): string => text.replace(/\s+(?:fc|cf|sc)$/u, "");
  if (teams?.some(team => withoutClubSuffix(nameKey(team)) === withoutClubSuffix(key))) return null;
  return name;
}

/** Native ID and source label prove the player proposition; they do not prove
 * identity across bookmakers or common non-participation settlement rules. */
export function decodeBtiPlayerTerms(code: string, marketId: string, item: BtiNamedSelection,
  label: string, teams?: readonly [string, string]): BtiPlayerTerms | null {
  if (!btiPlayerCodes.has(code) || marketId === "" || !item.id.startsWith(marketId) ||
    ![0, 1, 3].includes(item.side) || (!item.lineWasMissing && item.line !== 0)) return null;
  const suffix = /^Q(-?(?:0|[1-9]\d*))Q([1-9]\d{0,19})$/u.exec(item.id.slice(marketId.length));
  if (suffix === null) return null;
  let marketType: MarketType;
  let name = item.name;
  let lineText: string | null = null;
  let selection: "YES" | "OVER" = "YES";
  const totalType = playerTotals[code];
  if (totalType !== undefined) {
    const encoded = Number(suffix[1]);
    const outcome = /^(.*?)\s+(?:over|tài)\s+((?:0|[1-9]\d*)\.5)$/iu.exec(item.name.normalize("NFC").trim());
    if (!Number.isSafeInteger(encoded) || encoded < 50 || encoded > 9950 || encoded % 100 !== 50 ||
      outcome === null || Number(outcome[2]) * 100 !== encoded) return null;
    marketType = totalType; name = outcome[1]!; lineText = String(encoded / 100); selection = "OVER";
  } else if (code === "QA1337") {
    // Public useMarketGroupSubGroupsEnabled renderer maps QAParam1 to
    // GoalScorer First=1, Last=2, Anytime=3 and selects by that same field.
    if (!["1", "2", "3"].includes(suffix[1]!)) return null;
    if (suffix[2] === "681639") {
      if (item.name.trim() !== "No Score" || item.side !== 0 || suffix[1] === "3") return null;
      return { marketType: suffix[1] === "1" ? "FT_FIRST_SCORER_RESULT" : "FT_LAST_SCORER_RESULT",
        selection: "NO_SCORER", lineText: null };
    }
    marketType = suffix[1] === "1" ? "PLAYER_FT_FIRST_SCORER" : suffix[1] === "2"
      ? "PLAYER_FT_LAST_SCORER" : "PLAYER_FT_ANYTIME_SCORER";
  } else {
    const predicate = namedPredicates[code]!;
    // BTI also supplies the two-plus table as Q0 with explicit team sides.
    const twoPlusAlternate = code === "QA4879" && suffix[1] === "0" && item.side !== 0;
    if (suffix[1] !== predicate[1] && !twoPlusAlternate) return null;
    marketType = predicate[0];
    if ((code === "QA4879" || code === "QA4880") && suffix[1] === "-1" && item.side !== 0) return null;
    if (code === "QA5172" || code === "QA5173") {
      const teamIndex = code === "QA5172" ? 0 : 1;
      if (teams === undefined || item.side !== (teamIndex === 0 ? 1 : 3) || !label.includes(":") ||
        nameKey(label.split(":")[0]!) !== nameKey(teams[teamIndex])) return null;
      if (suffix[2] === "707786") {
        if (item.name.normalize("NFC").trim() !== "Không có cầu thủ ghi bàn") return null;
        return { marketType: teamIndex === 0 ? "HOME_FT_FIRST_SCORER_RESULT" : "AWAY_FT_FIRST_SCORER_RESULT",
          selection: "NO_SCORER", lineText: null };
      }
    }
  }
  const validatedName = playerName(name, teams);
  if (validatedName === null) return null;
  const player: BtiPlayerIdentity = { providerPlayerId: suffix[2]!, name: validatedName,
    teamSide: item.side === 1 ? "HOME" : item.side === 3 ? "AWAY" : null };
  return isValidProviderPlayerIdentity(player) ? { marketType, selection, lineText, player } : null;
}
