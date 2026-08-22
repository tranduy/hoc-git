import { describe, expect, it } from "vitest";

import {
  Decimal,
  optimizeStakes,
  StakeOptimizationValidationError,
  StakeSearchSpaceError,
  type OptimizeStakesInput
} from "../index.js";

const baseInput: OptimizeStakesInput = {
  odds: ["2.10", "2.05"],
  constraints: [
    { minStake: "10", maxStake: "600", stakeStep: "1", balance: "600" },
    { minStake: "10", maxStake: "600", stakeStep: "5", balance: "600" }
  ],
  bankroll: "1000"
};

describe("optimizeStakes", () => {
  it("evaluates mixed-currency stakes and payouts in declared base currency", () => {
    const plan = optimizeStakes({
      odds: ["2.2", "2.2"],
      stakeToBaseRates: ["2", "1"],
      constraints: [
        { minStake: "50", maxStake: "50", stakeStep: "1", balance: "50" },
        { minStake: "100", maxStake: "100", stakeStep: "1", balance: "100" }
      ],
      bankroll: "200"
    });

    expect(plan).toMatchObject({
      stakes: ["50", "100"],
      payouts: ["220", "220"],
      totalStake: "200",
      worstCaseProfit: "20",
      roi: "0.1"
    });
  });

  it("returns a profitable rounded plan that honors every constraint", () => {
    const plan = optimizeStakes(baseInput);

    expect(plan).not.toBeNull();
    if (plan === null) return;

    expect(plan.executable).toBe(true);
    expect(plan.stakes).toEqual(["493", "505"]);
    expect(plan.worstCaseProfit).toBe("37.25");
    expect(plan.stakes).toHaveLength(2);
    for (const [index, stakeText] of plan.stakes.entries()) {
      const stake = new Decimal(stakeText);
      const constraint = baseInput.constraints[index]!;
      expect(stake.gte(constraint.minStake)).toBe(true);
      expect(stake.lte(constraint.maxStake)).toBe(true);
      expect(stake.lte(constraint.balance)).toBe(true);
      expect(stake.mod(constraint.stakeStep).eq(0)).toBe(true);
    }

    const totalStake = plan.stakes.reduce(
      (sum, stake) => sum.plus(stake),
      new Decimal(0)
    );
    const payouts = plan.stakes.map((stake, index) =>
      new Decimal(stake).times(baseInput.odds[index]!)
    );
    const worstCasePayout = Decimal.min(...payouts);

    expect(totalStake.lte(baseInput.bankroll)).toBe(true);
    expect(new Decimal(plan.totalStake).eq(totalStake)).toBe(true);
    expect(plan.payouts).toEqual(payouts.map((payout) => payout.toString()));
    expect(new Decimal(plan.worstCasePayout).eq(worstCasePayout)).toBe(true);
    expect(new Decimal(plan.worstCaseProfit).eq(worstCasePayout.minus(totalStake))).toBe(true);
    expect(new Decimal(plan.worstCaseProfit).gt(0)).toBe(true);
    expect(new Decimal(plan.roi).eq(new Decimal(plan.worstCaseProfit).div(totalStake))).toBe(true);
  });

  it("returns null when a low maximum makes every feasible plan unprofitable", () => {
    expect(
      optimizeStakes({
        ...baseInput,
        constraints: [
          { minStake: "10", maxStake: "10", stakeStep: "1", balance: "10" },
          { minStake: "600", maxStake: "600", stakeStep: "5", balance: "600" }
        ]
      })
    ).toBeNull();
  });

  it("returns null when the effective odds are not an arbitrage", () => {
    expect(optimizeStakes({ ...baseInput, odds: ["2.26", "1.714"] })).toBeNull();
  });

  it("searches around a binding provider boundary", () => {
    const plan = optimizeStakes({
      ...baseInput,
      constraints: [
        { minStake: "10", maxStake: "100", stakeStep: "1", balance: "100" },
        baseInput.constraints[1]!
      ]
    });

    expect(plan?.stakes).toEqual(["98", "100"]);
    expect(plan?.totalStake).toBe("198");
    expect(plan?.worstCaseProfit).toBe("7");
  });

  it("centers the search around forced minimum stakes", () => {
    const plan = optimizeStakes({
      odds: ["4", "4", "4"],
      constraints: [
        { minStake: "40", maxStake: "100", stakeStep: "1", balance: "100" },
        { minStake: "1", maxStake: "100", stakeStep: "1", balance: "100" },
        { minStake: "1", maxStake: "100", stakeStep: "1", balance: "100" }
      ],
      bankroll: "100"
    });

    expect(plan?.stakes).toEqual(["40", "30", "30"]);
    expect(plan?.worstCasePayout).toBe("120");
    expect(plan?.worstCaseProfit).toBe("20");
  });

  it("fails closed when configured thresholds are not met", () => {
    expect(optimizeStakes({ ...baseInput, minimumWorstCaseProfit: "38" })).toBeNull();
    expect(optimizeStakes({ ...baseInput, minimumRoi: "0.038" })).toBeNull();
  });

  it("returns null for valid constraints with no discrete feasible stake", () => {
    expect(
      optimizeStakes({
        odds: ["2.1", "2.1"],
        constraints: [
          { minStake: "1", maxStake: "4", stakeStep: "5", balance: "4" },
          { minStake: "1", maxStake: "4", stakeStep: "5", balance: "4" }
        ],
        bankroll: "10"
      })
    ).toBeNull();
  });

  it.each([
    [{ ...baseInput, odds: ["2.1"] }, "same length"],
    [{ ...baseInput, odds: ["2.1", "1"] }, "greater than 1"],
    [{ ...baseInput, bankroll: "0" }, "bankroll"],
    [{ ...baseInput, minimumWorstCaseProfit: "-1" }, "minimumWorstCaseProfit"],
    [{ ...baseInput, minimumRoi: "-0.01" }, "minimumRoi"],
    [{ ...baseInput, searchRadiusSteps: -1 }, "searchRadiusSteps"],
    [
      {
        ...baseInput,
        constraints: [
          { ...baseInput.constraints[0]!, stakeStep: "0" },
          baseInput.constraints[1]!
        ]
      },
      "stakeStep"
    ],
    [
      {
        ...baseInput,
        constraints: [
          { ...baseInput.constraints[0]!, minStake: "700" },
          baseInput.constraints[1]!
        ]
      },
      "maxStake"
    ]
  ])("throws typed validation errors for invalid configuration %#", (input, message) => {
    expect(() => optimizeStakes(input as OptimizeStakesInput)).toThrow(
      StakeOptimizationValidationError
    );
    expect(() => optimizeStakes(input as OptimizeStakesInput)).toThrow(message);
  });

  it.each([
    [{ ...baseInput, odds: [2.1, "2.05"] }, "odds"],
    [{ ...baseInput, odds: [Number.MAX_SAFE_INTEGER + 1, "2.05"] }, "odds"],
    [{ ...baseInput, bankroll: 1000 }, "bankroll"],
    [{ ...baseInput, bankroll: Number.MAX_SAFE_INTEGER + 1 }, "bankroll"],
    [
      {
        ...baseInput,
        constraints: [
          { ...baseInput.constraints[0]!, minStake: 10 },
          baseInput.constraints[1]!
        ]
      },
      "minStake"
    ],
    [
      {
        ...baseInput,
        constraints: [
          { ...baseInput.constraints[0]!, balance: Number.MAX_SAFE_INTEGER + 1 },
          baseInput.constraints[1]!
        ]
      },
      "balance"
    ],
    [
      {
        ...baseInput,
        constraints: [
          { ...baseInput.constraints[0]!, maxStake: Number.MAX_SAFE_INTEGER + 1 },
          baseInput.constraints[1]!
        ]
      },
      "maxStake"
    ],
    [{ ...baseInput, minimumWorstCaseProfit: 0 }, "minimumWorstCaseProfit"],
    [
      { ...baseInput, minimumWorstCaseProfit: Number.MAX_SAFE_INTEGER + 1 },
      "minimumWorstCaseProfit"
    ],
    [{ ...baseInput, minimumRoi: 0 }, "minimumRoi"],
    [{ ...baseInput, minimumRoi: Number.MAX_SAFE_INTEGER + 1 }, "minimumRoi"]
  ])("rejects numeric values at exact-string runtime boundaries %#", (input, message) => {
    const runtimeCall = optimizeStakes as unknown as (input: unknown) => unknown;

    expect(() => runtimeCall(input)).toThrow(StakeOptimizationValidationError);
    expect(() => runtimeCall(input)).toThrow(message);
  });

  it("caps the Cartesian search space", () => {
    expect(() =>
      optimizeStakes({
        odds: ["5", "5", "5", "5"],
        constraints: Array.from({ length: 4 }, () => ({
          minStake: "1",
          maxStake: "100000",
          stakeStep: "1",
          balance: "100000"
        })),
        bankroll: "100000",
        searchRadiusSteps: 100
      })
    ).toThrow(StakeSearchSpaceError);
  });

  it.each([6_250, 100_000])(
    "rejects radius %i before iterating a narrow candidate range",
    (searchRadiusSteps) => {
      expect(() =>
        optimizeStakes({
          odds: ["2.1", "2.1"],
          constraints: [
            { minStake: "10", maxStake: "10", stakeStep: "1", balance: "10" },
            { minStake: "10", maxStake: "10", stakeStep: "1", balance: "10" }
          ],
          bankroll: "20",
          searchRadiusSteps
        })
      ).toThrow(StakeSearchSpaceError);
    }
  );
});
