import { describe, expect, it } from "vitest";
import { roiTone } from "./roi-tone.js";

describe("roiTone", () => {
  it.each([
    ["5.01", "high"],
    ["5", "medium"],
    ["0", "medium"],
    ["-0.01", "negative"]
  ] as const)("classifies ROI %s as %s", (roiPercent, expected) => {
    expect(roiTone(roiPercent)).toBe(expected);
  });
});
