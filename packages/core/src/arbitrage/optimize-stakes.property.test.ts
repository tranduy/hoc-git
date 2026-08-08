import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Decimal, optimizeStakes, type OptimizeStakesInput } from "../index.js";

const plainDecimalPattern = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const oddsArbitrary = fc
  .integer({ min: 101, max: 2_000 })
  .map((hundredths) => new Decimal(hundredths).div(100).toFixed(2));
const stepArbitrary = fc.constantFrom("1", "2", "5", "10", "25", "50");

const inputArbitrary = fc
  .record({
    outcomeCount: fc.integer({ min: 2, max: 3 }),
    odds: fc.array(oddsArbitrary, { minLength: 3, maxLength: 3 }),
    steps: fc.array(stepArbitrary, { minLength: 3, maxLength: 3 }),
    bankroll: fc.integer({ min: 10, max: 100_000 })
  })
  .map(({ outcomeCount, odds, steps, bankroll }): OptimizeStakesInput => ({
    odds: odds.slice(0, outcomeCount),
    constraints: steps.slice(0, outcomeCount).map((stakeStep) => ({
      minStake: "1",
      maxStake: bankroll.toString(),
      stakeStep,
      balance: bankroll.toString()
    })),
    bankroll: bankroll.toString()
  }));

describe("optimizeStakes properties", () => {
  it("keeps every returned plan inside all discrete financial constraints", () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        const plan = optimizeStakes(input);
        if (plan === null) return;

        expect(plan.executable).toBe(true);
        expect(plan.stakes).toHaveLength(input.odds.length);
        expect(plan.payouts).toHaveLength(input.odds.length);
        for (const value of [
          ...plan.stakes,
          ...plan.payouts,
          plan.totalStake,
          plan.worstCasePayout,
          plan.worstCaseProfit,
          plan.roi
        ]) {
          expect(value).toMatch(plainDecimalPattern);
        }

        const stakes = plan.stakes.map((stake) => new Decimal(stake));
        const totalStake = stakes.reduce((sum, stake) => sum.plus(stake), new Decimal(0));
        expect(totalStake.lte(input.bankroll)).toBe(true);
        expect(new Decimal(plan.totalStake).eq(totalStake)).toBe(true);

        stakes.forEach((stake, index) => {
          const constraint = input.constraints[index]!;
          expect(stake.gte(constraint.minStake)).toBe(true);
          expect(stake.lte(constraint.maxStake)).toBe(true);
          expect(stake.lte(constraint.balance)).toBe(true);
          expect(stake.mod(constraint.stakeStep).eq(0)).toBe(true);
        });

        const payouts = stakes.map((stake, index) => stake.times(input.odds[index]!));
        expect(plan.payouts).toEqual(payouts.map((payout) => payout.toString()));
        const worstCasePayout = Decimal.min(...payouts);
        const worstCaseProfit = worstCasePayout.minus(totalStake);
        expect(new Decimal(plan.worstCasePayout).eq(worstCasePayout)).toBe(true);
        expect(new Decimal(plan.worstCaseProfit).eq(worstCaseProfit)).toBe(true);
        expect(new Decimal(plan.roi).eq(worstCaseProfit.div(totalStake))).toBe(true);

        for (const payout of payouts) {
          expect(new Decimal(plan.worstCaseProfit).lte(payout.minus(totalStake))).toBe(true);
        }
        expect(new Decimal(plan.worstCaseProfit).gt(0)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });
});
