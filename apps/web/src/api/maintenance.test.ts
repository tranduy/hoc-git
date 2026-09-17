import { describe, expect, it, vi } from "vitest";
import { MaintenanceApi } from "./maintenance.js";

describe("MaintenanceApi", () => {
  it("accepts a disabled scheduled reload from the server", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      running: false,
      scheduledHour: null,
      lastStartedAtMs: null,
      lastCompletedAtMs: null,
      lastResult: null,
      notifications: []
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const status = await new MaintenanceApi(fetcher as typeof fetch).status();

    expect(status.scheduledHour).toBeNull();
  });
});
