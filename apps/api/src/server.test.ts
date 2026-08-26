import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeSourceSnapshot } from "./chrome-bridge/chrome-bridge-registry.js";
import { ProviderFeedRegistry } from "./chrome-bridge/provider-feed-registry.js";
import { providerFeedPolicies } from "./chrome-bridge/provider-feed-policies.js";
import type { ProviderFeedSnapshot, ProviderRecoveryRequest } from "./chrome-bridge/provider-feed-types.js";
import { PipelineTelemetry } from "./diagnostics/pipeline-telemetry.js";
import { localWarpAuthEnabled, startProviderRecoverySweep } from "./server.js";
import * as serverModule from "./server.js";

const SABA = "catalog-source:SABA:FOOTBALL";
const sabaPolicy = providerFeedPolicies.get(SABA)!;
const APSPORT = "catalog-source:APSPORT:FOOTBALL";
type TestRefreshableProvider = "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI";

function recoveryRequest(accountId = SABA): ProviderRecoveryRequest {
  return { accountId, stage: "SOFT", attempt: 1, requestedAtMs: 1_000 };
}

function recovered(accountId = SABA) {
  return { accountId, stage: "SOFT" as const, outcome: "RECOVERED" as const, reason: null };
}

function liveSnapshot(accountId: string, atMs: number,
  sourceId = `chrome:${accountId.split(":")[1]}:1`): ProviderFeedSnapshot {
  return { accountId, state: "LIVE", reason: null, sourceId,
    sourceEpoch: "worker:1", tabReachableAtMs: atMs, providerTransportAtMs: atMs,
    lastAuthoritativeEvidenceAtMs: atMs, lastCompleteBaselineAtMs: atMs, lastDeltaAtMs: null,
    lastSemanticChangeAtMs: atMs, activeGeneration: "generation:1", recoveryStage: "NONE", recoveryAttempt: 0 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("localWarpAuthEnabled", () => {
  it("keeps WARP disabled unless the operator explicitly enables it", () => {
    expect(localWarpAuthEnabled(undefined)).toBe(false);
    expect(localWarpAuthEnabled("0")).toBe(false);
    expect(localWarpAuthEnabled("1")).toBe(true);
  });
});

describe("pipeline diagnostic source wiring", () => {
  it("shows a live candidate source at HOP1 with its candidate disposition", async () => {
    const candidate: ChromeBridgeSourceSnapshot = {
      lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8, state: "LIVE", lastSequence: 12,
      lastAcceptedAtMs: 119_000, reason: null, authorityDisposition: "CANDIDATE"
    };
    const pipelineDiagnosticSources = (serverModule as unknown as {
      pipelineDiagnosticSources(registry: { listSources(): readonly ChromeBridgeSourceSnapshot[] } | null):
        readonly ChromeBridgeSourceSnapshot[];
    }).pipelineDiagnosticSources;
    const telemetry = new PipelineTelemetry({ now: () => 120_000 });

    const result = await telemetry.diagnostic({
      listSources: () => pipelineDiagnosticSources({ listSources: () => [candidate] }),
      listAuthorities: () => [], listFeeds: () => [], listCatalogStatuses: async () => [],
      catalogRevision: () => undefined
    }, "catalog-source:SBOBET:FOOTBALL");

    expect(result?.hops.find((hop) => hop.hop === "HOP1_TAB")).toMatchObject({
      ok: true, detail: { sourceId: "chrome:KSPORT:8", tabId: 8, authorityDisposition: "CANDIDATE" }
    });
  });
});

describe("provider recovery sweep lifecycle", () => {
  it("dispatches every second and disposes the actor and shared registry exactly once", async () => {
    vi.useFakeTimers();
    try {
      const request = recoveryRequest();
      const providerFeeds = { list: vi.fn(() => []), sweep: vi.fn(() => [request]), dispose: vi.fn() };
      const automaticSourceRecovery = {
        recover: vi.fn(async () => recovered()),
        dispose: vi.fn(async () => undefined)
      };
      const lifecycle = startProviderRecoverySweep(providerFeeds, automaticSourceRecovery);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(providerFeeds.sweep).toHaveBeenCalledOnce();
      expect(automaticSourceRecovery.recover).toHaveBeenCalledExactlyOnceWith(request);

      await lifecycle.dispose();
      await lifecycle.dispose();
      expect(automaticSourceRecovery.dispose).toHaveBeenCalledOnce();
      expect(providerFeeds.dispose).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(providerFeeds.sweep).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not consume SOFT or HARD controller attempts while the account is suppressed", async () => {
    vi.useFakeTimers();
    try {
      let nowMs = 0;
      let suppressed = true;
      const providerFeeds = new ProviderFeedRegistry({ now: () => nowMs });
      const actor = { recover: vi.fn(async (request: ProviderRecoveryRequest) => recovered(request.accountId)),
        dispose: vi.fn(async () => undefined) };
      const startSweep = startProviderRecoverySweep as unknown as (
        feeds: ProviderFeedRegistry, recovery: typeof actor,
        options: { isRecoverySuppressed(accountId: string): boolean }
      ) => { dispose(): Promise<void> };
      const lifecycle = startSweep(providerFeeds, actor, {
        isRecoverySuppressed: (accountId) => accountId === SABA && suppressed
      });

      nowMs = sabaPolicy.softRecoveryAfterMs + 1;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(providerFeeds.snapshot(SABA)).toMatchObject({ recoveryStage: "NONE", recoveryAttempt: 0 });

      suppressed = false;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(providerFeeds.snapshot(SABA)).toMatchObject({ recoveryStage: "SOFT", recoveryAttempt: 1 });

      suppressed = true;
      nowMs = sabaPolicy.hardRecoveryAfterMs + 1;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(providerFeeds.snapshot(SABA)).toMatchObject({ recoveryStage: "SOFT", recoveryAttempt: 1 });

      suppressed = false;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(providerFeeds.snapshot(SABA)).toMatchObject({ recoveryStage: "HARD", recoveryAttempt: 2 });
      await lifecycle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports rejecting recovery promises instead of creating an unhandled rejection", async () => {
    vi.useFakeTimers();
    try {
      const request = recoveryRequest();
      const failure = new Error("RECOVERY_ACTOR_FAILED");
      const providerFeeds = { list: vi.fn(() => []), sweep: vi.fn(() => [request]), dispose: vi.fn() };
      const actor = { recover: vi.fn(async () => { throw failure; }), dispose: vi.fn(async () => undefined) };
      const onError = vi.fn();
      const startSweep = startProviderRecoverySweep as unknown as (
        feeds: typeof providerFeeds, recovery: typeof actor,
        options: { onError(accountId: string | null, error: unknown): void }
      ) => { dispose(): Promise<void> };
      const lifecycle = startSweep(providerFeeds, actor, { onError });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(onError).toHaveBeenCalledExactlyOnceWith(SABA, failure);
      await lifecycle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a throwing registry sweep and keeps the interval alive for the next tick", async () => {
    vi.useFakeTimers();
    try {
      const request = recoveryRequest();
      const failure = new Error("RECOVERY_SWEEP_FAILED");
      const providerFeeds = { list: vi.fn(() => []),
        sweep: vi.fn().mockImplementationOnce(() => { throw failure; }).mockReturnValueOnce([request]),
        dispose: vi.fn() };
      const actor = { recover: vi.fn(async () => recovered()), dispose: vi.fn(async () => undefined) };
      const onError = vi.fn();
      const startSweep = startProviderRecoverySweep as unknown as (
        feeds: typeof providerFeeds, recovery: typeof actor,
        options: { onError(accountId: string | null, error: unknown): void }
      ) => { dispose(): Promise<void> };
      const lifecycle = startSweep(providerFeeds, actor, { onError });

      await vi.advanceTimersByTimeAsync(2_000);

      expect(providerFeeds.sweep).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledExactlyOnceWith(null, failure);
      expect(actor.recover).toHaveBeenCalledExactlyOnceWith(request);
      await lifecycle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("targeted manual provider refresh ownership", () => {
  function factory<T>(options: T) {
    const create = (serverModule as unknown as {
      createTargetedProviderRefresh(options: T): {
        refresh(provider: TestRefreshableProvider): Promise<number>;
        isRecoverySuppressed(accountId: string): boolean;
      };
    }).createTargetedProviderRefresh;
    return create(options);
  }

  it.each([
    ["SABA", SABA, "SABA"],
    ["APSPORT", APSPORT, "TSPORT"]
  ] as const)("restores %s first and skips a fresh launch after exact baseline confirmation",
    async (provider, accountId, lobby) => {
    const restore = vi.fn(() => 1);
    const deliver = vi.fn(async () => 1);
    const waitForFreshBaseline = vi.fn(async () =>
      liveSnapshot(accountId, 1_001, `chrome:${lobby}:7`));
    const manual = factory({ now: () => 1_000, baselineTimeoutMs: 5_000,
      restore, deliver, waitForFreshBaseline });

    await expect(manual.refresh(provider)).resolves.toBe(1);

    expect(restore).toHaveBeenCalledExactlyOnceWith(lobby);
    expect(deliver).not.toHaveBeenCalled();
    expect(waitForFreshBaseline).toHaveBeenCalledExactlyOnceWith(accountId, 1_000, 2_500);
  });

  it("falls back to a fresh SABA launch with its own delivery-bound cutoff when restore is undelivered",
    async () => {
    let nowMs = 1_000;
    const restore = vi.fn(() => 0);
    const deliver = vi.fn(async (_provider: TestRefreshableProvider, beforeDelivery?: () => void) => {
      nowMs = 1_200;
      beforeDelivery?.();
      return 1;
    });
    const waitForFreshBaseline = vi.fn(async () => liveSnapshot(SABA, 1_201));
    const manual = factory({ now: () => nowMs, baselineTimeoutMs: 5_000,
      restore, deliver, waitForFreshBaseline });

    await expect(manual.refresh("SABA")).resolves.toBe(1);

    expect(restore).toHaveBeenCalledExactlyOnceWith("SABA");
    expect(deliver).toHaveBeenCalledOnce();
    expect(waitForFreshBaseline).toHaveBeenCalledExactlyOnceWith(SABA, 1_200, 4_800);
  });

  it("falls back to a fresh TSPORT launch when installation restore send throws", async () => {
    let nowMs = 1_000;
    const restore = vi.fn(() => { throw new Error("SOCKET_SEND_FAILED"); });
    const deliver = vi.fn(async (_provider: TestRefreshableProvider, beforeDelivery?: () => void) => {
      nowMs = 1_100;
      beforeDelivery?.();
      return 1;
    });
    const waitForFreshBaseline = vi.fn(async () =>
      liveSnapshot(APSPORT, 1_101, "chrome:TSPORT:8"));
    const manual = factory({ now: () => nowMs, baselineTimeoutMs: 5_000,
      restore, deliver, waitForFreshBaseline });

    await expect(manual.refresh("APSPORT")).resolves.toBe(1);

    expect(restore).toHaveBeenCalledExactlyOnceWith("TSPORT");
    expect(deliver).toHaveBeenCalledOnce();
    expect(waitForFreshBaseline).toHaveBeenCalledExactlyOnceWith(APSPORT, 1_100, 4_900);
  });

  it("shares one deadline between a timed-out restore probe and fresh SABA fallback", async () => {
    let nowMs = 1_000;
    const restore = vi.fn(() => 1);
    const deliver = vi.fn(async (_provider: TestRefreshableProvider, beforeDelivery?: () => void) => {
      nowMs = 4_000;
      beforeDelivery?.();
      return 1;
    });
    const waitForFreshBaseline = vi.fn()
      .mockImplementationOnce(async () => {
        nowMs = 3_500;
        throw new Error("PROVIDER_FEED_BASELINE_TIMEOUT");
      })
      .mockImplementationOnce(async () => liveSnapshot(SABA, 4_001));
    const manual = factory({ now: () => nowMs, baselineTimeoutMs: 5_000,
      restore, deliver, waitForFreshBaseline });

    await expect(manual.refresh("SABA")).resolves.toBe(1);

    expect(waitForFreshBaseline).toHaveBeenNthCalledWith(1, SABA, 1_000, 2_500);
    expect(waitForFreshBaseline).toHaveBeenNthCalledWith(2, SABA, 4_000, 2_000);
  });

  it("does not accept a wrong-lobby baseline as restored SABA authority", async () => {
    const restore = vi.fn(() => 1);
    const deliver = vi.fn(async () => 1);
    const waitForFreshBaseline = vi.fn()
      .mockResolvedValueOnce(liveSnapshot(SABA, 1_001, "chrome:TSPORT:9"))
      .mockResolvedValueOnce(liveSnapshot(SABA, 1_002, "chrome:SABA:8"));
    const manual = factory({ now: () => 1_000, baselineTimeoutMs: 5_000,
      restore, deliver, waitForFreshBaseline });

    await expect(manual.refresh("SABA")).resolves.toBe(1);

    expect(deliver).not.toHaveBeenCalled();
    expect(waitForFreshBaseline).toHaveBeenNthCalledWith(1, SABA, 1_000, 2_500);
    expect(waitForFreshBaseline).toHaveBeenNthCalledWith(2, SABA, 1_001, 2_500);
  });

  it("does not accept a cross-account baseline carrying a SABA-shaped source id", async () => {
    const deliver = vi.fn(async () => 1);
    const waitForFreshBaseline = vi.fn()
      .mockResolvedValueOnce(liveSnapshot(APSPORT, 1_001, "chrome:SABA:9"))
      .mockResolvedValueOnce(liveSnapshot(SABA, 1_002, "chrome:SABA:8"));
    const manual = factory({ now: () => 1_000, baselineTimeoutMs: 5_000,
      restore: vi.fn(() => 1), deliver, waitForFreshBaseline });

    await expect(manual.refresh("SABA")).resolves.toBe(1);

    expect(deliver).not.toHaveBeenCalled();
    expect(waitForFreshBaseline).toHaveBeenNthCalledWith(1, SABA, 1_000, 2_500);
    expect(waitForFreshBaseline).toHaveBeenNthCalledWith(2, SABA, 1_001, 2_500);
  });

  it("does not start fresh SABA delivery at the exact total deadline", async () => {
    let nowMs = 1_000;
    const deliver = vi.fn(async (_provider: TestRefreshableProvider, beforeDelivery?: () => void) => {
      nowMs = 6_000;
      beforeDelivery?.();
      return 1;
    });
    const waitForFreshBaseline = vi.fn(async () => liveSnapshot(SABA, 6_001));
    const manual = factory({ now: () => nowMs, baselineTimeoutMs: 5_000,
      restore: vi.fn(() => 0), deliver, waitForFreshBaseline });

    await expect(manual.refresh("SABA")).rejects.toThrow("PROVIDER_FEED_BASELINE_TIMEOUT");
    expect(waitForFreshBaseline).not.toHaveBeenCalled();
  });

  it("keeps non-SABA providers on the existing fresh-delivery path", async () => {
    let nowMs = 1_000;
    const restore = vi.fn(() => 1);
    const deliver = vi.fn(async (_provider: TestRefreshableProvider, beforeDelivery?: () => void) => {
      nowMs = 1_100;
      beforeDelivery?.();
      return 1;
    });
    const waitForFreshBaseline = vi.fn(async () =>
      liveSnapshot("catalog-source:IM:FOOTBALL", 1_101));
    const manual = factory({ now: () => nowMs, baselineTimeoutMs: 5_000,
      restore, deliver, waitForFreshBaseline });

    await expect(manual.refresh("IM")).resolves.toBe(1);

    expect(restore).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledOnce();
    expect(waitForFreshBaseline).toHaveBeenCalledExactlyOnceWith(
      "catalog-source:IM:FOOTBALL", 1_100, 4_900
    );
  });

  it("keeps concurrent same-provider ownership until every baseline confirmation settles", async () => {
    const firstWait = deferred<ProviderFeedSnapshot>();
    const secondWait = deferred<ProviderFeedSnapshot>();
    let nowMs = 1_000;
    const waitForFreshBaseline = vi.fn()
      .mockReturnValueOnce(firstWait.promise)
      .mockReturnValueOnce(secondWait.promise);
    const manual = factory({ now: () => nowMs, baselineTimeoutMs: 5_000,
      deliver: vi.fn(async (_provider: TestRefreshableProvider, beforeDelivery?: () => void) => {
        beforeDelivery?.();
        return 1;
      }), waitForFreshBaseline });

    const first = manual.refresh("SABA");
    nowMs = 2_000;
    const second = manual.refresh("SABA");
    await vi.waitFor(() => expect(waitForFreshBaseline).toHaveBeenCalledTimes(2));
    expect(manual.isRecoverySuppressed(SABA)).toBe(true);

    firstWait.resolve(liveSnapshot(SABA, 1_001));
    await expect(first).resolves.toBe(1);
    expect(manual.isRecoverySuppressed(SABA)).toBe(true);

    secondWait.reject(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"));
    await expect(second).rejects.toThrow("PROVIDER_FEED_BASELINE_TIMEOUT");
    expect(manual.isRecoverySuppressed(SABA)).toBe(false);
    expect(waitForFreshBaseline).toHaveBeenNthCalledWith(1, SABA, 1_000, 4_000);
    expect(waitForFreshBaseline).toHaveBeenNthCalledWith(2, SABA, 2_000, 5_000);
  });

  it("releases ownership when targeted delivery itself fails", async () => {
    const failure = new Error("DELIVERY_FAILED");
    const manual = factory({ now: () => 1_000, baselineTimeoutMs: 5_000,
      deliver: vi.fn(async () => { throw failure; }), waitForFreshBaseline: vi.fn() });

    await expect(manual.refresh("SABA")).rejects.toThrow("DELIVERY_FAILED");
    expect(manual.isRecoverySuppressed(SABA)).toBe(false);
  });
});
