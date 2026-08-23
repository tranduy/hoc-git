import { describe, expect, it, vi } from "vitest";
import { localWarpAuthEnabled, startProviderRecoverySweep } from "./server.js";

describe("localWarpAuthEnabled", () => {
  it("keeps WARP disabled unless the operator explicitly enables it", () => {
    expect(localWarpAuthEnabled(undefined)).toBe(false);
    expect(localWarpAuthEnabled("0")).toBe(false);
    expect(localWarpAuthEnabled("1")).toBe(true);
  });
});

describe("provider recovery sweep lifecycle", () => {
  it("dispatches every second and disposes the actor and shared registry exactly once", async () => {
    vi.useFakeTimers();
    try {
      const recoveryRequest = {
        accountId: "catalog-source:SABA:FOOTBALL", stage: "SOFT" as const, attempt: 1, requestedAtMs: 1_000
      };
      const providerFeeds = { sweep: vi.fn(() => [recoveryRequest]), dispose: vi.fn() };
      const automaticSourceRecovery = {
        recover: vi.fn(async () => ({ accountId: recoveryRequest.accountId, stage: "SOFT" as const,
          outcome: "RECOVERED" as const, reason: null })),
        dispose: vi.fn()
      };
      const lifecycle = startProviderRecoverySweep(providerFeeds, automaticSourceRecovery);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(providerFeeds.sweep).toHaveBeenCalledOnce();
      expect(automaticSourceRecovery.recover).toHaveBeenCalledExactlyOnceWith(recoveryRequest);

      lifecycle.dispose();
      lifecycle.dispose();
      expect(automaticSourceRecovery.dispose).toHaveBeenCalledOnce();
      expect(providerFeeds.dispose).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(providerFeeds.sweep).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
