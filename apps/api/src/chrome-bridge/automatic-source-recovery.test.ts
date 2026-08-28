import { describe, expect, it, vi } from "vitest";
import type { ProviderFeedSnapshot, ProviderRecoveryRequest } from "./provider-feed-types.js";
import { AutomaticSourceRecovery } from "./automatic-source-recovery.js";

const CMD = "catalog-source:CMD:FOOTBALL";
const SABA = "catalog-source:SABA:FOOTBALL";
const SBOBET = "catalog-source:SBOBET:FOOTBALL";
const APSPORT = "catalog-source:APSPORT:FOOTBALL";
const BTI = "catalog-source:BTI:FOOTBALL";
const IM = "catalog-source:IM:FOOTBALL";

function snapshot(accountId: string, overrides: Partial<ProviderFeedSnapshot> = {}): ProviderFeedSnapshot {
  return {
    accountId, state: "SOFT_RECOVERY", reason: "RECOVERY_SOFT", sourceId: null, sourceEpoch: null,
    tabReachableAtMs: null, providerTransportAtMs: null, lastAuthoritativeEvidenceAtMs: null,
    lastCompleteBaselineAtMs: null, lastDeltaAtMs: null, lastSemanticChangeAtMs: null,
    activeGeneration: null, recoveryStage: "SOFT", recoveryAttempt: 1, ...overrides
  };
}

function request(accountId: string, stage: "SOFT" | "HARD" = "SOFT"): ProviderRecoveryRequest {
  return { accountId, stage, attempt: stage === "SOFT" ? 1 : 2, requestedAtMs: 1_000 };
}

function setup(now: () => number = () => 2_000, browserRefreshEnabled = true) {
  const requestLobbySnapshot = vi.fn(() => 1);
  const reloadSource = vi.fn(() => 1);
  const reloadRecoverySource = vi.fn(() => 1);
  const restoreLobby = vi.fn(() => 1);
  const ensureLobby = vi.fn(() => 1);
  const refreshFabetLaunches = vi.fn(async (_signal?: AbortSignal) => undefined);
  const waitForFreshBaseline = vi.fn(async (requestedAccountId: string) =>
    snapshot(requestedAccountId, { state: "LIVE", reason: null, lastCompleteBaselineAtMs: 2_001 }));
  const feedRegistry = {
    snapshot: vi.fn((requestedAccountId: string) => snapshot(requestedAccountId)),
    subscribe: vi.fn(() => () => undefined),
    waitForFreshBaseline
  };
  const withLatestFabetLaunch = async <T>(provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
    _category: "FOOTBALL", consume: (url: string) => Promise<T>, _minAcquiredAtMs: number,
    _signal?: AbortSignal): Promise<T> =>
    consume(`https://${provider.toLowerCase()}.provider.test/fresh`);
  const onError = vi.fn();
  const onStateChange = vi.fn();
  const recovery = new AutomaticSourceRecovery({
    controlPlane: { requestLobbySnapshot, reloadSource, reloadRecoverySource, ensureLobby, restoreLobby },
    feedRegistry,
    refreshFabetLaunches,
    browserRefreshEnabled,
    withLatestFabetLaunch,
    baselineTimeoutMs: 50,
    reloadBaselineTimeoutMs: 50,
    now,
    onError,
    onStateChange
  });
  return { recovery, requestLobbySnapshot, reloadSource, reloadRecoverySource,
    restoreLobby, ensureLobby, refreshFabetLaunches,
    waitForFreshBaseline, feedRegistry, onError, onStateChange };
}

describe("AutomaticSourceRecovery", () => {
  it("backs one repeated failure off to at most nine log state changes in five minutes", async () => {
    let nowMs = 0;
    const context = setup(() => nowMs);
    context.waitForFreshBaseline.mockRejectedValue(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"));

    for (nowMs = 0; nowMs <= 300_000; nowMs += 1_000) {
      await context.recovery.recover(request(CMD, "HARD"));
    }

    expect(context.restoreLobby).toHaveBeenCalledTimes(9);
    expect(context.onStateChange).toHaveBeenCalledTimes(9);
    expect(context.onStateChange.mock.calls.map(([status]) => status.nextAttemptInMs))
      .toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000]);
    expect(context.onStateChange.mock.calls.every(([status]) =>
      status.lastFailureCode === "BASELINE_TIMEOUT")).toBe(true);

    nowMs = 511_000;
    await context.recovery.recover(request(CMD, "HARD"));
    expect(context.onStateChange).toHaveBeenCalledTimes(10);
    expect(context.onStateChange.mock.calls.at(-1)?.[0].nextAttemptInMs).toBe(300_000);
  });

  it("resets exponential backoff after a confirmed recovery", async () => {
    let nowMs = 0;
    const context = setup(() => nowMs);
    context.waitForFreshBaseline.mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"));
    await context.recovery.recover(request(CMD, "HARD"));

    nowMs = 1_000;
    context.waitForFreshBaseline.mockResolvedValueOnce(snapshot(CMD, {
      state: "LIVE", reason: null, lastCompleteBaselineAtMs: 1_001
    }));
    await expect(context.recovery.recover(request(CMD, "HARD"))).resolves.toMatchObject({
      outcome: "RECOVERED", reason: null
    });

    context.waitForFreshBaseline.mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"));
    await context.recovery.recover(request(CMD, "HARD"));
    expect(context.onStateChange.mock.calls.map(([status]) => ({
      state: status.state, consecutiveFailures: status.consecutiveFailures,
      nextAttemptInMs: status.nextAttemptInMs
    }))).toEqual([
      { state: "BACKOFF", consecutiveFailures: 1, nextAttemptInMs: 1_000 },
      { state: "RECOVERED", consecutiveFailures: 0, nextAttemptInMs: 0 },
      { state: "BACKOFF", consecutiveFailures: 1, nextAttemptInMs: 1_000 }
    ]);
  });

  it("creates a missing KSPORT source instead of ending at snapshot-undelivered", async () => {
    const context = setup();
    context.requestLobbySnapshot.mockReturnValue(0);

    const result = await context.recovery.recover(request(SBOBET));

    expect(result).toEqual({ accountId: SBOBET, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.requestLobbySnapshot).toHaveBeenCalledTimes(2);
    expect(context.requestLobbySnapshot).toHaveBeenNthCalledWith(1, "KSPORT");
    expect(context.requestLobbySnapshot).toHaveBeenNthCalledWith(2, "KSPORT");
    expect(context.refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(context.ensureLobby).toHaveBeenCalledExactlyOnceWith("KSPORT", "https://sbobet.provider.test/fresh");
    expect(context.restoreLobby).not.toHaveBeenCalled();
  });

  it("waits for an attaching KSPORT baseline before refreshing its launch portal", async () => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(SBOBET));
    context.waitForFreshBaseline.mockResolvedValue(snapshot(SBOBET, {
      state: "LIVE", reason: null, sourceId: "chrome:KSPORT:9", sourceEpoch: "observer-a:0",
      activeGeneration: "generation-1", lastCompleteBaselineAtMs: 2_001
    }));

    await expect(context.recovery.recover(request(SBOBET, "HARD"))).resolves.toEqual({
      accountId: SBOBET, stage: "HARD", outcome: "RECOVERED", reason: null
    });
    expect(context.requestLobbySnapshot).toHaveBeenCalledExactlyOnceWith("KSPORT");
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
    expect(context.ensureLobby).not.toHaveBeenCalled();
  });

  it("does not launch a private browser during automatic recovery when browser refresh is disabled", async () => {
    const context = setup(() => 2_000, false);
    context.requestLobbySnapshot.mockReturnValue(0);

    const result = await context.recovery.recover(request(SBOBET));

    expect(result).toEqual({ accountId: SBOBET, stage: "HARD", outcome: "ACTION_REQUIRED",
      reason: "BROWSER_REFRESH_DISABLED" });
    expect(context.reloadRecoverySource).not.toHaveBeenCalled();
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
    expect(context.ensureLobby).not.toHaveBeenCalled();
  });

  it.each([
    [SABA, "SABA"],
    [APSPORT, "TSPORT"]
  ] as const)("reloads a candidate-only %s authority before requesting a fresh launch",
    async (accountId, lobby) => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(accountId));
    context.waitForFreshBaseline.mockResolvedValueOnce(snapshot(accountId, {
      state: "LIVE", reason: null, sourceId: `chrome:${lobby}:7`, sourceEpoch: "observer-b:0",
      activeGeneration: "generation-1", lastCompleteBaselineAtMs: 2_001
    }));

    const result = await context.recovery.recover(request(accountId, "HARD"));

    expect(result).toEqual({ accountId, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadSource).not.toHaveBeenCalled();
    expect(context.reloadRecoverySource).toHaveBeenCalledExactlyOnceWith(accountId, lobby);
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
    expect(context.ensureLobby).not.toHaveBeenCalled();
    expect(context.waitForFreshBaseline).toHaveBeenCalledExactlyOnceWith(
      accountId, 2_000, 50, expect.any(AbortSignal)
    );
  });

  it("uses the current candidate when a retained SABA source identity is stale", async () => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(SABA, { sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.reloadSource.mockReturnValueOnce(0);
    context.waitForFreshBaseline.mockResolvedValueOnce(snapshot(SABA, {
      state: "LIVE", reason: null, sourceId: "chrome:SABA:2", sourceEpoch: "observer-b:0",
      activeGeneration: "generation-2", lastCompleteBaselineAtMs: 2_001
    }));

    const result = await context.recovery.recover(request(SABA, "HARD"));

    expect(result).toEqual({ accountId: SABA, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadSource).toHaveBeenCalledExactlyOnceWith("chrome:SABA:1");
    expect(context.reloadRecoverySource).toHaveBeenCalledExactlyOnceWith(SABA, "SABA");
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
  });

  it.each([
    [SABA, "chrome:TSPORT:9", "SABA"],
    [APSPORT, "chrome:SABA:7", "TSPORT"]
  ] as const)("never reloads a cross-account retained source while recovering %s",
    async (accountId, retainedSourceId, lobby) => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(accountId, { sourceId: retainedSourceId,
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.waitForFreshBaseline.mockResolvedValueOnce(snapshot(accountId, {
      state: "LIVE", reason: null, sourceId: `chrome:${lobby}:11`, sourceEpoch: "observer-b:0",
      activeGeneration: "generation-2", lastCompleteBaselineAtMs: 2_001
    }));

    const result = await context.recovery.recover(request(accountId, "HARD"));

    expect(result).toEqual({ accountId, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadSource).not.toHaveBeenCalled();
    expect(context.reloadRecoverySource).toHaveBeenCalledExactlyOnceWith(accountId, lobby);
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
  });

  it.each([SABA, APSPORT] as const)(
    "still rebuilds the %s tab when browser refresh is disabled", async (accountId) => {
    // The live stack runs with SESSION_MAINTENANCE_ENABLED=0, so the Fabet
    // relaunch path is closed. Reloading the existing source is the only
    // recovery a WebSocket provider has, and it must not be skipped.
    const context = setup(() => 2_000, false);
    context.feedRegistry.snapshot.mockReturnValue(snapshot(accountId));
    context.waitForFreshBaseline.mockResolvedValueOnce(snapshot(accountId, {
      state: "LIVE", reason: null, sourceId: "chrome:REPLACEMENT:7", sourceEpoch: "observer-b:0",
      activeGeneration: "generation-1", lastCompleteBaselineAtMs: 2_001
    }));

    const result = await context.recovery.recover(request(accountId, "HARD"));

    expect(result).toEqual({ accountId, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadRecoverySource).toHaveBeenCalledTimes(1);
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
  });

  it("accepts a replacement source id even when its epoch and provider generation collide", async () => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(SABA, { sourceId: "chrome:SABA:7",
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.waitForFreshBaseline.mockResolvedValue(snapshot(SABA, {
      state: "LIVE", reason: null, sourceId: "chrome:SABA:8", sourceEpoch: "observer-a:0",
      activeGeneration: "generation-1", lastCompleteBaselineAtMs: 2_001
    }));

    const result = await context.recovery.recover(request(SABA, "HARD"));

    expect(result).toEqual({ accountId: SABA, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadSource).toHaveBeenCalledExactlyOnceWith("chrome:SABA:7");
    expect(context.waitForFreshBaseline).toHaveBeenCalledOnce();
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
  });

  it("falls back to a fresh launch when a candidate-only reload times out", async () => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(APSPORT));
    context.waitForFreshBaseline
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockResolvedValueOnce(snapshot(APSPORT, { state: "LIVE", reason: null,
        lastCompleteBaselineAtMs: 2_001 }));

    const result = await context.recovery.recover(request(APSPORT, "HARD"));

    expect(result).toEqual({ accountId: APSPORT, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadRecoverySource).toHaveBeenCalledExactlyOnceWith(APSPORT, "TSPORT");
    expect(context.refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(context.ensureLobby).toHaveBeenCalledExactlyOnceWith(
      "TSPORT", "https://apsport.provider.test/fresh"
    );
    expect(context.waitForFreshBaseline).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["returns zero", (): number => 0],
    ["throws", (): number => { throw new Error("SOCKET_SEND_FAILED"); }]
  ] as const)("falls back to a fresh launch when candidate-only reload %s", async (_condition, reload) => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(SABA));
    context.reloadRecoverySource.mockImplementationOnce(reload);
    context.waitForFreshBaseline.mockResolvedValueOnce(snapshot(SABA, {
      state: "LIVE", reason: null, lastCompleteBaselineAtMs: 2_001
    }));

    const result = await context.recovery.recover(request(SABA, "HARD"));

    expect(result).toEqual({ accountId: SABA, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadRecoverySource).toHaveBeenCalledExactlyOnceWith(SABA, "SABA");
    expect(context.refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(context.ensureLobby).toHaveBeenCalledExactlyOnceWith("SABA", "https://saba.provider.test/fresh");
    expect(context.waitForFreshBaseline).toHaveBeenCalledOnce();
  });

  it("rejects an old-source baseline that arrives during launch lookup before delivery", async () => {
    const now = vi.fn()
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_050)
      .mockReturnValueOnce(2_100)
      .mockReturnValue(2_100);
    const context = setup(now);
    context.feedRegistry.snapshot.mockReturnValue(snapshot(SABA));
    context.reloadRecoverySource.mockReturnValueOnce(0);
    context.waitForFreshBaseline.mockResolvedValueOnce(snapshot(SABA, {
      state: "LIVE", reason: null, sourceId: "chrome:SABA:7", sourceEpoch: "observer-a:0",
      activeGeneration: "generation-1", lastCompleteBaselineAtMs: 2_075
    }));

    const result = await context.recovery.recover(request(SABA, "HARD"));

    expect(result).toEqual({ accountId: SABA, stage: "HARD", outcome: "DELIVERED",
      reason: "BASELINE_TIMEOUT" });
    expect(context.refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(context.ensureLobby).toHaveBeenCalledExactlyOnceWith("SABA", "https://saba.provider.test/fresh");
    expect(context.waitForFreshBaseline).toHaveBeenCalledExactlyOnceWith(
      SABA, 2_100, 50, expect.any(AbortSignal)
    );
  });

  it("reloads the exact current SABA source and confirms a post-action generation", async () => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(SABA, { sourceId: "chrome:SABA:7",
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.waitForFreshBaseline
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockResolvedValueOnce(snapshot(SABA, { state: "LIVE", reason: null, sourceId: "chrome:SABA:7",
        sourceEpoch: "observer-a:0", activeGeneration: "generation-2", lastCompleteBaselineAtMs: 2_001 }));

    const result = await context.recovery.recover(request(SABA));

    expect(result).toEqual({ accountId: SABA, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadSource).toHaveBeenCalledExactlyOnceWith("chrome:SABA:7");
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
    expect(context.ensureLobby).not.toHaveBeenCalled();
    expect(context.waitForFreshBaseline).toHaveBeenCalledTimes(2);
    expect(context.waitForFreshBaseline).toHaveBeenNthCalledWith(
      2, SABA, 2_000, 50, expect.any(AbortSignal)
    );
  });

  it("keeps waiting when a delayed old-generation baseline arrives before the reloaded epoch", async () => {
    const now = vi.fn()
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_020)
      .mockReturnValue(2_020);
    const context = setup(now);
    context.feedRegistry.snapshot.mockReturnValue(snapshot(SABA, { sourceId: "chrome:SABA:7",
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.waitForFreshBaseline
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockResolvedValueOnce(snapshot(SABA, { state: "LIVE", reason: null, sourceId: "chrome:SABA:7",
        sourceEpoch: "observer-a:0", activeGeneration: "generation-1", lastCompleteBaselineAtMs: 2_001 }))
      .mockResolvedValueOnce(snapshot(SABA, { state: "LIVE", reason: null, sourceId: "chrome:SABA:7",
        sourceEpoch: "observer-b:0", activeGeneration: "generation-1", lastCompleteBaselineAtMs: 2_002 }));

    const result = await context.recovery.recover(request(SABA));

    expect(result).toEqual({ accountId: SABA, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
    expect(context.ensureLobby).not.toHaveBeenCalled();
    expect(context.waitForFreshBaseline).toHaveBeenCalledTimes(3);
    expect(context.waitForFreshBaseline).toHaveBeenNthCalledWith(
      2, SABA, 2_000, 50, expect.any(AbortSignal)
    );
    expect(context.waitForFreshBaseline).toHaveBeenNthCalledWith(
      3, SABA, 2_001, 30, expect.any(AbortSignal)
    );
  });

  it("falls back to a fresh SABA launch when the targeted reload also times out", async () => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(SABA, { sourceId: "chrome:SABA:7",
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.waitForFreshBaseline
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockResolvedValueOnce(snapshot(SABA, { state: "LIVE", reason: null, lastCompleteBaselineAtMs: 2_001 }));

    const result = await context.recovery.recover(request(SABA));

    expect(result).toEqual({ accountId: SABA, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadSource).toHaveBeenCalledExactlyOnceWith("chrome:SABA:7");
    expect(context.refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(context.ensureLobby).toHaveBeenCalledExactlyOnceWith("SABA", "https://saba.provider.test/fresh");
    expect(context.waitForFreshBaseline).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["returns zero", (): number => 0],
    ["throws", (): number => { throw new Error("SOCKET_SEND_FAILED"); }]
  ] as const)("falls back to a fresh SABA launch when targeted reload %s before delivery",
    async (_condition, reload) => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(SABA, { sourceId: "chrome:SABA:7",
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.reloadSource.mockImplementationOnce(reload);
    context.reloadRecoverySource.mockReturnValueOnce(0);
    context.waitForFreshBaseline
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockResolvedValueOnce(snapshot(SABA, { state: "LIVE", reason: null, lastCompleteBaselineAtMs: 2_001 }));

    const result = await context.recovery.recover(request(SABA));

    expect(result).toEqual({ accountId: SABA, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadRecoverySource).toHaveBeenCalledExactlyOnceWith(SABA, "SABA");
    expect(context.refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(context.ensureLobby).toHaveBeenCalledExactlyOnceWith("SABA", "https://saba.provider.test/fresh");
    expect(context.waitForFreshBaseline).toHaveBeenCalledTimes(2);
  });

  it("reloads the exact current TSPORT source before launching a replacement", async () => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(APSPORT, { sourceId: "chrome:TSPORT:9",
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.waitForFreshBaseline
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockResolvedValueOnce(snapshot(APSPORT, { state: "LIVE", reason: null,
        sourceId: "chrome:TSPORT:9", sourceEpoch: "observer-a:0", activeGeneration: "generation-2",
        lastCompleteBaselineAtMs: 2_001 }));

    const result = await context.recovery.recover(request(APSPORT));

    expect(result).toEqual({ accountId: APSPORT, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadSource).toHaveBeenCalledExactlyOnceWith("chrome:TSPORT:9");
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
    expect(context.ensureLobby).not.toHaveBeenCalled();
    expect(context.waitForFreshBaseline).toHaveBeenCalledTimes(2);
    expect(context.waitForFreshBaseline).toHaveBeenNthCalledWith(
      2, APSPORT, 2_000, 50, expect.any(AbortSignal)
    );
  });

  it("gives a reloaded tab far longer to answer than an in-page lobby snapshot", async () => {
    // A snapshot is answered inside the page in seconds; a reload restarts the
    // page, its session and its whole catalog sweep. Sharing one deadline
    // declared every reload a failure, and the next hard stage reloaded the tab
    // again before the sweep could finish - the five-event APSPORT catalog.
    const waitForFreshBaseline = vi.fn(async (accountId: string) =>
      snapshot(accountId, { state: "LIVE", reason: null, sourceId: "chrome:TSPORT:9",
        sourceEpoch: "observer-a:0", activeGeneration: "generation-2",
        lastCompleteBaselineAtMs: 2_001 }));
    const recovery = new AutomaticSourceRecovery({
      controlPlane: { requestLobbySnapshot: vi.fn(() => 1), reloadSource: vi.fn(() => 1),
        reloadRecoverySource: vi.fn(() => 1), ensureLobby: vi.fn(() => 1), restoreLobby: vi.fn(() => 1) },
      feedRegistry: {
        snapshot: vi.fn(() => snapshot(APSPORT, { sourceId: "chrome:TSPORT:9",
          sourceEpoch: "observer-a:0", activeGeneration: "generation-1" })),
        subscribe: vi.fn(() => () => undefined),
        waitForFreshBaseline
      },
      refreshFabetLaunches: vi.fn(async () => undefined),
      withLatestFabetLaunch: async (_provider, _category, consume) => consume("https://x.test/fresh"),
      baselineTimeoutMs: 10_000,
      reloadBaselineTimeoutMs: 90_000,
      now: () => 2_000
    });

    const result = await recovery.recover(request(APSPORT, "HARD"));

    expect(result).toEqual({ accountId: APSPORT, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(waitForFreshBaseline).toHaveBeenCalledExactlyOnceWith(
      APSPORT, 2_000, 90_000, expect.any(AbortSignal)
    );
  });

  it("refuses a reload deadline that is not a positive duration", () => {
    expect(() => new AutomaticSourceRecovery({
      controlPlane: { requestLobbySnapshot: vi.fn(() => 1), ensureLobby: vi.fn(() => 1),
        restoreLobby: vi.fn(() => 1) },
      feedRegistry: { snapshot: vi.fn(() => snapshot(APSPORT)), subscribe: vi.fn(() => () => undefined),
        waitForFreshBaseline: vi.fn(async () => snapshot(APSPORT)) },
      refreshFabetLaunches: vi.fn(async () => undefined),
      withLatestFabetLaunch: async (_provider, _category, consume) => consume("https://x.test/fresh"),
      reloadBaselineTimeoutMs: 0
    })).toThrow("RECOVERY_OPTIONS_INVALID");
  });

  it("will not reload one provider tab twice inside the settling window", async () => {
    // A reload destroys the page and every socket it owns. The backoff does not
    // protect it - one successful beat clears the counter - so APSPORT was
    // reloaded out of every burst it managed to start: 21 socket opens and 48
    // bursts of one to eight minutes across two days, never settling.
    let clock = 1_000_000;
    const context = setup(() => clock);
    context.feedRegistry.snapshot.mockReturnValue(snapshot(APSPORT, { sourceId: "chrome:TSPORT:9",
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.waitForFreshBaseline.mockRejectedValue(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"));

    await context.recovery.recover(request(APSPORT, "HARD"));
    expect(context.reloadSource).toHaveBeenCalledTimes(1);

    clock += 60_000;
    await context.recovery.recover(request(APSPORT, "HARD"));
    expect(context.reloadSource).toHaveBeenCalledTimes(1);

    clock += 300_000;
    await context.recovery.recover(request(APSPORT, "HARD"));
    expect(context.reloadSource).toHaveBeenCalledTimes(2);
  });

  it("keeps a reachable SBOBET tab on same-tab recovery when its baseline is late", async () => {
    // A current KSPORT heartbeat means Chrome and the authenticated page are
    // alive. Replacing that tab here destroys the SockJS/STOMP subscriptions
    // before the live + today pair can finish and creates an endless reload
    // loop. The extension's snapshot path already owns the safe in-page
    // football selection, paired HTTP fallback, and socket recovery.
    const clock = 1_000_000;
    const context = setup(() => clock);
    context.feedRegistry.snapshot.mockReturnValue(snapshot(SBOBET, {
      state: "HARD_RECOVERY", recoveryStage: "HARD", sourceId: "chrome:KSPORT:9",
      sourceEpoch: "observer-a:0", tabReachableAtMs: clock - 5_000
    }));
    context.waitForFreshBaseline.mockRejectedValue(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"));

    await expect(context.recovery.recover(request(SBOBET, "HARD"))).resolves.toEqual({
      accountId: SBOBET, stage: "HARD", outcome: "DELIVERED", reason: "BASELINE_TIMEOUT"
    });
    expect(context.requestLobbySnapshot).toHaveBeenCalledExactlyOnceWith("KSPORT");
    expect(context.reloadSource).not.toHaveBeenCalled();
    expect(context.reloadRecoverySource).not.toHaveBeenCalled();
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
    expect(context.ensureLobby).not.toHaveBeenCalled();
  });

  it("rechecks SBOBET reachability immediately before a delayed hard relaunch", async () => {
    const clock = 1_000_000;
    const context = setup(() => clock);
    context.feedRegistry.snapshot
      .mockReturnValueOnce(snapshot(SBOBET))
      .mockReturnValueOnce(snapshot(SBOBET, {
        state: "HARD_RECOVERY", recoveryStage: "HARD", sourceId: "chrome:KSPORT:9",
        sourceEpoch: "observer-a:0", tabReachableAtMs: clock - 1_000
      }));
    context.requestLobbySnapshot.mockReturnValueOnce(0).mockReturnValueOnce(1);
    context.waitForFreshBaseline.mockResolvedValue(snapshot(SBOBET, {
      state: "LIVE", reason: null, sourceId: "chrome:KSPORT:9", sourceEpoch: "observer-a:0",
      activeGeneration: "generation-1", lastCompleteBaselineAtMs: clock + 1
    }));

    await expect(context.recovery.recover(request(SBOBET, "HARD"))).resolves.toEqual({
      accountId: SBOBET, stage: "HARD", outcome: "RECOVERED", reason: null
    });
    expect(context.feedRegistry.snapshot).toHaveBeenCalledTimes(2);
    expect(context.requestLobbySnapshot).toHaveBeenCalledTimes(2);
    expect(context.requestLobbySnapshot).toHaveBeenNthCalledWith(1, "KSPORT");
    expect(context.requestLobbySnapshot).toHaveBeenNthCalledWith(2, "KSPORT");
    expect(context.ensureLobby).not.toHaveBeenCalled();
  });

  it("falls back to a fresh TSPORT launch when the targeted reload baseline times out", async () => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(APSPORT, { sourceId: "chrome:TSPORT:9",
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.waitForFreshBaseline
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockResolvedValueOnce(snapshot(APSPORT, { state: "LIVE", reason: null,
        lastCompleteBaselineAtMs: 2_001 }));

    const result = await context.recovery.recover(request(APSPORT));

    expect(result).toEqual({ accountId: APSPORT, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadSource).toHaveBeenCalledExactlyOnceWith("chrome:TSPORT:9");
    expect(context.refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(context.ensureLobby).toHaveBeenCalledExactlyOnceWith(
      "TSPORT", "https://apsport.provider.test/fresh"
    );
    expect(context.waitForFreshBaseline).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["returns zero", (): number => 0],
    ["throws", (): number => { throw new Error("SOCKET_SEND_FAILED"); }]
  ] as const)("falls back to a fresh TSPORT launch when targeted reload %s before delivery",
    async (_condition, reload) => {
    const context = setup();
    context.feedRegistry.snapshot.mockReturnValue(snapshot(APSPORT, { sourceId: "chrome:TSPORT:9",
      sourceEpoch: "observer-a:0", activeGeneration: "generation-1" }));
    context.reloadSource.mockImplementationOnce(reload);
    context.reloadRecoverySource.mockReturnValueOnce(0);
    context.waitForFreshBaseline
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockResolvedValueOnce(snapshot(APSPORT, { state: "LIVE", reason: null,
        lastCompleteBaselineAtMs: 2_001 }));

    const result = await context.recovery.recover(request(APSPORT));

    expect(result).toEqual({ accountId: APSPORT, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.reloadSource).toHaveBeenCalledExactlyOnceWith("chrome:TSPORT:9");
    expect(context.reloadRecoverySource).toHaveBeenCalledExactlyOnceWith(APSPORT, "TSPORT");
    expect(context.refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(context.ensureLobby).toHaveBeenCalledExactlyOnceWith(
      "TSPORT", "https://apsport.provider.test/fresh"
    );
    expect(context.waitForFreshBaseline).toHaveBeenCalledTimes(2);
  });

  it("does not report soft command delivery as recovery before a newer baseline arrives", async () => {
    const context = setup();
    let release!: (value: ProviderFeedSnapshot) => void;
    context.waitForFreshBaseline.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const operation = context.recovery.recover(request(CMD));
    let settled = false;
    void operation.then(() => { settled = true; });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(context.requestLobbySnapshot).toHaveBeenCalledExactlyOnceWith("CMD");
    expect(context.restoreLobby).not.toHaveBeenCalled();

    release(snapshot(CMD, { state: "LIVE", reason: null, lastCompleteBaselineAtMs: 1_001 }));
    await expect(operation).resolves.toEqual({ accountId: CMD, stage: "SOFT", outcome: "RECOVERED", reason: null });
    expect(context.waitForFreshBaseline).toHaveBeenCalledExactlyOnceWith(CMD, 1_000, 50, expect.any(AbortSignal));
  });

  it("reports a hard command as merely delivered when no newer baseline confirms it", async () => {
    const context = setup();
    context.waitForFreshBaseline.mockRejectedValue(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"));

    await expect(context.recovery.recover(request(CMD, "HARD"))).resolves.toEqual({
      accountId: CMD, stage: "HARD", outcome: "DELIVERED", reason: "BASELINE_TIMEOUT"
    });
    expect(context.restoreLobby).toHaveBeenCalledExactlyOnceWith("CMD");
    expect(context.requestLobbySnapshot).not.toHaveBeenCalled();
  });

  it("rejects an authoritative baseline whose timestamp only equals the recovery request", async () => {
    const context = setup();
    context.waitForFreshBaseline.mockResolvedValue(
      snapshot(CMD, { state: "LIVE", reason: null, lastCompleteBaselineAtMs: 1_000 })
    );

    await expect(context.recovery.recover(request(CMD, "HARD"))).resolves.toEqual({
      accountId: CMD, stage: "HARD", outcome: "DELIVERED", reason: "BASELINE_TIMEOUT"
    });
  });

  it("preserves an actionable launch failure reason without touching another provider", async () => {
    const context = setup();
    context.refreshFabetLaunches.mockRejectedValue(new Error("AUTH_EGRESS_UNAVAILABLE"));

    await expect(context.recovery.recover(request(SABA, "HARD"))).resolves.toEqual({
      accountId: SABA, stage: "HARD", outcome: "ACTION_REQUIRED", reason: "AUTH_EGRESS_UNAVAILABLE"
    });
    expect(context.ensureLobby).not.toHaveBeenCalled();
    expect(context.restoreLobby).not.toHaveBeenCalled();
  });

  it("suppresses automatic recovery while explicit maintenance owns the source", async () => {
    const context = setup();
    const recovery = new AutomaticSourceRecovery({
      controlPlane: { requestLobbySnapshot: context.requestLobbySnapshot,
        ensureLobby: context.ensureLobby, restoreLobby: context.restoreLobby },
      feedRegistry: context.feedRegistry,
      refreshFabetLaunches: context.refreshFabetLaunches,
      withLatestFabetLaunch: async (_provider, _category, consume) => consume("https://unused.test"),
      isRecoverySuppressed: () => true
    });

    await expect(recovery.recover(request(SABA))).resolves.toEqual({
      accountId: SABA, stage: "SOFT", outcome: "ACTION_REQUIRED", reason: "RECOVERY_SUPPRESSED"
    });
    expect(context.requestLobbySnapshot).not.toHaveBeenCalled();
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
  });

  it("does not start HARD recovery when suppression appears during the SOFT baseline wait", async () => {
    const context = setup();
    let suppressed = false;
    context.waitForFreshBaseline.mockImplementationOnce(async () => {
      suppressed = true;
      throw new Error("PROVIDER_FEED_BASELINE_TIMEOUT");
    });
    const recovery = new AutomaticSourceRecovery({
      controlPlane: { requestLobbySnapshot: context.requestLobbySnapshot,
        ensureLobby: context.ensureLobby, restoreLobby: context.restoreLobby },
      feedRegistry: context.feedRegistry,
      refreshFabetLaunches: context.refreshFabetLaunches,
      withLatestFabetLaunch: async (_provider, _category, consume) => consume("https://unused.test"),
      isRecoverySuppressed: () => suppressed
    });

    await expect(recovery.recover(request(SABA))).resolves.toEqual({
      accountId: SABA, stage: "SOFT", outcome: "ACTION_REQUIRED", reason: "RECOVERY_SUPPRESSED"
    });
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
    expect(context.ensureLobby).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown catalog identity without touching any source", async () => {
    const context = setup();
    const accountId = "catalog-source:UNKNOWN:FOOTBALL";

    await expect(context.recovery.recover(request(accountId))).resolves.toEqual({
      accountId, stage: "SOFT", outcome: "NO_SOURCE", reason: "SOURCE_MISSING"
    });
    expect(context.requestLobbySnapshot).not.toHaveBeenCalled();
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
    expect(context.ensureLobby).not.toHaveBeenCalled();
    expect(context.restoreLobby).not.toHaveBeenCalled();
  });

  it("keeps one recovery flight per provider", async () => {
    const context = setup();
    let release!: (value: ProviderFeedSnapshot) => void;
    context.waitForFreshBaseline.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const recoveryRequest = request(SABA);

    const first = context.recovery.recover(recoveryRequest);
    const second = context.recovery.recover({ ...recoveryRequest });

    expect(second).toBe(first);
    expect(context.requestLobbySnapshot).toHaveBeenCalledOnce();
    release(snapshot(SABA, { state: "LIVE", reason: null, lastCompleteBaselineAtMs: 1_001 }));
    await Promise.all([first, second]);
    expect(context.waitForFreshBaseline).toHaveBeenCalledOnce();
  });

  it("allows independent providers to recover concurrently", async () => {
    const context = setup();
    const waits = new Map([
      [SABA, deferredBaseline()],
      [BTI, deferredBaseline()]
    ]);
    context.waitForFreshBaseline.mockImplementation((accountId: string) => {
      const waiting = waits.get(accountId);
      if (waiting === undefined) throw new Error("TEST_WAIT_MISSING");
      return waiting.promise;
    });

    const saba = context.recovery.recover(request(SABA));
    const bti = context.recovery.recover(request(BTI));

    expect(saba).not.toBe(bti);
    expect(context.requestLobbySnapshot).toHaveBeenCalledWith("SABA");
    expect(context.requestLobbySnapshot).toHaveBeenCalledWith("BTI");
    waits.get(SABA)?.resolve(snapshot(SABA, { state: "LIVE", reason: null, lastCompleteBaselineAtMs: 1_001 }));
    waits.get(BTI)?.resolve(snapshot(BTI, { state: "LIVE", reason: null, lastCompleteBaselineAtMs: 1_001 }));
    await expect(Promise.all([saba, bti])).resolves.toHaveLength(2);
  });

  it("settles a pending soft recovery on disposal without waiting for the registry", async () => {
    const context = setup();
    context.waitForFreshBaseline.mockReturnValue(new Promise(() => undefined));
    const operation = context.recovery.recover(request(SABA));

    await context.recovery.dispose();

    await expect(operation).resolves.toEqual({
      accountId: SABA, stage: "SOFT", outcome: "ACTION_REQUIRED", reason: "RECOVERY_DISPOSED"
    });
    expect(context.ensureLobby).not.toHaveBeenCalled();
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
  });

  it("aborts and drains a never-settling HARD refresh during disposal", async () => {
    const context = setup();
    let refreshSignal: AbortSignal | undefined;
    context.refreshFabetLaunches.mockImplementation((signal?: AbortSignal) => {
      refreshSignal = signal;
      return new Promise(() => undefined);
    });
    const operation = context.recovery.recover(request(SABA, "HARD"));
    await vi.waitFor(() => expect(context.refreshFabetLaunches).toHaveBeenCalledOnce());

    const disposal = context.recovery.dispose();

    expect(refreshSignal?.aborted).toBe(true);
    await expect(operation).resolves.toEqual({
      accountId: SABA, stage: "HARD", outcome: "ACTION_REQUIRED", reason: "RECOVERY_DISPOSED"
    });
    await disposal;
    expect(context.ensureLobby).not.toHaveBeenCalled();
  });

  it("prevents a pending HARD launch lookup from mutating the control plane after disposal", async () => {
    const context = setup();
    let launchSignal: AbortSignal | undefined;
    let launchCalls = 0;
    let releaseLaunch!: (url: string) => void;
    const launch = new Promise<string>((resolve) => { releaseLaunch = resolve; });
    const withLatestFabetLaunch = async <T>(_provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
      _category: "FOOTBALL", consume: (url: string) => Promise<T>, _minAcquiredAtMs: number,
      signal?: AbortSignal): Promise<T> => {
      launchCalls += 1;
      launchSignal = signal;
      return consume(await launch);
    };
    const recovery = new AutomaticSourceRecovery({
      controlPlane: { requestLobbySnapshot: context.requestLobbySnapshot,
        ensureLobby: context.ensureLobby, restoreLobby: context.restoreLobby },
      feedRegistry: context.feedRegistry,
      refreshFabetLaunches: context.refreshFabetLaunches,
      withLatestFabetLaunch
    });
    const operation = recovery.recover(request(SABA, "HARD"));
    await vi.waitFor(() => expect(launchCalls).toBe(1));

    await recovery.dispose();

    expect(launchSignal?.aborted).toBe(true);
    await expect(operation).resolves.toEqual({
      accountId: SABA, stage: "HARD", outcome: "ACTION_REQUIRED", reason: "RECOVERY_DISPOSED"
    });
    releaseLaunch("https://saba.provider.test/late");
    await vi.waitFor(() => expect(context.ensureLobby).not.toHaveBeenCalled());
  });
});

function deferredBaseline() {
  let resolve!: (snapshot: ProviderFeedSnapshot) => void;
  const promise = new Promise<ProviderFeedSnapshot>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("a hard stage that cannot relaunch must still ask for a snapshot", () => {
  it("requests a lobby snapshot before reporting that browser refresh is off", async () => {
    // IM discards the page's own traffic and only ingests an extension-driven
    // reconciliation, which a REQUEST_SNAPSHOT triggers. Its feed reached
    // HARD_RECOVERY, the hard stage saw browser refresh disabled and returned
    // without doing anything at all, and the sweep then only ever re-requested
    // the hard stage: the book stayed dead with its tab alive and 80 envelopes
    // a window arriving. Asking for a snapshot is cheap and touches no tab.
    const context = setup(() => 2_000, false);
    context.feedRegistry.snapshot.mockReturnValue(snapshot(IM));
    context.waitForFreshBaseline.mockResolvedValueOnce(snapshot(IM, {
      state: "LIVE", reason: null, sourceId: "chrome:IM:5", sourceEpoch: "observer-b:0",
      activeGeneration: "im:5:1", lastCompleteBaselineAtMs: 2_001
    }));

    const result = await context.recovery.recover(request(IM, "HARD"));

    expect(context.requestLobbySnapshot).toHaveBeenCalledWith("IM");
    expect(result).toEqual({ accountId: IM, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.refreshFabetLaunches).not.toHaveBeenCalled();
  });

  it("still reports browser refresh disabled when the snapshot changes nothing", async () => {
    const context = setup(() => 2_000, false);
    context.feedRegistry.snapshot.mockReturnValue(snapshot(IM));
    context.requestLobbySnapshot.mockReturnValue(0);

    const result = await context.recovery.recover(request(IM, "HARD"));

    expect(result).toEqual({ accountId: IM, stage: "HARD", outcome: "ACTION_REQUIRED",
      reason: "BROWSER_REFRESH_DISABLED" });
  });
});
