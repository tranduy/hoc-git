import { describe, expect, it } from "vitest";
import type { OddsFormat } from "@tool-chenh/contracts";
import { toDecimal } from "./convert.js";

describe("toDecimal", () => {
  it.each([
    ["1.26", "HK", "2.26"],
    ["2.054", "DECIMAL", "2.054"],
    ["+126", "AMERICAN", "2.26"],
    ["-150", "AMERICAN", "1.6666666666666666667"],
    ["0.84", "MALAY", "1.84"],
    ["-0.8", "MALAY", "2.25"]
  ] as const)("converts %s %s", (raw, format, expected) => {
    expect(toDecimal(raw, format).toSignificantDigits(20).toString()).toBe(expected);
  });

  it("rejects zero-or-lower decimal odds", () => {
    expect(() => toDecimal("0", "DECIMAL")).toThrow(
      "decimal odds must be greater than 1"
    );
  });

  it("rejects unrecognized runtime formats instead of treating them as American", () => {
    expect(() => toDecimal("100", "UNKNOWN" as OddsFormat)).toThrow("unsupported odds format");
  });

  it.each(["0", "1.01", "-1.01"])("rejects out-of-range Malay odds %s", (raw) => {
    expect(() => toDecimal(raw, "MALAY")).toThrow("Malay odds must be between -1 and 1 excluding 0");
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
