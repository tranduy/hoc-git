import { describe, expect, it, vi } from "vitest";
import { createSessionMaintenanceRunner, MaintenanceJournal,
  runSessionMaintenance, SessionRefreshControl } from "./session-maintenance.js";

describe("runSessionMaintenance", () => {
  it("contains a failed background tick instead of leaking an unhandled rejection", async () => {
    const failure = new Error("VAULT_UNAVAILABLE");
    const report = vi.fn();

    await expect(runSessionMaintenance(async () => { throw failure; }, report)).resolves.toBeUndefined();

    expect(report).toHaveBeenCalledWith(failure);
  });

  it("keeps slow maintenance single-flight across timer ticks", async () => {
    let release: (() => void) | undefined;
    const tick = vi.fn(async () => new Promise<void>((resolve) => { release = resolve; }));
    const maintain = createSessionMaintenanceRunner(tick, vi.fn());

    const first = maintain();
    const overlapping = maintain();
    expect(tick).toHaveBeenCalledTimes(1);

    release?.();
    await Promise.all([first, overlapping]);
    const later = maintain();
    expect(tick).toHaveBeenCalledTimes(2);
    release?.();
    await later;
  });
});

describe("MaintenanceJournal", () => {
  it("keeps at most 500 log rows and exposes the newest 10 notifications", () => {
    const journal = new MaintenanceJournal({ nowMs: () => 1_000 });
    for (let index = 0; index < 505; index += 1) journal.record("INFO", `row-${index}`);

    expect(journal.logs()).toHaveLength(500);
    expect(journal.logs()[0]?.message).toBe("row-5");
    expect(journal.notifications()).toHaveLength(10);
    expect(journal.notifications()[0]?.message).toBe("row-504");
  });
});

describe("SessionRefreshControl", () => {
  it("reports that no automatic daily reset is scheduled", () => {
    const control = new SessionRefreshControl({ refresh: async () => undefined });

    expect(control.status().scheduledHour).toBeNull();
  });

  it("keeps the concrete failed source names in the operator notification", async () => {
    const journal = new MaintenanceJournal({ nowMs: () => 1_000 });
    const control = new SessionRefreshControl({
      refresh: async () => { throw new Error("CHROME_BRIDGE_REFRESH_INCOMPLETE:SABA,BTI"); }, journal
    });

    control.start("MANUAL");
    await vi.waitFor(() => expect(control.status().running).toBe(false));

    expect(control.status().notifications[0]?.message).toContain("SABA,BTI");
  });
});
