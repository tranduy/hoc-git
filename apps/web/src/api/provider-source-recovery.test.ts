import { describe, expect, it, vi } from "vitest";
import { ProviderSourceRecoveryApi } from "./provider-source-recovery.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("ProviderSourceRecoveryApi", () => {
  it("requests an in-page automatic refresh and accepts only a newly confirmed baseline", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sources: [{ lobby: "KSPORT", sourceId: "chrome:KSPORT:9", tabId: 9,
        state: "LIVE", lastSequence: 10, lastAcceptedAtMs: 2_000, reason: null,
        authorityDisposition: "CANDIDATE" }] }))
      .mockResolvedValueOnce(json({ sourceId: "chrome:KSPORT:9", requested: 1, baseline: {
        sourceEpoch: "worker:2", activeGeneration: "sbo:20", lastCompleteBaselineAtMs: 2_100
      } }));
    const api = new ProviderSourceRecoveryApi(fetcher);

    await expect(api.recover("SBOBET", "AUTO")).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/chrome-bridge/request-snapshot", expect.objectContaining({
      method: "POST", body: JSON.stringify({ sourceId: "chrome:KSPORT:9", timeoutMs: 10_000 })
    }));
  });

  it("does not navigate SBOBET when its automatic in-page snapshot has no fresh baseline", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sources: [{ lobby: "KSPORT", sourceId: "chrome:KSPORT:9", tabId: 9,
        state: "LIVE", lastSequence: 10, lastAcceptedAtMs: 2_000, reason: null,
        authorityDisposition: "CANDIDATE" }] }))
      .mockResolvedValueOnce(json({ sourceId: "chrome:KSPORT:9", requested: 1 }, 202));

    await expect(new ProviderSourceRecoveryApi(fetcher).recover("SBOBET", "AUTO"))
      .rejects.toThrow("FRESH_BASELINE_NOT_CONFIRMED");

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back to a targeted hard refresh when the in-page snapshot has no fresh baseline", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sources: [{ lobby: "CMD", sourceId: "chrome:CMD:7", tabId: 7,
        state: "LIVE", lastSequence: 1, lastAcceptedAtMs: 2_000, reason: null,
        authorityDisposition: "CANDIDATE" }] }))
      .mockResolvedValueOnce(json({ sourceId: "chrome:CMD:7", requested: 1 }, 202))
      .mockResolvedValueOnce(json({ provider: "CMD", requested: 1 }, 202));

    await expect(new ProviderSourceRecoveryApi(fetcher).recover("CMD", "AUTO"))
      .resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(3, "/api/maintenance/refresh-provider/CMD",
      expect.objectContaining({ method: "POST", cache: "no-store" }));
  });

  it("requests a new baseline from a stale but still attached provider tab", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sources: [{ lobby: "CMD", sourceId: "chrome:CMD:7", tabId: 7,
        state: "STALE", lastSequence: 1, lastAcceptedAtMs: 2_000, reason: null,
        authorityDisposition: "ACTIVE" }] }))
      .mockResolvedValueOnce(json({ sourceId: "chrome:CMD:7", requested: 1, baseline: {
        sourceEpoch: "worker:2", activeGeneration: "cmd:20", lastCompleteBaselineAtMs: 2_100
      } }));

    await expect(new ProviderSourceRecoveryApi(fetcher).recover("CMD", "AUTO")).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/chrome-bridge/request-snapshot", expect.objectContaining({
      method: "POST", body: JSON.stringify({ sourceId: "chrome:CMD:7", timeoutMs: 10_000 })
    }));
  });

  it("uses the targeted hard refresh for a manual attempt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ provider: "APSPORT", requested: 1 }, 202));

    await expect(new ProviderSourceRecoveryApi(fetcher).recover("APSPORT", "MANUAL"))
      .resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/maintenance/refresh-provider/APSPORT",
      expect.objectContaining({ method: "POST" }));
  });

  it("hard-refreshes the exact provider instead of falling back to cached data when no bridge source exists", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sources: [] }))
      .mockResolvedValueOnce(json({ provider: "BTI", requested: 1 }, 202));

    await expect(new ProviderSourceRecoveryApi(fetcher).recover("BTI", "AUTO"))
      .resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/maintenance/refresh-provider/BTI",
      expect.objectContaining({ method: "POST", cache: "no-store" }));
  });
});
