import { describe, expect, it } from "vitest";
import { decodeBtiPlayerTerms } from "./bti-player-terms.js";

const marketId = "0QA881975737568211011";
const teams = ["Norwich", "Birmingham"] as const;
const item = (suffix: string, name = "Kanya Fujimoto", side = 3) => ({ id: marketId + suffix,
  name, side, line: 0, lineWasMissing: true });

describe("BTI native player proposition terms", () => {
  it.each([
    ["QA1337", "Q1Q344085", "PLAYER_FT_FIRST_SCORER"],
    ["QA1337", "Q2Q344085", "PLAYER_FT_LAST_SCORER"],
    ["QA1337", "Q3Q344085", "PLAYER_FT_ANYTIME_SCORER"],
    ["QA5018", "Q3Q344085", "PLAYER_FH_ANYTIME_SCORER"],
    ["QA4879", "Q-1Q344085", "PLAYER_FT_TWO_PLUS_GOALS"],
    ["QA4880", "Q-1Q344085", "PLAYER_FT_THREE_PLUS_GOALS"],
    ["QA5019", "Q0Q344085", "PLAYER_FT_SCORE_OR_ASSIST"],
    ["QA1572", "Q0Q344085", "PLAYER_FT_BOOKED"],
    ["QA1610", "Q0Q344085", "PLAYER_FT_SENT_OFF"],
    ["QA2144", "Q0Q344085", "PLAYER_FT_FIRST_BOOKED"],
    ["QA5017", "Q0Q344085", "PLAYER_FT_SCORE_BOTH_HALVES"],
    ["QA5212", "Q0Q344085", "PLAYER_FT_HEADED_GOAL"],
    ["QA5213", "Q1Q344085", "PLAYER_FT_OUTSIDE_BOX_GOAL"],
    ["QA5215", "Q1Q344085", "PLAYER_FT_FREE_KICK_GOAL"],
    ["QA5508", "Q0Q344085", "PLAYER_FT_HIT_WOODWORK"]
  ])("keeps the native player and distinct predicate for %s/%s", (code, suffix, marketType) => {
    const decoded = decodeBtiPlayerTerms(code, marketId, item(suffix, "Kanya Fujimoto", code === "QA4879" || code === "QA4880" ? 0 : 3), "", teams);
    expect(decoded).toMatchObject({ marketType, selection: "YES", lineText: null,
      player: { providerPlayerId: "344085", name: "Kanya Fujimoto", teamSide: code === "QA4879" || code === "QA4880" ? null : "AWAY" } });
  });

  it.each([
    ["QA5401", "PLAYER_FT_SHOTS_TOTAL"], ["QA5402", "PLAYER_FT_SHOTS_ON_TARGET_TOTAL"],
    ["QA5510", "PLAYER_FH_SHOTS_TOTAL"], ["QA5509", "PLAYER_FH_SHOTS_ON_TARGET_TOTAL"],
    ["QA5403", "PLAYER_FT_FOULS_TOTAL"], ["QA5404", "PLAYER_FT_ASSISTS_TOTAL"],
    ["QA5405", "PLAYER_FT_TACKLES_TOTAL"], ["QA5406", "PLAYER_FT_OFFSIDES_TOTAL"],
    ["QA5407", "PLAYER_FT_SAVES_TOTAL"]
  ])("corroborates the count threshold in %s using the native ID and label", (code, marketType) => {
    const decoded = decodeBtiPlayerTerms(code, marketId, item("Q150Q1658226316", "Brian Aguirre Tài 1.5", 0), "", teams);
    expect(decoded).toEqual({ marketType, selection: "OVER", lineText: "1.5",
      player: { providerPlayerId: "1658226316", name: "Brian Aguirre", teamSide: null } });
  });

  it("retains BTI's different IDs for the same display name without inventing a cross-book key", () => {
    const first = decodeBtiPlayerTerms("QA4879", marketId, item("Q-1Q295238", "Brian Aguirre", 0), "", teams)!;
    const second = decodeBtiPlayerTerms("QA5404", marketId, item("Q50Q1658226316", "Brian Aguirre Over 0.5", 0), "", teams)!;
    expect(first.player).toEqual({ providerPlayerId: "295238", name: "Brian Aguirre", teamSide: null });
    expect(second.player).toEqual({ providerPlayerId: "1658226316", name: "Brian Aguirre", teamSide: null });
  });

  it("preserves an explicit age or country qualifier in a native player's display name", () => {
    expect(decodeBtiPlayerTerms("QA4879", marketId, item("Q-1Q699833", "Josh King (U21 Anh)", 0), "", teams))
      .toMatchObject({ player: { providerPlayerId: "699833", name: "Josh King (U21 Anh)", teamSide: null } });
  });

  it.each([["QA5172", 1, "Norwich"], ["QA5173", 3, "Birmingham"]] as const)(
    "keeps team-first scorer %s distinct from first scorer of the whole match", (code, side, team) => {
      expect(decodeBtiPlayerTerms(code, marketId, item("Q1Q344085", "Kanya Fujimoto", side), `${team}: Cầu thủ ghi bàn đầu tiên của đội`, teams))
        .toMatchObject({ marketType: "PLAYER_FT_TEAM_FIRST_SCORER", selection: "YES", player: { teamSide: side === 1 ? "HOME" : "AWAY" } });
      expect(decodeBtiPlayerTerms(code, marketId, item("Q1Q344085", "Kanya Fujimoto", side), "Unknown: Cầu thủ ghi bàn đầu tiên của đội", teams)).toBeNull();
      expect(decodeBtiPlayerTerms(code, marketId, item("Q1Q707786", "Không có cầu thủ ghi bàn", side), `${team}: Cầu thủ ghi bàn đầu tiên của đội`, teams))
        .toEqual({ marketType: side === 1 ? "HOME_FT_FIRST_SCORER_RESULT" : "AWAY_FT_FIRST_SCORER_RESULT",
          selection: "NO_SCORER", lineText: null });
      expect(decodeBtiPlayerTerms(code, marketId, item("Q1Q707786", "Kanya Fujimoto", side), `${team}: First scorer`, teams)).toBeNull();
      expect(decodeBtiPlayerTerms(code, marketId, item("Q1Q707786", "Không có cầu thủ ghi bàn", 0), `${team}: First scorer`, teams)).toBeNull();
    });

  it.each([
    ["QA1337", "Q1Q681638", "No Score", 0],
    ["QA5172", "Q1Q707786", "Không có cầu thủ ghi bàn", 1],
    ["QA5018", "Q3Q707786", "No Goalscorer", 0],
    ["QA5018", "Q3Q707786", "Own Goal", 0],
    ["QA1337", "Q2Q672511", "Lucas Gonzalez/francisco Gonzalez", 0],
    ["QA1572", "Q0Q686754", "Norwich", 0],
    ["QA5213", "Q1Q627028", "To Score Last Goal Tiago Morais", 0],
    ["QA1337", "Q3Q0", "Kanya Fujimoto", 3],
    ["QA1337", "Q4Q344085", "Kanya Fujimoto", 3],
    ["QA1337", "Q3Q344085", "Kanya Fujimoto", 2],
    ["QA1337", "Q3Q344085", "", 3],
    ["QA5018", "Q1Q344085", "Kanya Fujimoto", 3],
    ["QA4880", "Q0Q344085", "Kanya Fujimoto", 3],
    ["QA5404", "Q150Q344085", "Kanya Fujimoto Over 2.5", 0],
    ["QA5404", "Q150Q344085", "Kanya Fujimoto Under 1.5", 0],
    ["QA5404", "Q100Q344085", "Kanya Fujimoto Over 1", 0]
  ])("does not reinterpret ambiguous native subject or contradictory terms %s/%s/%s", (code, suffix, name, side) => {
    expect(decodeBtiPlayerTerms(code as string, marketId, item(suffix as string, name as string, side as number), "", teams)).toBeNull();
  });

  it("rejects a selection outside the exact native market and contradictory native line", () => {
    expect(decodeBtiPlayerTerms("QA1337", marketId, { ...item("Q3Q344085"), id: "foreignQ3Q344085" }, "", teams)).toBeNull();
    expect(decodeBtiPlayerTerms("QA1337", marketId, { ...item("Q3Q344085"), line: 1, lineWasMissing: false }, "", teams)).toBeNull();
  });

  it("retains Or Blorian as one player without inventing his unknown team", () => {
    expect(decodeBtiPlayerTerms("QA1337", marketId, item("Q1Q844666", "Or Blorian", 0), "", teams))
      .toMatchObject({ marketType: "PLAYER_FT_FIRST_SCORER", player: { providerPlayerId: "844666", name: "Or Blorian", teamSide: null } });
    expect(decodeBtiPlayerTerms("QA1337", marketId, item("Q1Q844666", "Or Blorian or Josh King", 0), "", teams)).toBeNull();
  });

  it.each(["Unknown", "Player", "Home Player", "Over"])("never emits schema-invalid player identity %s", name => {
    expect(decodeBtiPlayerTerms("QA1337", marketId, item("Q1Q344085", name, 0), "", teams)).toBeNull();
  });

  it.each([["1", "FT_FIRST_SCORER_RESULT"], ["2", "FT_LAST_SCORER_RESULT"]] as const)(
    "retains the explicit native no-scorer outcome for role %s without inventing a player", (role, marketType) => {
      expect(decodeBtiPlayerTerms("QA1337", marketId, item(`Q${role}Q681639`, "No Score", 0), "", teams))
        .toEqual({ marketType, selection: "NO_SCORER", lineText: null });
      expect(decodeBtiPlayerTerms("QA1337", marketId, item(`Q${role}Q681639`, "No Score", 1), "", teams)).toBeNull();
      expect(decodeBtiPlayerTerms("QA1337", marketId, item(`Q${role}Q681639`, "Kanya Fujimoto", 0), "", teams)).toBeNull();
    });
});
