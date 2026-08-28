import type { CatalogSourceStatus } from "@tool-chenh/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderSourceRecoveryCoordinator } from "./provider-source-recovery.js";

const providers = ["SABA", "IM", "SBOBET", "CMD", "APSPORT", "BTI"] as const;

function source(provider: typeof providers[number], active: boolean): CatalogSourceStatus {
  return {
    id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
    sessionState: active ? "ACTIVE" : "ACTION_REQUIRED", sessionSource: "FABET_LOGIN",
    acquiredAtMs: active ? Date.now() : null,
    reason: active ? null : "PROVIDER_VALIDATION_FAILED"
  };
}

describe("ProviderSourceRecoveryCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T05:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs exactly one automatic recovery three seconds after each provider outage", async () => {
    const attempts: Array<{ provider: string; mode: string }> = [];
    const coordinator = new ProviderSourceRecoveryCoordinator({
      recover: async (provider, mode) => { attempts.push({ provider, mode }); }
    });

    coordinator.update(providers.map((provider) => source(provider, false)));

    expect(coordinator.snapshot("CMD")).toMatchObject({
      phase: "COUNTDOWN", countdownSeconds: 3, automaticAttemptsRemaining: 1
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(attempts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual(providers.map((provider) => ({ provider, mode: "AUTO" })));
    expect(coordinator.snapshot("CMD")).toMatchObject({
      phase: "WAITING", countdownKind: "VERIFY", countdownSeconds: 90, automaticAttemptsRemaining: 0
    });

    coordinator.update(providers.map((provider) => source(provider, false)));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attempts).toHaveLength(6);
    coordinator.dispose();
  });

  it("cancels the countdown when the provider becomes active and rearms only after active recovery", async () => {
    const recover = vi.fn(async () => undefined);
    const coordinator = new ProviderSourceRecoveryCoordinator({ recover });

    coordinator.update([source("CMD", false)]);
    await vi.advanceTimersByTimeAsync(2_000);
    coordinator.update([source("CMD", true)]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(recover).not.toHaveBeenCalled();
    expect(coordinator.snapshot("CMD")).toMatchObject({ phase: "IDLE", automaticAttemptsRemaining: 1 });

    coordinator.update([source("CMD", false)]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(recover).toHaveBeenCalledExactlyOnceWith("CMD", "AUTO");
    expect(coordinator.snapshot("CMD").automaticAttemptsRemaining).toBe(0);

    coordinator.update([source("CMD", false)]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(recover).toHaveBeenCalledTimes(1);
    coordinator.update([source("CMD", true)]);
    expect(coordinator.snapshot("CMD").automaticAttemptsRemaining).toBe(1);
    coordinator.dispose();
  });

  it("offers manual recovery after automatic failure and enforces sixty seconds between clicks", async () => {
    const recover = vi.fn()
      .mockRejectedValueOnce(new Error("baseline unavailable"))
      .mockRejectedValueOnce(new Error("provider still down"))
      .mockResolvedValue(undefined);
    const coordinator = new ProviderSourceRecoveryCoordinator({ recover });

    coordinator.update([source("SBOBET", false)]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(coordinator.snapshot("SBOBET")).toMatchObject({
      phase: "COUNTDOWN", countdownKind: "RETRY", automaticAttemptsRemaining: 0,
      manualRetryAfterSeconds: 0
    });

    await expect(coordinator.manual("SBOBET")).resolves.toBe(true);
    expect(recover).toHaveBeenNthCalledWith(2, "SBOBET", "MANUAL");
    expect(coordinator.snapshot("SBOBET")).toMatchObject({
      phase: "COUNTDOWN", countdownKind: "RETRY", manualRetryAfterSeconds: 60
    });
    await expect(coordinator.manual("SBOBET")).resolves.toBe(false);
    expect(recover).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(coordinator.snapshot("SBOBET").manualRetryAfterSeconds).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(coordinator.manual("SBOBET")).resolves.toBe(true);
    expect(recover).toHaveBeenNthCalledWith(3, "SBOBET", "MANUAL");
    coordinator.dispose();
  });

  it("waits ninety seconds for a fresh baseline and retries a still-off provider at the five-minute boundary", async () => {
    const recover = vi.fn(async () => undefined);
    const coordinator = new ProviderSourceRecoveryCoordinator({ recover });

    coordinator.update([source("APSPORT", false)]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot("APSPORT")).toMatchObject({
      phase: "WAITING", countdownKind: "VERIFY", countdownSeconds: 90
    });

    await vi.advanceTimersByTimeAsync(90_000);
    expect(coordinator.snapshot("APSPORT")).toMatchObject({
      phase: "COUNTDOWN", countdownKind: "RETRY", countdownSeconds: 210
    });
    await vi.advanceTimersByTimeAsync(209_999);
    expect(recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(recover).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("keeps the manual click cooldown across a brief successful recovery", async () => {
    const recover = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const coordinator = new ProviderSourceRecoveryCoordinator({ recover });

    coordinator.update([source("BTI", false)]);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(coordinator.manual("BTI")).resolves.toBe(true);
    coordinator.update([source("BTI", true)]);
    coordinator.update([source("BTI", false)]);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(coordinator.snapshot("BTI")).toMatchObject({
      phase: "COUNTDOWN", countdownKind: "RETRY", manualRetryAfterSeconds: 57
    });
    await expect(coordinator.manual("BTI")).resolves.toBe(false);
    coordinator.dispose();
  });

  it("does not auto-recover an expired or schema-invalid login source", async () => {
    const recover = vi.fn(async () => undefined);
    const coordinator = new ProviderSourceRecoveryCoordinator({ recover });
    const expired = { ...source("SABA", false), reason: "EXPIRED" as const };
    const schema = { ...source("IM", false), reason: "SCHEMA_CHANGED" as const };

    coordinator.update([expired, schema]);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(recover).not.toHaveBeenCalled();
    expect(coordinator.snapshot("SABA").phase).toBe("BLOCKED");
    expect(coordinator.snapshot("IM").phase).toBe("BLOCKED");
    coordinator.dispose();
  });

  it("starts the remaining automatic attempt when a blocked source becomes recoverable", async () => {
    const recover = vi.fn(async () => undefined);
    const coordinator = new ProviderSourceRecoveryCoordinator({ recover });

    coordinator.update([{ ...source("SABA", false), reason: "EXPIRED" }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recover).not.toHaveBeenCalled();

    coordinator.update([source("SABA", false)]);
    expect(coordinator.snapshot("SABA")).toMatchObject({
      phase: "COUNTDOWN", countdownSeconds: 3, automaticAttemptsRemaining: 1
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(recover).toHaveBeenCalledExactlyOnceWith("SABA", "AUTO");
    coordinator.dispose();
  });

  it("does not rearm an automatic attempt across a blocked transition without ACTIVE", async () => {
    const recover = vi.fn(async () => undefined);
    const coordinator = new ProviderSourceRecoveryCoordinator({ recover });

    coordinator.update([source("CMD", false)]);
    await vi.advanceTimersByTimeAsync(3_000);
    coordinator.update([{ ...source("CMD", false), reason: "EXPIRED" }]);
    coordinator.update([source("CMD", false)]);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(recover).toHaveBeenCalledExactlyOnceWith("CMD", "AUTO");
    expect(coordinator.snapshot("CMD")).toMatchObject({
      phase: "WAITING", countdownKind: "VERIFY", automaticAttemptsRemaining: 0
    });
    coordinator.dispose();
  });

  it("persists a consumed automatic attempt across remounts until ACTIVE rearms it", async () => {
    const persisted = new Map<string, 0 | 1>();
    const recover = vi.fn(async () => undefined);
    const options = {
      recover,
      loadAutomaticAttemptsRemaining: (provider: string) => persisted.get(provider) ?? 1,
      saveAutomaticAttemptsRemaining: (provider: string, remaining: 0 | 1) => {
        persisted.set(provider, remaining);
      }
    };

    const first = new ProviderSourceRecoveryCoordinator(options);
    first.update([source("APSPORT", false)]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(persisted.get("APSPORT")).toBe(0);
    first.dispose();

    const remounted = new ProviderSourceRecoveryCoordinator(options);
    remounted.update([source("APSPORT", false)]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(remounted.snapshot("APSPORT")).toMatchObject({ phase: "COUNTDOWN", countdownKind: "RETRY" });
    remounted.update([source("APSPORT", true)]);
    expect(persisted.get("APSPORT")).toBe(1);
    remounted.dispose();

    const rearmed = new ProviderSourceRecoveryCoordinator(options);
    rearmed.update([source("APSPORT", false)]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(recover).toHaveBeenCalledTimes(2);
    rearmed.dispose();
  });

  it("persists the manual cooldown deadline across remounts", async () => {
    const automatic = new Map<string, 0 | 1>();
    const manualDeadlines = new Map<string, number>();
    const recover = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const options = {
      recover,
      loadAutomaticAttemptsRemaining: (provider: string) => automatic.get(provider) ?? 1,
      saveAutomaticAttemptsRemaining: (provider: string, remaining: 0 | 1) => {
        automatic.set(provider, remaining);
      },
      loadManualRetryAtMs: (provider: string) => manualDeadlines.get(provider) ?? 0,
      saveManualRetryAtMs: (provider: string, deadlineMs: number) => {
        manualDeadlines.set(provider, deadlineMs);
      }
    };

    const first = new ProviderSourceRecoveryCoordinator(options);
    first.update([source("BTI", false)]);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(first.manual("BTI")).resolves.toBe(true);
    first.dispose();

    const remounted = new ProviderSourceRecoveryCoordinator(options);
    remounted.update([source("BTI", false)]);
    expect(remounted.snapshot("BTI").manualRetryAfterSeconds).toBe(60);
    await expect(remounted.manual("BTI")).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(remounted.manual("BTI")).resolves.toBe(true);
    remounted.dispose();
  });

  it("manually reloads an active provider and keeps its progress visible until completion", async () => {
    let finish!: () => void;
    const recover = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const coordinator = new ProviderSourceRecoveryCoordinator({ recover });
    coordinator.update([source("APSPORT", true)]);

    const reloading = coordinator.manual("APSPORT");

    expect(recover).toHaveBeenCalledExactlyOnceWith("APSPORT", "MANUAL");
    expect(coordinator.snapshot("APSPORT").phase).toBe("RECOVERING");
    coordinator.update([source("APSPORT", true)]);
    expect(coordinator.snapshot("APSPORT").phase).toBe("RECOVERING");
    finish();
    await expect(reloading).resolves.toBe(true);
    expect(coordinator.snapshot("APSPORT")).toMatchObject({
      phase: "IDLE", manualRetryAfterSeconds: 60
    });
    coordinator.dispose();
  });

  it("does not notify the UI again for unchanged healthy or blocked sources", () => {
    const onChange = vi.fn();
    const coordinator = new ProviderSourceRecoveryCoordinator({ recover: async () => undefined, onChange });

    coordinator.update([source("APSPORT", true)]);
    coordinator.update([source("APSPORT", true)]);
    expect(onChange).not.toHaveBeenCalled();

    const expired = { ...source("IM", false), reason: "EXPIRED" as const };
    coordinator.update([expired]);
    coordinator.update([expired]);
    expect(onChange).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });
});
