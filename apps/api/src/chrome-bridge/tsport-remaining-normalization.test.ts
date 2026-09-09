import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import { NativeMarketObservationSchema, ProviderMarketSchema, ProviderQuoteSchema } from "@tool-chenh/contracts";
import { extractTsportFootballRecord, observeTsportNativeMarkets } from "./tsport-ws-adapter.js";

const odd = (line = "0.0") => ({ "6": "offer", "7": line, "0": "a", "2": "b", "3": "c",
  "8": { "0": "2.8" }, "9": { "0": "3.7" }, "10": { "0": "4.2" } });
const event = (group: number, offers: object[]) => ({ "2": "fixture", "5": "Home", "22": "Away", "53": "League",
  "6": true, "10": "Active", "11": "2026-09-11T18:00:00Z", "50": [{ "3": group, "10": "Active", "9": offers }] });
const normalize = (raw: Record<string, unknown>) => {
  const result = normalizeSbobetCatalog([extractTsportFootballRecord(raw)!],
    { provider: "APSPORT", observedAtMs: 100, receivedMonotonicMs: 17, sequence: 9 });
  result.markets.forEach(m => ProviderMarketSchema.parse(m));
  result.quotes.forEach(q => ProviderQuoteSchema.parse(q));
  return result;
};

describe("remaining AP native contracts", () => {
  it.each([[150, "FT_HOME_NO_BET", ["DRAW", "AWAY"]], [151, "FT_AWAY_NO_BET", ["HOME", "DRAW"]]] as const)(
    "preserves the refund side of native group %s", (group, marketType, selections) => {
      const raw = event(group, [{ ...odd(), "3": undefined, "10": undefined }]);
      const result = normalize(raw);
      expect(result.markets).toEqual([expect.objectContaining({ marketType, line: null })]);
      expect(result.quotes.map(q => q.selection)).toEqual(selections);
      expect(result.quotes.map(q => q.rawOdds)).toEqual(["2.8", "3.7"]);
      expect(observeTsportNativeMarkets(raw, 100)[0]?.disposition).toBe("NORMALIZED");
    });

  it("preserves the goal ordinal and no-further-goal outcome", () => {
    const result = normalize(event(146, [odd("5.0")]));
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "FT_GOAL_NUMBER_TEAM", line: "5" })]);
    expect(result.quotes.map(q => q.selection)).toEqual(["HOME", "AWAY", "NO_GOAL"]);
    expect(result.quotes.every(q => q.receivedMonotonicMs === 17 && q.sequence === 9)).toBe(true);
  });
  it.each(["0", "-1", "1.5", "3:1"])("retains invalid goal ordinal %s as unmapped", line => {
    const raw = event(146, [odd(line)]);
    expect(normalize(raw).markets).toEqual([]);
    expect(observeTsportNativeMarkets(raw, 100)[0]?.disposition).toBe("UNMAPPED");
  });
  it("keeps remainder-result score anchors distinct, including trailing zero", () => {
    const raw = event(147, [odd("3.1"), { ...odd("3.0"), "6": "second", "0": "d", "2": "e", "3": "f" }]);
    const result = normalize(raw);
    expect(result.markets.map(m => [m.marketType, m.line])).toEqual([["FT_REMAINING_RESULT", null], ["FT_REMAINING_RESULT", null]]);
    expect(result.quotes.map(q => q.selection)).toEqual(["FROM_SCORE_3_1_HOME", "FROM_SCORE_3_1_AWAY", "FROM_SCORE_3_1_DRAW",
      "FROM_SCORE_3_0_HOME", "FROM_SCORE_3_0_AWAY", "FROM_SCORE_3_0_DRAW"]);
  });
  it.each(["3", "-1.0", "0:0"])("rejects malformed remainder score %s", line => {
    expect(normalize(event(147, [odd(line)])).markets).toEqual([]);
  });
  it("does not interpret a remainder score as a decimal quarter line", () => {
    expect(normalize(event(147, [odd("3.25")])).quotes[0]?.selection).toBe("FROM_SCORE_3_25_HOME");
  });
  it.each([
    [23, "ET_1X2", "EXTRA_TIME", "0.0", null, ["HOME", "AWAY", "DRAW"]],
    [24, "ET_FH_1X2", "EXTRA_TIME_FIRST_HALF", "0.0", null, ["HOME", "AWAY", "DRAW"]],
    [25, "ET_TOTAL", "EXTRA_TIME", "1.5", "1.5", ["OVER", "UNDER"]],
    [26, "ET_FH_TOTAL", "EXTRA_TIME_FIRST_HALF", "0.5", "0.5", ["OVER", "UNDER"]],
    [27, "ET_AH", "EXTRA_TIME", "-0.25", "-0.25", ["HOME", "AWAY"]],
    [28, "ET_FH_AH", "EXTRA_TIME_FIRST_HALF", "0.25", "0.25", ["HOME", "AWAY"]]
  ] as const)("preserves the extra-time period of AP group %s", (group, marketType, scope, line, canonicalLine, selections) => {
    const raw = event(group, [{ ...odd(line), ...(selections.length === 2 ? { "3": undefined, "10": undefined } : {}) }]);
    const result = normalize(raw);
    expect(result.markets).toEqual([expect.objectContaining({ marketType, scope, line: canonicalLine })]);
    expect(result.quotes.map(q => q.selection)).toEqual(selections);
    expect(observeTsportNativeMarkets(raw, 100)[0]).toMatchObject({ nativeScope: scope, disposition: "NORMALIZED" });
  });
  it("retains a priced binary native leg when its opposing price is temporarily absent", () => {
    const raw = event(25, [{ ...odd("1.5"), "3": undefined, "9": undefined }]);
    const result = normalize(raw);
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "ET_TOTAL", line: "1.5" })]);
    expect(result.quotes).toEqual([expect.objectContaining({ providerSelectionId: "a", selection: "OVER", rawOdds: "2.8" })]);
    expect(observeTsportNativeMarkets(raw, 100)[0]?.nativeSelections).toHaveLength(2);
    expect(observeTsportNativeMarkets(raw, 100)[0]).toMatchObject({ disposition: "UNMAPPED", reason: "UNPRICED_NATIVE_SELECTIONS" });
  });
  it("rejects duplicate binary selection identities", () => {
    expect(normalize(event(25, [{ ...odd("1.5"), "2": "a", "3": undefined }])).markets).toEqual([]);
  });

  it("normalizes an exact named player while retaining unknown team orientation", () => {
    const raw = event(153, [{ ...odd("3.0"), "2": undefined, "3": undefined, "15": "player-42", "16": "Alex Example" }]);
    const result = normalize(raw);
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "PLAYER_FT_GOAL_NUMBER_SCORER", line: "3",
      player: { providerPlayerId: "player-42", name: "Alex Example", teamSide: null } })]);
    expect(result.quotes).toEqual([expect.objectContaining({ selection: "YES", providerSelectionId: "a", rawOdds: "2.8" })]);
  });
  it("does not derive a player name from the selection ID", () => {
    const raw = event(153, [{ ...odd("3.0"), "2": undefined, "3": undefined }]);
    expect(normalize(raw).markets).toEqual([]);
    expect(observeTsportNativeMarkets(raw, 100)[0]).toMatchObject({ disposition: "UNMAPPED", reason: "PLAYER_IDENTITY_REQUIRED" });
  });

  it("retains omitted player/time context from the same native row only", () => {
    const raw = event(153, [{ ...odd("3.0"), "2": undefined, "3": undefined, "15": "p1", "16": "Alex Example", "17": 7,
      token: "must-not-store", headers: { Authorization: "must-not-store" } }]);
    const observation = observeTsportNativeMarkets(raw, 100)[0]!;
    NativeMarketObservationSchema.parse(observation);
    expect(JSON.parse(observation.nativeRow!)).toMatchObject({ schemaVersion: 1, playerId: "p1", playerName: "Alex Example", timeRange: "7" });
    expect(observation.nativeRow).not.toContain("must-not-store");
  });
  it("retains the observed AOS score list without certifying its settlement complement", () => {
    const raw = event(11, [{ ...odd("0:0"), "2": undefined, "3": undefined },
      { ...odd("1:0"), "6": "score10", "0": "score10", "2": undefined, "3": undefined, "13": true },
      { ...odd("9:9"), "6": "other", "0": "other", "2": undefined, "3": undefined }]);
    const observation = observeTsportNativeMarkets(raw, 100).find(o => o.providerMarketId.endsWith(":other"))!;
    expect(observation).toMatchObject({ disposition: "UNMAPPED", reason: "OTHER_SCORE_DOMAIN_REQUIRED", observedAtMs: 100 });
    expect(JSON.parse(observation.nativeRow!)).toMatchObject({ observedScoreDomain: ["0:0", "1:0"], scoreDomainComplete: false });
    expect(normalize(raw).quotes.some(q => q.providerSelectionId === "other")).toBe(false);
    NativeMarketObservationSchema.parse(observation);
  });
  it("bounds native context after JSON escaping and reports omitted metadata", () => {
    const scores = Array.from({ length: 256 }, (_, index) => ({ "7": `${Math.floor(index / 16)}:${index % 16}` }));
    const raw = event(10, [...scores, { ...odd("9:9"), "2": undefined, "3": undefined,
      "15": "\u0001".repeat(128), "16": "\u0001".repeat(256), "17": "\u0001".repeat(32) }]);
    const observation = observeTsportNativeMarkets(raw, 100).find(o => o.providerMarketId === "tsport:10:offer")!;
    expect(observation.nativeRow!.length).toBeLessThanOrEqual(4096);
    expect(JSON.parse(observation.nativeRow!).omittedFields).toContain("playerName");
    NativeMarketObservationSchema.parse(observation);
  });
  it.each([[161, "FAST_CORNER_TOTAL_10M"], [166, "AWAY_FAST_CORNER_TOTAL_5M"], [169, "HOME_FAST_CORNER_TOTAL_10M"],
    [170, "AWAY_FAST_CORNER_TOTAL_10M"]])("retains exact native scope requirements for fast group %s", (group, label) => {
    const raw = event(Number(group), [{ ...odd("0.5"), "3": undefined }]);
    expect(observeTsportNativeMarkets(raw, 100)[0]).toMatchObject({ nativeLabel: label, reason: "TIME_RANGE_REQUIRED", disposition: "UNMAPPED" });
    expect(normalize(raw).markets).toEqual([]);
  });
});
