import { describe, expect, it } from "vitest";
import { exactBtiStakeStep } from "./bti-stake-step.js";

describe("BTI exact client stake step evidence", () => {
  it("accepts one explicit positive increment from the exact stake control", () => {
    expect(exactBtiStakeStep([
      { key: "decimalPlaces", value: "2" },
      { key: "amount-step", value: "0.01" },
      { key: "amountStep", value: "0.01" }
    ])).toBe("0.01");
  });

  it.each([
    [[]],
    [[{ key: "decimalPlaces", value: "2" }]],
    [[{ key: "step", value: "any" }]],
    [[{ key: "step", value: "0" }]],
    [[{ key: "step", value: "0.01" }, { key: "increment", value: "1" }]]
  ])("fails closed for absent, inferred, invalid, or conflicting evidence: %o", (evidence) => {
    expect(exactBtiStakeStep(evidence)).toBeNull();
  });
});
