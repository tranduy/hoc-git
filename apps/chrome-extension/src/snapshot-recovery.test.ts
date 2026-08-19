import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { recoverAttachedSource, snapshotRecoveryMode } from "./snapshot-recovery.js";

describe("snapshotRecoveryMode", () => {
  it("captures public DOM providers and reloads network-only providers after bridge state loss", () => {
    expect(snapshotRecoveryMode("CMD")).toBe("DOM_CAPTURE");
    expect(snapshotRecoveryMode("BTI")).toBe("CATALOG_REFRESH");
    for (const lobby of ["SABA", "IM", "KSPORT", "TSPORT", "SBO"] as const) {
      expect(snapshotRecoveryMode(lobby)).toBe("TAB_RELOAD");
    }
  });

  it("refreshes BTI in place without consuming its one-time launch again", async () => {
    const capture = vi.fn(async () => undefined);
    const reload = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);

    await recoverAttachedSource({ lobby: "BTI", tabId: 13, hostname: "prod20091.fxf774.com" },
      { capture, reload, refresh });

    expect(refresh).toHaveBeenCalledWith({ lobby: "BTI", tabId: 13, hostname: "prod20091.fxf774.com" });
    expect(capture).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("always performs a fresh recovery instead of replaying cached payload bytes", async () => {
    const capture = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    const reload = vi.fn(async () => undefined);

    await recoverAttachedSource({ lobby: "SABA", tabId: 11, hostname: "c0z0oc.bp8newhost.com" },
      { capture, refresh, reload });
    await recoverAttachedSource({ lobby: "IM", tabId: 12, hostname: "imsports.directsb.net" },
      { capture, refresh, reload });

    expect(capture).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(reload.mock.calls).toEqual([[11], [12]]);
  });
});
