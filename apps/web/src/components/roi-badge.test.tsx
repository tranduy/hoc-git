import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RoiBadge } from "./roi-badge.js";
afterEach(cleanup);

describe("RoiBadge", () => {
  it.each([
    [-0.01, "negative"],
    [0, "neutral"],
    [5, "medium"],
    [5.01, "high"]
  ] as const)("renders ROI %s with the common %s tone", (roi, tone) => {
    render(<RoiBadge roiPercent={roi} />);
    expect(screen.getByText(`ROI ${roi.toFixed(2)}%`).classList.contains(`roi-badge--${tone}`)).toBe(true);
  });
  it("keeps zero profit neutral even if an inconsistent ROI is positive", () => {
    render(<RoiBadge roiPercent="8" worstCaseProfit="0" />);
    expect(screen.getByText("ROI 8.00%").classList.contains("roi-badge--neutral")).toBe(true);
  });
  it.each(["0.000001", "-0.000001"])("preserves the nonzero sign of tiny ROI %s", (roi) => {
    render(<RoiBadge roiPercent={roi} worstCaseProfit={roi} />);
    expect(screen.getByText(`ROI ${roi.startsWith("-") ? ">-0.01" : "<0.01"}%`)).toBeTruthy();
    expect(screen.queryByText(/ROI -?0\.00%/)).toBeNull();
  });
  it("renders the screenshot's tiny negative ROI with a compact bound and negative tone", () => {
    render(<RoiBadge roiPercent="-2.17e-38" worstCaseProfit="-2e-34" />);
    const badge = screen.getByText("ROI >-0.01%");
    expect(badge.classList.contains("roi-badge--negative")).toBe(true);
    expect(badge.textContent).not.toMatch(/\de[+-]?\d/iu);
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
