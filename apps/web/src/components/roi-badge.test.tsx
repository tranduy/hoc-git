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

  it.each(["sm", "md", "lg"] as const)("renders the shared %s framed size", (size) => {
    const view = render(<RoiBadge roiPercent="8.25" size={size} />);
    const badge = view.getByText("ROI 8.25%");
    expect(badge.tagName).toBe("DIV");
    expect(badge.classList.contains("roi-badge")).toBe(true);
    expect(badge.classList.contains(`roi-badge--${size}`)).toBe(true);
    expect(badge.classList.contains("roi-badge--high")).toBe(true);
    view.unmount();
  });

  it("uses the medium framed size by default", () => {
    render(<RoiBadge roiPercent="2.5" />);
    expect(screen.getByText("ROI 2.50%").classList.contains("roi-badge--md")).toBe(true);
  });

  it("always shows the ROI label so every surface uses one visual language", () => {
    render(<RoiBadge roiPercent="12.34" showLabel={false} />);
    expect(screen.getByText("ROI 12.34%")).toBeTruthy();
    expect(screen.queryByText("12.34%", { exact: true })).toBeNull();
  });
});
