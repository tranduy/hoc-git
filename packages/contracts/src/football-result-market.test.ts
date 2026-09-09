import { describe, expect, it } from "vitest";
import { footballResultMarketSpec, resultComplement } from "./football-result-market.js";
import { footballBinaryMarketSpec } from "./football-binary-market.js";
import { NativeMarketObservationSchema, ProviderMarketSchema } from "./schemas.js";

describe("football result contracts", () => {
  it("preserves observed native suspension and leaves missing status unknown", () => {
    const raw = { provider: "BTI", category: "FOOTBALL", providerEventId: "e", providerMarketId: "m",
      nativeType: "QA61", nativeLabel: "Double chance", nativeScope: null, outcomeLabels: ["Home or Draw"],
      observedAtMs: 1, disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED",
      nativeSelections: [{ selectionId: "s", outcomeId: "1", line: null, price: "0.8", rawFormat: "MALAY" }] };
    expect(NativeMarketObservationSchema.parse(raw).nativeSelections?.[0]?.status).toBeUndefined();
    for (const status of ["OPEN", "SUSPENDED", "CLOSED"]) {
      const record = { ...raw, status, nativeSelections: [{ ...raw.nativeSelections[0], status }] };
      expect(NativeMarketObservationSchema.parse(record)).toEqual(record);
    }
    expect(NativeMarketObservationSchema.safeParse({ ...raw, status: "UNKNOWN" }).success).toBe(false);
  });

  it.each([
    ["FT_1X2", "FT_DOUBLE_CHANCE", "FULL_TIME"],
    ["FH_1X2", "FH_DOUBLE_CHANCE", "FIRST_HALF"],
    ["SH_1X2", "SH_DOUBLE_CHANCE", "SECOND_HALF"]
  ] as const)("keeps %s and %s on exactly the same settlement", (single, double, scope) => {
    const a = footballResultMarketSpec(single), b = footballResultMarketSpec(double);
    expect(a).toMatchObject({ family: "RESULT", scope, outcomes: ["HOME", "DRAW", "AWAY"] });
    expect(b).toMatchObject({ family: "DOUBLE_CHANCE", scope,
      outcomes: ["HOME_DRAW", "HOME_AWAY", "DRAW_AWAY"], settlementProfile: a?.settlementProfile });
    for (const marketType of [single, double]) {
      const market = { provider: "BTI", category: "FOOTBALL", providerEventId: "e", providerMarketId: "m",
        marketType, scope, line: null, settlementProfile: a?.settlementProfile, status: "OPEN" };
      expect(ProviderMarketSchema.safeParse(market).success).toBe(true);
      for (const wrong of ["FULL_TIME", "FIRST_HALF", "SECOND_HALF"].filter(x => x !== scope))
        expect(ProviderMarketSchema.safeParse({ ...market, scope: wrong }).success).toBe(false);
      expect(ProviderMarketSchema.safeParse({ ...market, category: "LOL", scope: "MAP_1" }).success).toBe(false);
      expect(footballBinaryMarketSpec(marketType)).toBeNull();
    }
  });

  it("defines exhaustive and disjoint result partitions, never arbitrary two-outcome pairs", () => {
    const winningStates: Record<string, string[]> = {
      HOME: ["HOME"], DRAW: ["DRAW"], AWAY: ["AWAY"],
      HOME_DRAW: ["HOME", "DRAW"], HOME_AWAY: ["HOME", "AWAY"], DRAW_AWAY: ["DRAW", "AWAY"]
    };
    for (const single of ["HOME", "DRAW", "AWAY"] as const) {
      const complement = resultComplement(single);
      expect(complement).not.toBeNull();
      for (const actual of ["HOME", "DRAW", "AWAY"])
        expect(Number(winningStates[single]!.includes(actual)) + Number(winningStates[complement!]!.includes(actual))).toBe(1);
      expect(resultComplement(complement!)).toBe(single);
    }
    expect(resultComplement("OVER")).toBeNull();
    expect(footballResultMarketSpec("FT_AH")).toBeNull();
  });

  it("distinguishes both teams scoring in both halves from either team scoring in both halves", () => {
    const both = footballBinaryMarketSpec("FT_BOTH_TEAMS_SCORE_BOTH_HALVES");
    expect(both).toMatchObject({ scope: "FULL_TIME", family: "YES_NO", outcomes: ["YES", "NO"], linePolicy: "NONE" });
    expect(both?.settlementProfile).not.toBe(footballBinaryMarketSpec("HOME_FT_SCORE_BOTH_HALVES")?.settlementProfile);
    expect(both?.settlementProfile).not.toBe(footballBinaryMarketSpec("FT_BOTH_HALVES_OVER_TOTAL")?.settlementProfile);
  });
});
