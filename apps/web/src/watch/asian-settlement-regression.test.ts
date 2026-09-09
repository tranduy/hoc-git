import { describe, expect, it } from "vitest";
import { footballBinaryMarketSpec, type MarketType, type ProviderId } from "@tool-chenh/contracts";
import { exactTwoWayOutcomeDomain, observedTicketAsComparisonRow, type ComparisonCell } from "../catalog/comparison.js";
import { buildFixedBaseStakePlan, buildObservedAnchoredStakeEstimate, buildObservedFixedBaseStakeEstimate,
  enumerateOpposingLegPairs, type FixedBaseStakePolicy } from "./fixed-base-stake.js";

const selected = new Set<ProviderId>(["BTI", "IM"]);
const policy: FixedBaseStakePolicy = { currency: "VND", baseStake: "100000", minStake: "1",
  maxStake: "1000000", stakeStep: "1", balance: "1000000" };

function ticket(type: MarketType, line: string, firstOdds = "2.2", secondOdds = "2.2") {
  const spec = footballBinaryMarketSpec(type)!;
  const outcomes = [...spec.outcomes].sort();
  const cells: ComparisonCell[] = (["BTI", "IM"] as const).map((provider, index) => {
    const market = { provider, category: "FOOTBALL" as const, providerEventId: `${provider}-event`,
      providerMarketId: `${provider}-market`, marketType: type, scope: spec.scope, line,
      settlementProfile: spec.settlementProfile, status: "OPEN" as const };
    return { provider, market, quotes: outcomes.map((selection, position) => ({ ...market,
      providerSelectionId: `${provider}-${selection}`, selection,
      rawOdds: index === position ? (position === 0 ? firstOdds : secondOdds) : "1.01",
      rawFormat: "DECIMAL" as const, isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1 })) };
  });
  return observedTicketAsComparisonRow({ key: `${type}|${line}`, marketType: type, scope: spec.scope,
    line, settlementProfile: spec.settlementProfile, outcomeDomain: outcomes, cells });
}

describe("opposing Asian settlement states", () => {
  it.each(["FT_TOTAL", "FH_TOTAL", "SH_TOTAL", "HOME_FT_TOTAL", "AWAY_FH_TOTAL",
    "HOME_CORNER_FH_TOTAL", "CARD_FH_TOTAL", "YELLOW_CARD_FT_TOTAL"] as const)(
    "settles %s quarter totals by OVER/UNDER, including the returned half stake", (type) => {
      for (const line of ["2.25", "2.75"]) {
        const row = ticket(type, line);
        expect(exactTwoWayOutcomeDomain(type, row.scope, line)).toEqual(["OVER", "UNDER"]);
        const pair = enumerateOpposingLegPairs(row, selected).find(p => p.first.provider === "BTI")!;
        const plan = buildObservedAnchoredStakeEstimate(row, pair, policy,
          { provider: "BTI", selection: "OVER", stake: "100000" });
        expect(plan).not.toBeNull();
        const hedge = Number(plan!.legs.find(leg => leg.selection === "UNDER")!.stake);
        const profits = [220000 - 100000 - hedge, 2.2 * hedge - 100000 - hedge,
          line === "2.25" ? 50000 + 1.6 * hedge - 100000 - hedge : 160000 + 0.5 * hedge - 100000 - hedge];
        expect(Number(plan!.worstCaseProfit)).toBeCloseTo(Math.min(...profits), 6);
        // 2.2*x = 1.6 - 1.1*x at x=16/33: return16/15, ROI1/15.
        expect(row.margin).toBeCloseTo(1 / 15, 10);
      }
    });

  it.each(["-0.75", "-0.25", "0.25", "0.75"])("settles home handicap %s with the right half winner", line => {
    const row = ticket("FT_AH", line);
    const pair = enumerateOpposingLegPairs(row, selected).find(p => p.first.provider === "BTI")!;
    const plan = buildObservedAnchoredStakeEstimate(row, pair, policy,
      { provider: "BTI", selection: "AWAY", stake: "100000" });
    expect(plan).not.toBeNull();
    const homeStake = Number(plan!.legs.find(leg => leg.selection === "HOME")!.stake);
    const homeHalfWin = line === "0.25" || line === "-0.75";
    const split = homeHalfWin ? 50000 + 1.6 * homeStake : 160000 + 0.5 * homeStake;
    expect(Number(plan!.worstCaseProfit)).toBeCloseTo(
      Math.min(220000, 2.2 * homeStake, split) - 100000 - homeStake, 6);
  });

  it.each(["FT_TOTAL", "HOME_FH_TOTAL", "FT_AH"] as const)("includes the full refund for integer %s", type => {
    const row = ticket(type, type === "FT_AH" ? "0" : "2", "3", "3");
    expect(enumerateOpposingLegPairs(row, selected)).toHaveLength(2);
    const plan = buildObservedFixedBaseStakeEstimate(row, selected, policy);
    expect(plan?.worstCaseProfit).toBe("0");
    expect(plan?.roi).toBe("0");
    expect(row.margin).toBe(0);
    expect(buildFixedBaseStakePlan(row, selected, policy)).toBeNull();
  });

  it("keeps compound YES/NO threshold props outside Asian refund semantics", () => {
    expect(exactTwoWayOutcomeDomain("FT_BOTH_HALVES_OVER_TOTAL", "FULL_TIME", "1.25")).toBeNull();
    expect(exactTwoWayOutcomeDomain("FT_BOTH_HALVES_OVER_TOTAL", "FULL_TIME", "1.5")).toEqual(["NO", "YES"]);
  });

  it("converts American odds in the actual stake calculation", () => {
    const original = ticket("FT_TOTAL", "2.5", "3", "3");
    const row = { ...original, cells: original.cells.map(cell => ({ ...cell,
      quotes: cell.quotes.map(q => ({ ...q, rawOdds: q.rawOdds === "3" ? "200" : "-10000", rawFormat: "AMERICAN" as const })) })) };
    expect(buildFixedBaseStakePlan(row, selected, policy)?.worstCaseProfit).toBe("100000");
  });
});
