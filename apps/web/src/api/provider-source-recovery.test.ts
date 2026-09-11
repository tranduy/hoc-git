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

  it("does not navigate APSPORT when its automatic roster snapshot needs longer than ten seconds", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sources: [{ lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7,
        state: "STALE", lastSequence: 10, lastAcceptedAtMs: 2_000, reason: null,
        authorityDisposition: "ACTIVE" }] }))
      .mockResolvedValueOnce(json({ sourceId: "chrome:TSPORT:7", requested: 1 }, 202));

    await expect(new ProviderSourceRecoveryApi(fetcher).recover("APSPORT", "AUTO"))
      .rejects.toThrow("FRESH_BASELINE_NOT_CONFIRMED");

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["IM", "BTI", "CMD", "SABA"] as const)("does not escalate an unconfirmed %s automatic snapshot to maintenance", async provider => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sources: [{ lobby: provider, sourceId: `chrome:${provider}:7`, tabId: 7,
        state: "LIVE", lastSequence: 1, lastAcceptedAtMs: 2_000, reason: null,
        authorityDisposition: "CANDIDATE" }] }))
      .mockResolvedValueOnce(json({ sourceId: `chrome:${provider}:7`, requested: 1 }, 202))
      .mockResolvedValueOnce(json({ provider, requested: 1 }, 202));

    await expect(new ProviderSourceRecoveryApi(fetcher).recover(provider, "AUTO"))
      .rejects.toThrow("FRESH_BASELINE_NOT_CONFIRMED");
    expect(fetcher).toHaveBeenCalledTimes(2);
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

  it.each(["IM", "BTI", "CMD", "SABA", "SBOBET", "APSPORT"] as const)("queues explicit %s manual DATA refresh", async provider => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ provider, requested: 1, status: "QUEUED", requestId: "manual:1", requestedAtMs: 100 }, 202));

    await expect(new ProviderSourceRecoveryApi(fetcher).recover(provider, "MANUAL"))
      .resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/chrome-bridge/refresh-data",
      expect.objectContaining({ method: "POST" }));
  });

  it("reports a missing source without automatically requesting maintenance", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sources: [] }))
      .mockResolvedValueOnce(json({ provider: "BTI", requested: 1 }, 202));

    await expect(new ProviderSourceRecoveryApi(fetcher).recover("BTI", "AUTO"))
      .rejects.toThrow("SOURCE_NOT_ATTACHED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not turn a failed discovery GET into a maintenance request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json({ provider: "BTI", requested: 1 }, 202));
    await expect(new ProviderSourceRecoveryApi(fetcher).recover("BTI", "AUTO")).rejects.toThrow("Failed to fetch");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("prefers the active owner over newer candidate and retired records", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sources: [
        { lobby: "IM", sourceId: "chrome:IM:active", state: "STALE", lastAcceptedAtMs: 100, authorityDisposition: "ACTIVE" },
        { lobby: "IM", sourceId: "chrome:IM:candidate", state: "LIVE", lastAcceptedAtMs: 200, authorityDisposition: "CANDIDATE" },
        { lobby: "IM", sourceId: "chrome:IM:retired", state: "LIVE", lastAcceptedAtMs: 300, authorityDisposition: "RETIRED" }
      ] }))
      .mockImplementationOnce(async (_url, options) => json({ sourceId: JSON.parse(String(options?.body)).sourceId,
        requested: 1, baseline: { sourceEpoch: "epoch", activeGeneration: "generation", lastCompleteBaselineAtMs: 301 } }));
    await expect(new ProviderSourceRecoveryApi(fetcher).recover("IM", "AUTO")).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/chrome-bridge/request-snapshot", expect.objectContaining({
      body: JSON.stringify({ sourceId: "chrome:IM:active", timeoutMs: 10_000 })
    }));
  });

  it("does not request a snapshot from an explicitly retired source", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ sources: [
      { lobby: "IM", sourceId: "chrome:IM:retired", state: "LIVE", lastAcceptedAtMs: 300, authorityDisposition: "RETIRED" }
    ] })).mockResolvedValueOnce(json({ sourceId: "chrome:IM:retired", requested: 1, baseline: {
      sourceEpoch: "old", activeGeneration: "old-generation", lastCompleteBaselineAtMs: 301
    } }));
    await expect(new ProviderSourceRecoveryApi(fetcher).recover("IM", "AUTO")).rejects.toThrow("SOURCE_NOT_ATTACHED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
