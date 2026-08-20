import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { recoverAttachedSource, snapshotRecoveryMode } from "./snapshot-recovery.js";

describe("snapshotRecoveryMode", () => {
  it("recovers IM in page instead of hard-reloading its two-part catalog", () => {
    expect(snapshotRecoveryMode("CMD")).toBe("DOM_CAPTURE");
    expect(snapshotRecoveryMode("BTI")).toBe("CATALOG_REFRESH");
    expect(snapshotRecoveryMode("IM")).toBe("CATALOG_REFRESH");
    for (const lobby of ["SABA", "KSPORT", "TSPORT", "SBO"] as const) {
      expect(snapshotRecoveryMode(lobby)).toBe("TAB_RELOAD");
    }
  });

  it.each(["BTI", "IM"] as const)("refreshes %s in place without replacing its source", async (lobby) => {
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

  it("always performs a fresh recovery instead of replaying cached payload bytes", async () => {
    const capture = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    const reload = vi.fn(async () => undefined);

    await recoverAttachedSource({ lobby: "SABA", tabId: 11, hostname: "c0z0oc.bp8newhost.com" },
      { capture, refresh, reload });
    expect(capture).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(reload.mock.calls).toEqual([[11]]);
  });
});
