import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchArbitrageAlert } from "../watch/arbitrage-alert.js";
import { ArbitrageAlertToast } from "./arbitrage-alert-toast.js";

const alert: WatchArbitrageAlert = {
  fingerprint: "FT_TOTAL::SABA|OVER|2.2|50000::SBOBET|UNDER|2.2|50000",
  marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", currency: "VND",
  totalStake: "100000", worstCasePayout: "110000", worstCaseProfit: "10000", roi: "0.1",
  legs: [
    { provider: "SABA", selection: "OVER", decimalOdds: "2.2", stake: "50000", payout: "110000", profit: "10000", role: "BASE" },
    { provider: "SBOBET", selection: "UNDER", decimalOdds: "2.2", stake: "50000", payout: "110000", profit: "10000", role: "HEDGE" }
  ]
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ArbitrageAlertToast", () => {
  it("shows the complete preflight plan and disappears after exactly ten seconds", () => {
    render(<ArbitrageAlertToast alert={alert} matchLabel="Alpha vs Beta" />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("GROSS TWO-WAY PREFLIGHT")).toBeTruthy();
    expect(screen.getByText("Alpha vs Beta")).toBeTruthy();
    expect(screen.getByText(/FT_TOTAL.*Line 2.5/u)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/SABA.*OVER.*2.2.*50,000 VND/u);
    expect(screen.getByRole("alert").textContent).toMatch(/SBOBET.*UNDER.*2.2.*50,000 VND/u);
    expect(screen.getByRole("alert").textContent).toMatch(/BASE.*HEDGE/u);
    expect(screen.getAllByText(/Profit 10,000 VND/u)).toHaveLength(2);
    expect(screen.getByRole("alert").textContent).toMatch(/Worst-case profit.*10,000 VND.*ROI 10.00%/u);
    expect(screen.getByText("Provider preflight is required before placement.")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(9_999); });
    expect(screen.getByRole("alert")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not restart an expired toast for the same fingerprint", () => {
    const view = render(<ArbitrageAlertToast alert={alert} matchLabel="Alpha vs Beta" />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByRole("alert")).toBeNull();

    view.rerender(<ArbitrageAlertToast alert={{ ...alert }} matchLabel="Alpha vs Beta" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a changed opportunity for a fresh ten seconds", () => {
    const view = render(<ArbitrageAlertToast alert={alert} matchLabel="Alpha vs Beta" />);
    act(() => { vi.advanceTimersByTime(10_000); });
    const changed = { ...alert, fingerprint: `${alert.fingerprint}:changed`, worstCaseProfit: "11000" };
    view.rerender(<ArbitrageAlertToast alert={changed} matchLabel="Alpha vs Beta" />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/11,000 VND/u)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(9_999); });
    expect(screen.getByRole("alert")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("removes the toast immediately when the candidate becomes ineligible", () => {
    const view = render(<ArbitrageAlertToast alert={alert} matchLabel="Alpha vs Beta" />);
    view.rerender(<ArbitrageAlertToast alert={null} matchLabel="Alpha vs Beta" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
