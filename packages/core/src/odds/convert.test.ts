import { describe, expect, it } from "vitest";
import type { OddsFormat } from "@tool-chenh/contracts";
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

  it("rejects unrecognized runtime formats instead of treating them as American", () => {
    expect(() => toDecimal("100", "MALAY" as OddsFormat)).toThrow("unsupported odds format");
  });

  it.each([
    ["", "DECIMAL", "[DecimalError] Invalid argument"],
    ["not-an-odd", "HK", "[DecimalError] Invalid argument"],
    ["NaN", "AMERICAN", "odds must be finite"],
    ["Infinity", "DECIMAL", "odds must be finite"]
  ] as const)("rejects malformed or non-finite %s %s odds", (raw, format, expected) => {
    expect(() => toDecimal(raw, format)).toThrow(expected);
  });
});
