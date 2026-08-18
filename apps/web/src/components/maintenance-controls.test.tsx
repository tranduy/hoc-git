import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaintenanceStatus } from "../api/maintenance.js";
import { MaintenanceControls } from "./maintenance-controls.js";

const status: MaintenanceStatus = { running: false, scheduledHour: 3, lastStartedAtMs: null,
  lastCompletedAtMs: null, lastResult: null, notifications: [
    { id: "1", atMs: 1_000, level: "ERROR", message: "SABA hết phiên" }
  ] };

afterEach(cleanup);

describe("MaintenanceControls", () => {
  it("keeps restart and notification controls in a fixed top action layer", async () => {
    render(<MaintenanceControls api={{ status: async () => status, refreshAll: async () => status }} />);
    const bell = await screen.findByRole("button", { name: /thông báo hệ thống/i });
    const refresh = screen.getByRole("button", { name: "Reset sàn" });

    expect(bell.closest(".maintenance-top-actions")).toBeTruthy();
    expect(refresh.closest(".maintenance-top-actions")).toBeTruthy();
    expect(refresh.querySelector(".maintenance-restart-icon")).toBeTruthy();
    expect(refresh.getAttribute("title")).toBe("Chỉ reset khi cần thiết");
  });

  it("uses an in-app confirmation modal instead of window.confirm", async () => {
    const refreshAll = vi.fn(async () => status);
    const browserConfirm = vi.spyOn(window, "confirm");
    render(<MaintenanceControls api={{ status: async () => status, refreshAll }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reset sàn" }));

    expect(screen.getByRole("dialog", { name: /xác nhận làm mới tất cả sảnh/i })).toBeTruthy();
    expect(refreshAll).not.toHaveBeenCalled();
    expect(browserConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /hủy/i }));
    expect(screen.queryByRole("dialog", { name: /xác nhận làm mới tất cả sảnh/i })).toBeNull();
    browserConfirm.mockRestore();
  });

  it("covers the whole screen with progress until maintenance completes", async () => {
    let resolveRefresh!: (value: MaintenanceStatus) => void;
    const refreshAll = vi.fn(() => new Promise<MaintenanceStatus>((resolve) => { resolveRefresh = resolve; }));
    render(<MaintenanceControls api={{ status: async () => status, refreshAll }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reset sàn" }));
    fireEvent.click(screen.getByRole("button", { name: /xác nhận làm mới/i }));

    const overlay = screen.getByRole("status", { name: /đang làm mới tất cả sảnh/i });
    expect(overlay.classList.contains("maintenance-fullscreen-progress")).toBe(true);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("5");
    expect(refreshAll).toHaveBeenCalledOnce();

    resolveRefresh(status);
    await waitFor(() => expect(screen.queryByRole("status", { name: /đang làm mới tất cả sảnh/i })).toBeNull());
  });

  it("closes the notification popover when clicking outside", async () => {
    render(<><MaintenanceControls api={{ status: async () => status, refreshAll: async () => status }} />
      <button onPointerDown={(event) => event.stopPropagation()} type="button">Outside control</button></>);
    const bell = await screen.findByRole("button", { name: /thông báo hệ thống/i });
    fireEvent.click(bell);
    expect(screen.getByRole("complementary", { name: /10 thông báo/i })).toBeTruthy();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside control" }));

    expect(screen.queryByRole("complementary", { name: /10 thông báo/i })).toBeNull();
  });
});
