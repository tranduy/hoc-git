import { describe, expect, it, vi } from "vitest";
import { MaintenanceApi } from "./maintenance.js";

const status = {
  running: false,
  scheduledHour: null,
  lastStartedAtMs: null,
  lastCompletedAtMs: null,
  lastResult: null,
  notifications: []
};

describe("MaintenanceApi", () => {
  it("accepts maintenance status only when no daily reset is scheduled", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(status), { status: 200 }));

    await expect(new MaintenanceApi(fetcher as typeof fetch).status()).resolves.toEqual(status);
    expect(fetcher).toHaveBeenCalledWith("/api/maintenance", expect.objectContaining({
      method: "GET", cache: "no-store"
    }));

    const scheduled = new MaintenanceApi(async () => new Response(JSON.stringify({
      ...status,
      scheduledHour: 3
    }), { status: 200 }));
    await expect(scheduled.status()).rejects.toThrow("Invalid maintenance response");
  });
});
