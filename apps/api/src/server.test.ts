import { describe, expect, it, vi } from "vitest";
import { ProviderFeedRegistry } from "./chrome-bridge/provider-feed-registry.js";
import type { ProviderFeedSnapshot, ProviderRecoveryRequest } from "./chrome-bridge/provider-feed-types.js";
import { localWarpAuthEnabled, startProviderRecoverySweep } from "./server.js";
import * as serverModule from "./server.js";

const SABA = "catalog-source:SABA:FOOTBALL";

function recoveryRequest(accountId = SABA): ProviderRecoveryRequest {
  return { accountId, stage: "SOFT", attempt: 1, requestedAtMs: 1_000 };
}

function recovered(accountId = SABA) {
  return { accountId, stage: "SOFT" as const, outcome: "RECOVERED" as const, reason: null };
}

function liveSnapshot(accountId: string, atMs: number): ProviderFeedSnapshot {
  return { accountId, state: "LIVE", reason: null, sourceId: `chrome:${accountId.split(":")[1]}:1`,
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

      nowMs = 21_001;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(providerFeeds.snapshot(SABA)).toMatchObject({ recoveryStage: "NONE", recoveryAttempt: 0 });

      suppressed = false;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(providerFeeds.snapshot(SABA)).toMatchObject({ recoveryStage: "SOFT", recoveryAttempt: 1 });

      suppressed = true;
      nowMs = 52_001;
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
        refresh(provider: "SABA"): Promise<number>;
        isRecoverySuppressed(accountId: string): boolean;
      };
    }).createTargetedProviderRefresh;
    return create(options);
  }

  it("keeps concurrent same-provider ownership until every baseline confirmation settles", async () => {
    const firstWait = deferred<ProviderFeedSnapshot>();
    const secondWait = deferred<ProviderFeedSnapshot>();
    let nowMs = 1_000;
    const waitForFreshBaseline = vi.fn()
      .mockReturnValueOnce(firstWait.promise)
      .mockReturnValueOnce(secondWait.promise);
    const manual = factory({ now: () => nowMs, baselineTimeoutMs: 5_000,
      deliver: vi.fn(async () => 1), waitForFreshBaseline });

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
    expect(waitForFreshBaseline).toHaveBeenNthCalledWith(1, SABA, 1_000, 5_000);
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
