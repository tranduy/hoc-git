import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { recoverAttachedSource, snapshotRecoveryMode } from "./snapshot-recovery.js";

describe("snapshotRecoveryMode", () => {
  it("captures public DOM providers and reloads network-only providers after bridge state loss", () => {
    expect(snapshotRecoveryMode("CMD")).toBe("DOM_CAPTURE");
    expect(snapshotRecoveryMode("SABA")).toBe("DOM_CAPTURE");
    for (const lobby of ["IM", "BTI", "KSPORT", "TSPORT", "SBO"] as const) {
      expect(snapshotRecoveryMode(lobby)).toBe("TAB_RELOAD");
    }
  });

  it("always performs a fresh recovery instead of replaying cached payload bytes", async () => {
    const capture = vi.fn(async () => undefined);
    const reload = vi.fn(async () => undefined);

    await recoverAttachedSource({ lobby: "SABA", tabId: 11, hostname: "c0z0oc.bp8newhost.com" }, { capture, reload });
    await recoverAttachedSource({ lobby: "IM", tabId: 12, hostname: "imsports.directsb.net" }, { capture, reload });

    expect(capture).toHaveBeenCalledWith({ lobby: "SABA", tabId: 11, hostname: "c0z0oc.bp8newhost.com" });
    expect(reload).toHaveBeenCalledWith(12);
  });
});
