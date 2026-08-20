import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { recoverAttachedSource, snapshotRecoveryMode } from "./snapshot-recovery.js";

describe("snapshotRecoveryMode", () => {
  it("recovers every provider in place instead of hard-reloading an attached tab", () => {
    expect(snapshotRecoveryMode("CMD")).toBe("DOM_CAPTURE");
    for (const lobby of ["BTI", "IM", "KSPORT", "SABA", "TSPORT", "SBO"] as const) {
      expect(snapshotRecoveryMode(lobby)).toBe("CATALOG_REFRESH");
    }
  });

  it.each(["BTI", "IM", "KSPORT", "SABA", "TSPORT", "SBO"] as const)(
    "refreshes %s in place without replacing its source", async (lobby) => {
    const capture = vi.fn(async () => undefined);
    const reload = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);

    await recoverAttachedSource({ lobby, tabId: 13, hostname: lobby === "BTI"
      ? "prod20091.fxf774.com" : "imsports.directsb.net" },
      { capture, reload, refresh });

    expect(refresh).toHaveBeenCalledWith({ lobby, tabId: 13, hostname: lobby === "BTI"
      ? "prod20091.fxf774.com" : "imsports.directsb.net" });
    expect(capture).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("performs a fresh SABA recovery without replaying cached payload bytes or reloading", async () => {
    const capture = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    const reload = vi.fn(async () => undefined);

    await recoverAttachedSource({ lobby: "SABA", tabId: 11, hostname: "c0z0oc.bp8newhost.com" },
      { capture, refresh, reload });
    expect(capture).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
