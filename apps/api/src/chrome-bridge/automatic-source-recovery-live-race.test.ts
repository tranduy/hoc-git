import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { AutomaticSourceRecovery } from "./automatic-source-recovery.js";
import { ProviderFeedRegistry } from "./provider-feed-registry.js";
import type { ProviderFeedEvidence } from "./provider-feed-types.js";

const IM = "catalog-source:IM:FOOTBALL", SABA = "catalog-source:SABA:FOOTBALL";
function evidence(accountId: string, atMs: number, mode: "BASELINE" | "DELTA" = "BASELINE"): ProviderFeedEvidence {
  const provider = accountId === IM ? "IM" : "SABA";
  const catalog: ObservedProviderCatalog = { dataMode: "LIVE", accountId, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: atMs, rejectedMarketCount: 0,
    events: [], markets: [], quotes: [{ provider, category: "FOOTBALL", providerEventId: "fixture",
      providerMarketId: "total", providerSelectionId: "over", marketType: "FT_TOTAL", scope: "FULL_TIME",
      line: "2.5", selection: "OVER", rawOdds: mode === "BASELINE" ? "1.95" : "2.01", rawFormat: "DECIMAL",
      status: "OPEN", isLive: false, sourceTimestampMs: null, receivedMonotonicMs: atMs, sequence: 1 }] };
  return { kind: "CATALOG", accountId, sourceId: `chrome:${provider}:7`, sourceEpoch: "worker:1", atMs,
    generation: "same-generation", mode, provenance: provider === "IM" ? "AUTHENTICATED_HTTP" : "WS",
    providerTimestampMs: null, catalog };
}

describe("AutomaticSourceRecovery current authoritative feed checks", () => {
  const actors: AutomaticSourceRecovery[] = [], registries: ProviderFeedRegistry[] = [];
  let now = 1_000;
  beforeEach(() => { vi.useFakeTimers(); now = 1_000; });
  afterEach(async () => {
    await Promise.all(actors.splice(0).map(actor => actor.dispose()));
    for (const registry of registries.splice(0)) registry.dispose();
    vi.useRealTimers();
  });
  function setup() {
    const registry = new ProviderFeedRegistry({ now: () => now }); registries.push(registry);
    const controlPlane = { requestLobbySnapshot: vi.fn(() => 1), reloadSource: vi.fn(() => 1),
      reloadRecoverySource: vi.fn(() => 1), ensureLobby: vi.fn(() => 1), restoreLobby: vi.fn(() => 1) };
    const launchReady = vi.fn(async (): Promise<void> => undefined);
    const options = { controlPlane, feedRegistry: registry, now: () => now,
      baselineTimeoutMs: 20, reloadBaselineTimeoutMs: 20, browserRefreshEnabled: true,
      refreshFabetLaunches: vi.fn(async (): Promise<void> => undefined),
      withLatestFabetLaunch: async <T>(_provider: unknown, _category: "FOOTBALL", consume: (url: string) => Promise<T>): Promise<T> => {
        await launchReady(); return consume("https://provider.test/launch");
      } };
    const actor = new AutomaticSourceRecovery(options); actors.push(actor);
    return { registry, controlPlane, options, actor, launchReady };
  }

  it.each(["SOFT", "HARD"] as const)("does not start a queued %s action when the exact feed is already readable", async stage => {
    const { registry, controlPlane, actor } = setup(); registry.accept(evidence(IM, now));
    const pending = actor.recover({ accountId: IM, stage, attempt: 1, requestedAtMs: now });
    expect(controlPlane.requestLobbySnapshot).not.toHaveBeenCalled();
    expect(controlPlane.reloadSource).not.toHaveBeenCalled();
    await expect(pending).resolves.toMatchObject({ outcome: "RECOVERED", reason: null });
  });

  it("stops escalation when a real same-generation delta recovers the feed during the pending baseline wait", async () => {
    const { registry, controlPlane, actor } = setup(); registry.accept(evidence(IM, now));
    now = 31_001;
    const request = registry.sweep(new Set([IM]))[0]!;
    expect(request.stage).toBe("SOFT");
    const wait = vi.spyOn(registry, "waitForFreshBaseline");
    const pending = actor.recover(request);
    expect(wait).toHaveBeenCalledOnce();
    now += 1;
    expect(registry.accept(evidence(IM, now, "DELTA")).publish?.snapshotState).toBe("FRESH");
    expect(registry.read(IM).quotes[0]!.rawOdds).toBe("2.01");
    expect(registry.snapshot(IM).lastCompleteBaselineAtMs).toBe(1_000);
    await vi.advanceTimersByTimeAsync(20);
    expect(controlPlane.reloadSource).not.toHaveBeenCalled();
    expect(controlPlane.restoreLobby).not.toHaveBeenCalled();
    await expect(pending).resolves.toMatchObject({ outcome: "RECOVERED", reason: null });
    // Current readability is not relabelled as a newer complete baseline.
    await expect(wait.mock.results[0]!.value).rejects.toThrow("BASELINE_TIMEOUT");
  });

  it("does not trust a stale cached LIVE snapshot when a real registry read has expired", () => {
    const { registry, controlPlane, actor } = setup(); registry.accept(evidence(IM, now));
    now = 31_001;
    expect(registry.snapshot(IM).state).toBe("LIVE");
    void actor.recover({ accountId: IM, stage: "HARD", attempt: 2, requestedAtMs: now });
    expect(controlPlane.reloadSource).toHaveBeenCalledExactlyOnceWith("chrome:IM:7");
    expect(() => registry.read(IM)).toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it.each(["launch refresh", "token discovery"] as const)("stops delivery when the feed recovers during %s", async boundary => {
    const { registry, controlPlane, options, launchReady } = setup();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    if (boundary === "launch refresh") options.refreshFabetLaunches.mockImplementation(() => blocked);
    else launchReady.mockImplementation(() => blocked);
    const actor = new AutomaticSourceRecovery({ ...options, controlPlane: {
      requestLobbySnapshot: controlPlane.requestLobbySnapshot, ensureLobby: controlPlane.ensureLobby,
      restoreLobby: controlPlane.restoreLobby } }); actors.push(actor);
    const pending = actor.recover({ accountId: SABA, stage: "HARD", attempt: 2, requestedAtMs: now });
    await vi.advanceTimersByTimeAsync(0);
    if (boundary === "token discovery") expect(launchReady).toHaveBeenCalledOnce();
    now += 1; registry.accept(evidence(SABA, now)); release();
    await vi.advanceTimersByTimeAsync(0);
    expect(controlPlane.ensureLobby).not.toHaveBeenCalled();
    expect(controlPlane.restoreLobby).not.toHaveBeenCalled();
    await expect(pending).resolves.toMatchObject({ outcome: "RECOVERED", reason: null });
  });
});
