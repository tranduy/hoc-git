import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaintenanceStatus } from "../api/maintenance.js";
import type { ProfitAlert } from "../watch/profit-alert-tracker.js";
import { MaintenanceControls } from "./maintenance-controls.js";

const status: MaintenanceStatus = { running: false, scheduledHour: null, lastStartedAtMs: null,
  lastCompletedAtMs: null, lastResult: null, notifications: [
    { id: "1", atMs: 1_000, level: "ERROR", message: "SABA hết phiên" }
  ] };

const profit: ProfitAlert = { id: "profit-1", identity: "event::ticket::BTI:AWAY|SABA:HOME",
  observedAtMs: new Date(2026, 8, 1, 10, 30).getTime(), competition: "Premier League",
  matchName: "Alpha vs Beta", marketName: "Chấp toàn trận", line: "-0.5",
  providers: ["SABA", "BTI"], legs: [{ provider: "SABA", selection: "Alpha" },
    { provider: "BTI", selection: "Beta" }], roi: "0.1261", worstCaseProfit: "80645", currency: "VND",
  freshness: "FRESH" };

afterEach(cleanup);

describe("MaintenanceControls", () => {
  it("keeps restart and notification controls in an inline toolbar group", async () => {
    render(<MaintenanceControls api={{ status: async () => status, refreshAll: async () => status }} profitAlerts={[profit]} />);
    const bell = await screen.findByRole("button", { name: /kèo profit/i });
    const refresh = screen.getByRole("button", { name: "Reset sàn" });

    expect(bell.closest(".maintenance-inline-actions")).toBeTruthy();
    expect(refresh.closest(".maintenance-inline-actions")).toBeTruthy();
    expect(refresh.querySelector(".maintenance-restart-icon")).toBeTruthy();
    expect(refresh.getAttribute("title")).toBe("Kiểm tra và khôi phục tất cả nguồn");
  });

  it("starts reset on the first click without a confirmation step", async () => {
    let resolveRefresh!: (value: MaintenanceStatus) => void;
    const refreshAll = vi.fn(() => new Promise<MaintenanceStatus>((resolve) => { resolveRefresh = resolve; }));
    render(<MaintenanceControls api={{ status: async () => status, refreshAll }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reset sàn" }));

    expect(refreshAll).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status", { name: /đang làm mới tất cả sảnh/i })).toBeTruthy();
    resolveRefresh(status);
  });

  it("covers the whole screen with progress until maintenance completes", async () => {
    let resolveRefresh!: (value: MaintenanceStatus) => void;
    const refreshAll = vi.fn(() => new Promise<MaintenanceStatus>((resolve) => { resolveRefresh = resolve; }));
    render(<MaintenanceControls api={{ status: async () => status, refreshAll }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reset sàn" }));

    const overlay = screen.getByRole("status", { name: /đang làm mới tất cả sảnh/i });
    expect(overlay.classList.contains("maintenance-fullscreen-progress")).toBe(true);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("5");
    expect(refreshAll).toHaveBeenCalledOnce();

    resolveRefresh(status);
    await waitFor(() => expect(screen.queryByRole("status", { name: /đang làm mới tất cả sảnh/i })).toBeNull());
  });

  it("shows profitable ticket history instead of maintenance errors and closes it outside", async () => {
    render(<><MaintenanceControls api={{ status: async () => status, refreshAll: async () => status }} profitAlerts={[profit]} />
      <button onPointerDown={(event) => event.stopPropagation()} type="button">Outside control</button></>);
    const bell = await screen.findByRole("button", { name: /kèo profit.*1/i });
    fireEvent.click(bell);
    const popover = screen.getByRole("complementary", { name: /100 kèo profit/i });
    expect(popover.textContent).toMatch(/Alpha vs Beta.*Chấp toàn trận.*-0.5.*SABA.*BTI.*12.61%.*80.645/isu);
    expect(popover.textContent).not.toContain("SABA hết phiên");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside control" }));

    expect(screen.queryByRole("complementary", { name: /100 kèo profit/i })).toBeNull();
  });
});
