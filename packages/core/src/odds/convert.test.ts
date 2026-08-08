import { describe, expect, it } from "vitest";
import { toDecimal } from "./convert.js";

describe("toDecimal", () => {
  it.each([
    ["1.26", "HK", "2.26"],
    ["2.054", "DECIMAL", "2.054"],
    ["+126", "AMERICAN", "2.26"],
    ["-150", "AMERICAN", "1.6666666666666666667"]
  ] as const)("converts %s %s", (raw, format, expected) => {
    expect(toDecimal(raw, format).toSignificantDigits(20).toString()).toBe(expected);
  });

  it("rejects zero-or-lower decimal odds", () => {
    expect(() => toDecimal("0", "DECIMAL")).toThrow(
      "decimal odds must be greater than 1"
    );
  });
});
