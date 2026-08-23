import { describe, expect, it, vi } from "vitest";
import type { ProviderFeedSnapshot, ProviderRecoveryRequest } from "./provider-feed-types.js";
import { AutomaticSourceRecovery } from "./automatic-source-recovery.js";

const CMD = "catalog-source:CMD:FOOTBALL";
const SABA = "catalog-source:SABA:FOOTBALL";
const SBOBET = "catalog-source:SBOBET:FOOTBALL";
const BTI = "catalog-source:BTI:FOOTBALL";

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

function setup() {
  const requestLobbySnapshot = vi.fn(() => 1);
  const restoreLobby = vi.fn(() => 1);
  const ensureLobby = vi.fn(() => 1);
  const refreshFabetLaunches = vi.fn(async (_signal?: AbortSignal) => undefined);
  const waitForFreshBaseline = vi.fn(async (requestedAccountId: string) =>
    snapshot(requestedAccountId, { state: "LIVE", reason: null, lastCompleteBaselineAtMs: 1_001 }));
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
  const recovery = new AutomaticSourceRecovery({
    controlPlane: { requestLobbySnapshot, ensureLobby, restoreLobby },
    feedRegistry,
    refreshFabetLaunches,
    withLatestFabetLaunch,
    baselineTimeoutMs: 50,
    onError
  });
  return { recovery, requestLobbySnapshot, restoreLobby, ensureLobby, refreshFabetLaunches,
    waitForFreshBaseline, feedRegistry, onError };
}

describe("AutomaticSourceRecovery", () => {
  it("creates a missing KSPORT source instead of ending at snapshot-undelivered", async () => {
    const context = setup();
    context.requestLobbySnapshot.mockReturnValue(0);

    const result = await context.recovery.recover(request(SBOBET));

    expect(result).toEqual({ accountId: SBOBET, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.requestLobbySnapshot).toHaveBeenCalledExactlyOnceWith("KSPORT");
    expect(context.refreshFabetLaunches).toHaveBeenCalledOnce();
    expect(context.ensureLobby).toHaveBeenCalledExactlyOnceWith("KSPORT", "https://sbobet.provider.test/fresh");
    expect(context.restoreLobby).not.toHaveBeenCalled();
  });

  it("replaces only SABA after delivered soft recovery fails to produce a newer baseline", async () => {
    const context = setup();
    context.waitForFreshBaseline
      .mockRejectedValueOnce(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"))
      .mockResolvedValueOnce(snapshot(SABA, { state: "LIVE", reason: null, lastCompleteBaselineAtMs: 1_001 }));

    const result = await context.recovery.recover(request(SABA));

    expect(result).toEqual({ accountId: SABA, stage: "HARD", outcome: "RECOVERED", reason: null });
    expect(context.ensureLobby).toHaveBeenCalledExactlyOnceWith("SABA", "https://saba.provider.test/fresh");
    expect(context.ensureLobby).not.toHaveBeenCalledWith("KSPORT", expect.any(String));
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
