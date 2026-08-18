import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoiBadge } from "./roi-badge.js";

describe("RoiBadge", () => {
  it.each([
    [-0.01, "negative"],
    [0, "medium"],
    [5, "medium"],
    [5.01, "high"]
  ] as const)("renders ROI %s with the common %s tone", (roi, tone) => {
    render(<RoiBadge roiPercent={roi} />);
    expect(screen.getByText(`ROI ${roi.toFixed(2)}%`).classList.contains(`roi-badge--${tone}`)).toBe(true);
  });
});
