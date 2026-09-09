import { describe, expect, it } from "vitest";
import { formatProfitAmount, formatRoiPercent, roiTone } from "./roi-tone.js";

describe("roiTone", () => {
  it.each([
    ["5.01", "high"],
    ["5", "medium"],
    ["0", "neutral"],
    ["-0.01", "negative"]
  ] as const)("classifies ROI %s as %s", (roiPercent, expected) => {
    expect(roiTone(roiPercent)).toBe(expected);
  });
  it("requires exact positive worst-case profit before applying a positive tone", () => {
    expect(roiTone("6", "0")).toBe("neutral");
    expect(roiTone("6", "-0.00000001")).toBe("negative");
    expect(roiTone("0.00000001", "0.00000001")).toBe("medium");
    expect(roiTone("NaN")).toBe("neutral");
  });
  it("does not round a real tiny signed profit into zero money", () => {
    expect(formatProfitAmount("0")).toBe("0");
    expect(formatProfitAmount("0.000001")).toBe("<0.01");
    expect(formatProfitAmount("-0.000001")).toBe(">-0.01");
    expect(formatProfitAmount("20000")).toBe("20,000");
  });
  it.each(["", "-"])("formats screenshot-scale %s values with compact signed bounds", sign => {
    const expected = sign === "-" ? ">-0.01" : "<0.01";
    const labels = [formatRoiPercent(`${sign}2.17e-38`), formatProfitAmount(`${sign}2e-34`),
      formatProfitAmount(`${sign}2e-34`, "vi-VN")];
    expect(labels).toEqual([expected, expected, expected]);
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(6);
      expect(label).not.toMatch(/e[+-]?\d|^-?0(?:\.0+)?$/iu);
    }
    expect(roiTone(`${sign}2.17e-38`, `${sign}2e-34`)).toBe(sign === "-" ? "negative" : "medium");
  });
  it("preserves ordinary rounding and actual zero while formatting tiny values", () => {
    expect(formatRoiPercent("0")).toBe("0.00");
    expect(formatRoiPercent("-0")).toBe("0.00");
    expect(formatProfitAmount("0")).toBe("0");
    expect(formatRoiPercent("1.239")).toBe("1.24");
    expect(formatRoiPercent("0.0000123456")).toBe("<0.01");
    expect(formatProfitAmount("-0.0000123456")).toBe(">-0.01");
  });
  it.each([["0.009999", "<0.01"], ["-0.009999", ">-0.01"], ["0.01", "0.01"],
    ["-0.01", "-0.01"]])("uses a strict display bound at %s", (value, expected) => {
    expect(formatRoiPercent(value!)).toBe(expected);
    expect(formatProfitAmount(value!)).toBe(expected);
  });
});
