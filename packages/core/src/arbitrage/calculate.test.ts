import { describe, expect, it } from "vitest";

import { calculateArbitrage } from "../index.js";

describe("calculateArbitrage", () => {
  it("finds a two-outcome surebet", () => {
    const result = calculateArbitrage(["2.10", "2.05"]);

    expect(result.isArbitrage).toBe(true);
    expect(result.inverseSum.toFixed(12)).toBe("0.963995354239");
    expect(result.theoreticalMargin.toFixed(12)).toBe("0.037349397590");
    expect(result.equalizedFractions[0]?.toFixed(12)).toBe("0.493975903614");
    expect(result.equalizedFractions[1]?.toFixed(12)).toBe("0.506024096386");
  });

  it("rejects the LoL document example", () => {
    const result = calculateArbitrage(["2.26", "1.714"]);

    expect(result.isArbitrage).toBe(false);
    expect(result.inverseSum.gt(1)).toBe(true);
    expect(result.theoreticalMargin.lt(0)).toBe(true);
  });

  it("calculates an N-outcome market", () => {
    const result = calculateArbitrage(["3.50", "3.60", "3.70"]);

    expect(result.isArbitrage).toBe(true);
    expect(result.inverseSum.toFixed(12)).toBe("0.833762333762");
    expect(result.equalizedFractions).toHaveLength(3);
    expect(
      result.equalizedFractions.reduce((sum, fraction) => sum.plus(fraction)).toFixed(12)
    ).toBe("1.000000000000");
  });

  const invalidOdds: readonly (readonly string[])[] = [
    [],
    ["2"],
    ["1", "2"],
    ["0", "2"],
    ["-2", "2"],
    ["NaN", "2"],
    ["Infinity", "2"]
  ];

  invalidOdds.forEach((odds, index) => {
    it(`fails closed for invalid effective odds ${index}`, () => {
      expect(() => calculateArbitrage(odds)).toThrow();
    });
  });
});
