import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { SabaCollectorPageAdapter } from "./saba-hidden-market-collector.js";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import { runSabaNavigationProbe, SABA_NAVIGATION_PROBE_READ_EXPRESSION } from "./saba-navigation-probe.js";
import { createSabaHiddenMarketPageAdapter } from "./saba-hidden-market-page.js";
import { NetworkObserver, type ObservedSource } from "./network-observer.js";
import type { ProviderWorkScheduler } from "./provider-work-scheduler.js";

vi.mock("./saba-hidden-market-page.js", () => ({ createSabaHiddenMarketPageAdapter: vi.fn() }));
vi.mock("./saba-navigation-probe.js", async (original) => ({
  ...await original<typeof import("./saba-navigation-probe.js")>(),
  runSabaNavigationProbe: vi.fn(async () => ({ viewRestored: true, body: JSON.stringify({
    status: "COMPLETE_EVIDENCE", today: { documentToken: "bound-document" }, viewRestored: true
  }) }))
}));

const source = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;
const earlyOwnerCalls = (adapter: SabaCollectorPageAdapter) =>
  vi.mocked(adapter.captureOwner).mock.calls.filter(([period]) => period === "EARLY");
const record = (matchId: string) => ({ sportId: "1" as const, leagueId: "league",
  leagueName: "League", matchId, timeText: "09/08 08:00PM", providerTimezoneOffsetMinutes: 420, teamNames: ["Home", "Away"],
  groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
    { marketOddsId: `${matchId}-odds`, priceText: "0.91", status: "running", greyedOut: null },
    { marketOddsId: `${matchId}-odds`, priceText: "-0.93", status: "running", greyedOut: null }
  ] }] });

function harness(onSabaSocketUnavailable?: (source: ObservedSource, reason?: "UNSAFE_VIEW") => Promise<void>,
  workScheduler?: ProviderWorkScheduler,
  initialVisibleRecords: readonly unknown[] = Array.from({ length: 60 }, (_, index) => record(`visible-${index}`)),
  batching: { earlyBatchSize?: 1 | 2 | 3 | 4; earlyOwners: number } = { earlyBatchSize: 1, earlyOwners: 2 }) {
  const forwarded: ChromeBridgeEnvelope[] = [];
  let clock = 1_788_800_000_000;
  let monotonicOffset = 0;
  const monotonicClock = () => clock / 1000 + monotonicOffset;
  let selected = "TODAY";
  let restoreAllowed = true;
  let holdOwner: (() => Promise<void>) | undefined;
  let holdRestore: (() => Promise<void>) | undefined;
  let visibleRecords = initialVisibleRecords;
  let mainForwardFailure: string | null = null;
  const adapterFactory = vi.mocked(createSabaHiddenMarketPageAdapter);
  adapterFactory.mockImplementation(({ binding }) => ({
    readRoster: vi.fn<SabaCollectorPageAdapter["readRoster"]>(async (period) => {
      selected = period;
      return { binding, period, selectedPrematch: true, owners: Array.from({
        length: period === "EARLY" ? batching.earlyOwners : 2
      }, (_, index) => ({
        ownerMatchId: `${period}-${index}`, record: record(`${period}-${index}`),
        control: "ELIGIBLE_MORE", kickoffDate: { kind: "UNKNOWN" },
        capturedAtMs: clock, capturedMonotonicMs: monotonicClock()
      })) };
    }),
    captureOwner: vi.fn<SabaCollectorPageAdapter["captureOwner"]>(async (period, owner) => {
      selected = period;
      await holdOwner?.();
      return { binding, period, ownerMatchId: owner.ownerMatchId, controlOpened: true,
        terminalControlState: "RESTORED_CLOSED", restored: true,
        safeControlOutcome: "OWNER_GROUPS_EXPANDED", capture: {
          record: { ...owner.record, groups: [...owner.record.groups, {
            ...owner.record.groups[0]!, betTypeIds: [], labels: ["Hidden public label"],
            odds: owner.record.groups[0]!.odds.map((odd) => ({
              ...odd, marketOddsId: `${owner.ownerMatchId}-hidden`
            }))
          }] }, kickoffDate: owner.kickoffDate, capturedAtMs: ++clock,
          capturedMonotonicMs: monotonicClock()
        } };
    }),
    restoreToday: vi.fn<SabaCollectorPageAdapter["restoreToday"]>(async () => {
      await holdRestore?.();
      if (!restoreAllowed) throw new Error("SABA_COLLECTOR_TODAY_RESTORE_UNCONFIRMED");
      selected = "TODAY";
      return { binding, selectedPrematch: true, rosterMatchIds: ["TODAY-0", "TODAY-1"] };
    }) } satisfies SabaCollectorPageAdapter));
  const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
    if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
    if (params?.expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) return {
      result: { value: { documentToken: "bound-document", rowCount: params.contextId === 73 ? 61 : 60 } }
    };
    if (params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) return {
      result: { value: JSON.stringify(visibleRecords) }
    };
    if (String(params?.expression).includes("fieldline-saba-odds-mutation")) return { result: { value: true } };
    return {};
  });
  const observer = new NetworkObserver({ sendCommand, observerSessionId: "collector-worker",
    now: () => clock, monotonicNow: monotonicClock,
    ...(batching.earlyBatchSize === undefined ? {} : { sabaCollectorEarlyBatchSize: batching.earlyBatchSize }),
    forward: async (envelope) => {
      if (mainForwardFailure !== null && envelope.transport === "DOM_SNAPSHOT" &&
        JSON.parse(envelope.payload.body).snapshotId?.endsWith(":main")) throw new Error(mainForwardFailure);
      forwarded.push(envelope);
    },
    ...(workScheduler === undefined ? {} : { workScheduler }),
    ...(onSabaSocketUnavailable === undefined ? {} : { onSabaSocketUnavailable }) });
  const poll = async () => { clock += 3_000; await observer.pollSabaDomChanges(source, "sports.example"); };
  const start = async (publishMain = true) => {
    await poll();
    await vi.waitFor(() => expect(adapterFactory).toHaveBeenCalledOnce());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!publishMain) return;
    await poll(); // Publish the independently reconciled main roster before exercising More.
    const adapter = adapterFactory.mock.results.at(-1)!.value;
    adapter.readRoster.mockClear();
    adapter.restoreToday.mockClear();
  };
  const collectorChunks = () => forwarded.filter(({ transport, payload }) => transport === "DOM_SNAPSHOT" &&
    JSON.parse(payload.body).snapshotId?.startsWith("saba:collector:") &&
    !JSON.parse(payload.body).snapshotId.endsWith(":main"));
  const mainRosterChunks = () => forwarded.filter(({ transport, payload }) => transport === "DOM_SNAPSHOT" &&
    JSON.parse(payload.body).snapshotId?.endsWith(":main"));
  return { observer, forwarded, sendCommand, start, poll, collectorChunks, mainRosterChunks,
    failMainForward: (failure: string | null) => { mainForwardFailure = failure; },
    advanceTime: (milliseconds: number) => { clock += milliseconds; },
    advanceMonotonic: (milliseconds: number) => { monotonicOffset += milliseconds; },
    setVisibleRecords: (value: readonly unknown[]) => { visibleRecords = value; },
    selected: () => selected, setRestoreAllowed: (value: boolean) => { restoreAllowed = value; },
    hold: (value: () => Promise<void>) => { holdOwner = value; },
    holdRestore: (value: () => Promise<void>) => { holdRestore = value; } };
}

describe("NetworkObserver SABA hidden collector wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runSabaNavigationProbe).mockReset().mockResolvedValue({ viewRestored: true,
      body: JSON.stringify({ status: "COMPLETE_EVIDENCE", today: { documentToken: "bound-document" },
        viewRestored: true }) });
  });

  it("exposes safe in-memory collector admission flags without another page command", async () => {
    const h = harness();
    await h.start();
    const commands = h.sendCommand.mock.calls.length;
    await h.observer.heartbeat(source, "sports.example");
    expect(h.sendCommand.mock.calls).toHaveLength(commands);
    const heartbeat = h.forwarded.map(({ payload }) => JSON.parse(payload.body))
      .find((body) => body.kind === "WS_ATTACH");
    expect(heartbeat.sabaCollector).toEqual({ nativeReady: false, schemaContextReady: false, catalogUsable: true,
      discoveryPending: false, discoveryAttempted: true, collectorState: "RUNNING",
      domBlocked: false, probeBlocked: false, lastErrorCode: null, currentPeriod: "TODAY",
      mainRosterComplete: true, hiddenMarketsComplete: false });
  });

  it("publishes the main roster before More and retains it when hidden expansion fails", async () => {
    const h = harness();
    await h.start();
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    expect(adapter.captureOwner).not.toHaveBeenCalled();
    expect(h.mainRosterChunks()).toHaveLength(1);
    const main = JSON.parse(h.mainRosterChunks()[0]!.payload.body);
    expect(main.records.at(-1)).toMatchObject({ kind: "MAIN_ROSTER_TERMINAL", hiddenMarketsComplete: false });
    expect(main.records.filter((item: { kind: string }) => item.kind === "CAPTURE")).toHaveLength(4);
    adapter.captureOwner.mockRejectedValueOnce(new Error("SABA_COLLECTOR_MORE_OPEN_NOT_STABLE"));
    await h.poll();
    expect(h.mainRosterChunks()).toHaveLength(1);
    expect(h.collectorChunks()).toHaveLength(0);
    await h.observer.heartbeat(source, "sports.example");
    const heartbeat = h.forwarded.map(({ payload }) => JSON.parse(payload.body)).find((body) => body.kind === "WS_ATTACH");
    expect(heartbeat.sabaCollector).toMatchObject({ mainRosterComplete: true, hiddenMarketsComplete: false,
      collectorState: "FINISHED", lastErrorCode: "SABA_COLLECTOR_MORE_OPEN_NOT_STABLE" });
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it("does not start More until every main chunk is acknowledged after a rejected publication", async () => {
    const h = harness();
    await h.start(false);
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    h.failMainForward("BRIDGE_PAYLOAD_REJECTED");
    await h.poll();
    await h.poll();
    expect(adapter.captureOwner).not.toHaveBeenCalled();
    expect(h.mainRosterChunks()).toHaveLength(0);
    h.failMainForward(null);
    await h.poll();
    expect(adapter.captureOwner).not.toHaveBeenCalled();
    expect(h.mainRosterChunks()).toHaveLength(1);
    await h.poll();
    expect(adapter.captureOwner).toHaveBeenCalledOnce();
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it.each([
    ["SABA_COLLECTOR_FRAME_COMMAND_TIMEOUT", "SABA_COLLECTOR_FRAME_COMMAND_TIMEOUT"],
    ["private provider exception must not escape", "SABA_COLLECTOR_PAGE_OPERATION_FAILED"]
  ])("reports only bounded collector error codes in heartbeat: %s", async (failure, expectedCode) => {
    const h = harness();
    await h.start();
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    adapter.captureOwner.mockRejectedValueOnce(new Error(failure));
    await h.poll();
    const commands = h.sendCommand.mock.calls.length;
    await h.observer.heartbeat(source, "sports.example");
    expect(h.sendCommand.mock.calls).toHaveLength(commands);
    const heartbeat = h.forwarded.map(({ payload }) => JSON.parse(payload.body))
      .find((body) => body.kind === "WS_ATTACH");
    expect(heartbeat.sabaCollector).toMatchObject({ lastErrorCode: expectedCode, currentPeriod: "TODAY" });
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it.each([
    ["frame-command-timeout", "SABA_COLLECTOR_FRAME_COMMAND_TIMEOUT"],
    ["Cannot find context with specified id", "SABA_COLLECTOR_CONTEXT_UNAVAILABLE"],
    ["private transport message must not escape", "SABA_COLLECTOR_CDP_REJECTED"]
  ])("classifies collector command failure without leaking raw messages: %s", async (failure, code) => {
    const h = harness();
    await h.start();
    const options = vi.mocked(createSabaHiddenMarketPageAdapter).mock.calls[0]![0];
    h.sendCommand.mockRejectedValueOnce(new Error(failure));
    await expect(options.evaluate("read-only-test")).rejects.toThrow(code);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it("does not repeat Today restoration after a validated captured owner is already restored closed", async () => {
    const h = harness();
    await h.start();
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    await h.poll();
    expect(adapter.captureOwner).toHaveBeenCalledTimes(1);
    expect(adapter.restoreToday).not.toHaveBeenCalled();
    expect(h.selected()).toBe("TODAY");
    expect(h.collectorChunks()).toHaveLength(0);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it("does not run SABA refresh page or socket controls while the hidden collector is unfinished", async () => {
    const h = harness();
    const refreshControlCalls = () => h.sendCommand.mock.calls.filter(([, method, params]) => {
      if (method !== "Runtime.evaluate") return false;
      const expression = String(params?.expression ?? "");
      return expression.includes("fieldline-saba-time-baseline") ||
        expression.includes("window.io && window.io.Socket") ||
        expression.includes("window.WebSocket && window.WebSocket");
    });
    await h.start();
    h.sendCommand.mockClear();

    await h.observer.refreshCatalog(source);

    expect(refreshControlCalls()).toHaveLength(0);

    // Four owners plus the terminal step finish this bounded fixture. Once the
    // collector is complete, the ordinary explicit refresh path is available.
    for (let index = 0; index < 5; index += 1) await h.poll();
    h.sendCommand.mockClear();
    await h.observer.refreshCatalog(source);
    expect(refreshControlCalls().length).toBeGreaterThan(0);
  });

  it("requests read-only target discovery before the independently guarded collector", async () => {
    const h = harness();
    await h.start();
    expect(vi.mocked(runSabaNavigationProbe).mock.calls[0]![0]).toMatchObject({ discoveryOnly: true });
  });

  it("batches at most four Early owners by default and restores Today once", async () => {
    const h = harness(undefined, undefined, undefined, { earlyOwners: 6 });
    await h.start();
    await h.poll();
    await h.poll();
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    adapter.restoreToday.mockClear();

    await h.poll();

    expect(earlyOwnerCalls(adapter)
      .map(([, owner]) => owner.ownerMatchId)).toEqual(["EARLY-0", "EARLY-1", "EARLY-2", "EARLY-3"]);
    expect(adapter.restoreToday).toHaveBeenCalledOnce();
    expect(h.selected()).toBe("TODAY");
    expect(h.collectorChunks()).toHaveLength(0);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it("ends an Early batch only between closed owners after its monotonic budget expires", async () => {
    const h = harness(undefined, undefined, undefined, { earlyOwners: 6 });
    await h.start();
    await h.poll();
    await h.poll();
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    h.hold(async () => { h.advanceMonotonic(5_001); });
    await h.poll();
    expect(earlyOwnerCalls(adapter)).toHaveLength(1);
    expect(h.selected()).toBe("TODAY");
    h.hold(async () => undefined);

    await h.poll();

    expect(earlyOwnerCalls(adapter)
      .map(([, owner]) => owner.ownerMatchId)).toEqual([
        "EARLY-0", "EARLY-1", "EARLY-2", "EARLY-3", "EARLY-4"
      ]);
    expect(h.collectorChunks()).toHaveLength(0);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it("retains a full Early batch while restoration is pending without recapturing its owners", async () => {
    const h = harness(undefined, undefined, undefined, { earlyOwners: 6 });
    await h.start();
    await h.poll();
    await h.poll();
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    h.setRestoreAllowed(false);
    await h.poll();
    expect(adapter.captureOwner).toHaveBeenCalledTimes(6);
    expect(h.collectorChunks()).toHaveLength(0);
    h.setRestoreAllowed(true);

    await h.poll();
    expect(adapter.captureOwner).toHaveBeenCalledTimes(6);
    expect(h.collectorChunks()).toHaveLength(0);
    await h.poll();
    // Reconciliation can defer the terminal to the next bounded slice.
    if (h.collectorChunks().length === 0) await h.poll();
    expect(adapter.captureOwner).toHaveBeenCalledTimes(8);
    const completions = h.collectorChunks().flatMap(({ payload }) => JSON.parse(payload.body).records)
      .filter((item: { kind: string }) => item.kind === "OWNER_COMPLETE");
    expect(completions).toHaveLength(8);
    expect(new Set(completions.map((item: { period: string; ownerMatchId: string }) =>
      `${item.period}:${item.ownerMatchId}`)).size).toBe(8);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it("does not continue an Early batch or publish after its second owner retires the epoch", async () => {
    const h = harness(undefined, undefined, undefined, { earlyOwners: 6 });
    await h.start();
    await h.poll();
    await h.poll();
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    let captured = 0;
    h.hold(async () => {
      captured += 1;
      if (captured === 2) h.observer.beginSourceEpoch(source.sourceId);
    });

    await h.poll();

    expect(earlyOwnerCalls(adapter)).toHaveLength(2);
    expect(h.collectorChunks()).toHaveLength(0);
  });

  it.each([33, 1])("admits read-only collector discovery from a valid responsive %i-row football DOM", async (count) => {
    const h = harness(undefined, undefined,
      Array.from({ length: count }, (_, index) => record(`responsive-${index}`)));

    await h.start();
    await h.observer.heartbeat(source, "sports.example");
    const heartbeat = h.forwarded.map(({ payload }) => JSON.parse(payload.body))
      .find((body) => body.kind === "WS_ATTACH");
    expect(heartbeat.sabaCollector).toMatchObject({ nativeReady: false, catalogUsable: false,
      discoveryAttempted: true, collectorState: "RUNNING" });
    expect(h.observer.hasResponsiveSabaDocument(source.sourceId)).toBe(true);
  });

  it.each([
    ["empty", []],
    ["diagnostic", [{ __fieldlineDiagnostic: { status: "PUBLIC_STRUCTURE_ONLY" } }]],
    ["malformed football", [{ sportId: "1", matchId: "unsafe", groups: [{ odds: [{}, {}] }] }]],
    ["different sport", [{ ...record("not-football"), sportId: "2" }]]
  ] as const)("does not admit collector discovery from a %s DOM receipt", async (_label, records) => {
    const h = harness(undefined, undefined, records);

    await h.poll();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(vi.mocked(runSabaNavigationProbe)).not.toHaveBeenCalled();
    expect(vi.mocked(createSabaHiddenMarketPageAdapter)).not.toHaveBeenCalled();
    expect(h.observer.hasResponsiveSabaDocument(source.sourceId)).toBe(false);
  });

  it("defers hard reload only while a low-row football receipt remains fresh", async () => {
    vi.useFakeTimers();
    try {
      const recover = vi.fn(async () => undefined);
      const h = harness(recover, undefined, [record("responsive")]);
      await h.poll();
      h.advanceTime(45_000);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(recover).not.toHaveBeenCalled();

      h.advanceTime(45_000);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(recover).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["source", "tab"] as const)("clears a responsive DOM receipt on %s retirement", async (boundary) => {
    vi.useFakeTimers();
    try {
      const recover = vi.fn(async () => undefined);
      const h = harness(recover, undefined, [record("responsive")]);
      await h.poll();
      if (boundary === "source") h.observer.beginSourceEpoch(source.sourceId);
      else h.observer.prepareDebuggerReattach(source.tabId);
      h.setVisibleRecords([]);
      await h.poll();
      h.advanceTime(45_000);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(recover).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts hidden collection when a complete native baseline already owns canonical authority", async () => {
    const h = harness();
    await h.observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "native-ready", url: "wss://sports.example/socket.io/"
    });
    const nativeBaseline = `42${JSON.stringify(["m", "b1", [["c", "c2"],
      ["f", 0, ["type", "matchid"]], [0, "reset"], [0, "o"], [0, "done"]], "native-ready"])}`;
    await h.observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "native-ready", response: { opcode: 1, payloadData: nativeBaseline }
    });
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(true);

    await h.start();
    await h.poll();

    expect(vi.mocked(runSabaNavigationProbe).mock.calls[0]![0]).toMatchObject({ discoveryOnly: true });
    expect(h.forwarded.some(({ payload }) => payload.body.includes('"completedOwners":1'))).toBe(true);
    expect(h.collectorChunks()).toHaveLength(0);
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(true);
  });

  it("starts from a read-only bound Today without a redundant More navigation sweep", async () => {
    vi.mocked(runSabaNavigationProbe).mockResolvedValueOnce({ viewRestored: true,
      body: JSON.stringify({ status: "NO_ACTION_COLLECTOR_TARGET_BOUND", mutated: false,
        initial: { activePeriod: "TODAY", documentToken: "bound-document" } }) });
    const h = harness();
    await h.start();
    await h.poll();
    expect(h.forwarded.some(({ payload }) => payload.body.includes('"completedOwners":1'))).toBe(true);
    expect(h.collectorChunks()).toHaveLength(0);
  });

  it.each([
    { activePeriod: "EARLY", documentToken: "bound-document", mutated: false },
    { activePeriod: "TODAY", documentToken: "other-document", mutated: false },
    { activePeriod: "TODAY", documentToken: "bound-document", mutated: true }
  ])("refuses ambiguous read-only admission $activePeriod/$documentToken/$mutated", async (value) => {
    vi.mocked(runSabaNavigationProbe).mockResolvedValueOnce({ viewRestored: true,
      body: JSON.stringify({ status: "NO_ACTION_COLLECTOR_TARGET_BOUND", mutated: value.mutated,
        initial: { activePeriod: value.activePeriod, documentToken: value.documentToken } }) });
    const h = harness();
    await h.poll();
    await vi.waitFor(() => expect(h.forwarded.some(({ payload }) =>
      payload.body.includes("NO_ACTION_COLLECTOR_TARGET_BOUND"))).toBe(true));
    expect(vi.mocked(createSabaHiddenMarketPageAdapter)).not.toHaveBeenCalled();
    expect(h.collectorChunks()).toHaveLength(0);
  });

  it.each(["EARLY", "UNKNOWN"])("retries a safe read-only %s refusal after pacing and later binds Today", async (activePeriod) => {
    vi.mocked(runSabaNavigationProbe).mockResolvedValueOnce({ viewRestored: true,
      body: JSON.stringify({ status: "NO_ACTION_COLLECTOR_TARGET_UNBOUND", mutated: false,
        initial: { activePeriod, documentToken: "bound-document" } }) });
    const h = harness();
    await h.poll();
    await vi.waitFor(() => expect(h.forwarded.some(({ payload }) =>
      payload.body.includes("NO_ACTION_COLLECTOR_TARGET_UNBOUND"))).toBe(true));
    expect(vi.mocked(createSabaHiddenMarketPageAdapter)).not.toHaveBeenCalled();
    await h.poll();
    expect(vi.mocked(runSabaNavigationProbe)).toHaveBeenCalledOnce();
    vi.mocked(runSabaNavigationProbe).mockResolvedValueOnce({ viewRestored: true,
      body: JSON.stringify({ status: "NO_ACTION_COLLECTOR_TARGET_BOUND", mutated: false,
        initial: { activePeriod: "TODAY", documentToken: "bound-document" } }) });
    h.advanceTime(30_000);
    await h.start();
    expect(vi.mocked(runSabaNavigationProbe)).toHaveBeenCalledTimes(2);
  });

  it("connects the bounded unrepresented-owner diagnostic to the real page adapter", async () => {
    const h = harness();
    await h.start();
    const options = vi.mocked(createSabaHiddenMarketPageAdapter).mock.calls[0]![0];
    expect(options.onUnrepresentedOwner).toBeTypeOf("function");
    const diagnostic = { binding: options.binding, period: "TODAY" as const, ownerMatchId: "TODAY-0",
      capturedAtMs: 1_788_800_003_000, capturedMonotonicMs: 1_788_800_003,
      reason: "GROUP_COUNT_CHANGED" as const,
      before: { groupCount: 1, nativeTypes: ["1"], nativeIdCount: 1 },
      after: { groupCount: 2, nativeTypes: ["1"], nativeIdCount: 1, addedNativeIds: [] },
      catalog: { groupCount: 1, nativeIdCount: 1 }, unmatched: [], addedGroupShapes: [] };
    options.onUnrepresentedOwner?.(diagnostic);
    await vi.waitFor(() => expect(h.forwarded.filter(({ payload }) =>
      payload.body.includes("SABA_HIDDEN_COLLECTOR_SHAPE"))).toHaveLength(1));
    h.observer.beginBridgeSourceEpoch(source.sourceId);
    options.onUnrepresentedOwner?.(diagnostic);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(h.forwarded.filter(({ payload }) => payload.body.includes("SABA_HIDDEN_COLLECTOR_SHAPE"))).toHaveLength(1);
  });

  it("reports bounded public unknown-group labels from the first restored expansion without publishing partial catalog", async () => {
    const h = harness();
    await h.start();
    await h.poll();
    const progress = h.forwarded.map(({ payload }) => JSON.parse(payload.body))
      .find((body) => body.kind === "SABA_HIDDEN_COLLECTOR" && body.status === "IN_PROGRESS" && body.publicMarketSample);
    expect(progress.publicMarketSample).toMatchObject({ ownerMatchId: "TODAY-0",
      groups: [{ betTypeIds: [], labels: ["Hidden public label"], nativeIds: ["TODAY-0-hidden"],
        publicPrices: ["0.91", "-0.93"] }] });
    expect(progress.viewRestored).toBe(true);
    expect(h.collectorChunks()).toHaveLength(0);
  });

  it.each([{ betTypeIds: [] }, { betTypeIds: ["461"] }])(
    "reports cached hidden public inventory including typed noncore groups %j", async ({ betTypeIds }) => {
    const h = harness();
    await h.start(false);
    const adapter: SabaCollectorPageAdapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    const readRoster = adapter.readRoster;
    adapter.readRoster = vi.fn(async (period) => {
      const roster = await readRoster(period);
      return { ...roster, owners: roster.owners.map((owner) => ({ ...owner,
        record: { ...owner.record, groups: owner.record.groups.map((group) => ({
          ...group, betTypeIds, labels: ["Cached public market"]
        })) } })) };
    });
    const captureOwner = adapter.captureOwner;
    adapter.captureOwner = vi.fn(async (period, owner) => {
      const { capture: _capture, ...result } = await captureOwner(period, owner);
      return { ...result, safeControlOutcome: "NO_STRUCTURAL_CHANGE" as const };
    });
    await h.poll();
    await h.poll();
    const samples = h.forwarded.map(({ payload }) => JSON.parse(payload.body))
      .filter((body) => body.kind === "SABA_HIDDEN_COLLECTOR" && body.publicMarketSample);
    expect(samples).toHaveLength(1);
    expect(samples[0].publicMarketSample.groups[0]).toMatchObject({
      betTypeIds, labels: ["Cached public market"], publicPrices: ["0.91", "-0.93"]
    });
    expect(h.collectorChunks()).toHaveLength(0);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it("does not let a known three-way roster consume the unknown and two typed evidence samples", async () => {
    const h = harness();
    await h.start();
    const adapter: SabaCollectorPageAdapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    const readRoster = adapter.readRoster;
    adapter.readRoster = async (period) => {
      const roster = await readRoster(period);
      return { ...roster, owners: roster.owners.map((owner) => ({ ...owner, record: {
        ...owner.record, groups: owner.record.groups.map((group) => ({ ...group, betTypeIds: ["15"] }))
      } })) };
    };
    const captureOwner = adapter.captureOwner;
    adapter.captureOwner = async (period, owner) => {
      const result = await captureOwner(period, owner);
      const typed = owner.ownerMatchId === "TODAY-1" ? "461" :
        owner.ownerMatchId === "EARLY-0" ? "462" : null;
      if (typed === null || result.capture === undefined) return result;
      return { ...result, capture: { ...result.capture, record: { ...result.capture.record,
        groups: result.capture.record.groups.map((group) => group.betTypeIds.length === 0
          ? { ...group, betTypeIds: [typed], labels: [`Public heading ${typed}`] } : group)
      } } };
    };
    for (let index = 0; index < 5; index++) await h.poll();
    const samples = h.forwarded.map(({ payload }) => JSON.parse(payload.body))
      .filter((body) => body.kind === "SABA_HIDDEN_COLLECTOR" && body.publicMarketSample);
    expect(samples).toHaveLength(3);
    expect(samples.map((body) => body.publicMarketSample.groups.map((group: { betTypeIds: string[] }) =>
      group.betTypeIds))).toEqual([[[]], [["461"]], [["462"]]]);
    expect(samples.every((body) => body.viewRestored === true)).toBe(true);
  });

  it("starts independently validated collection from an untouched bound Today when the diagnostic stability budget expires", async () => {
    vi.mocked(runSabaNavigationProbe).mockResolvedValueOnce({ viewRestored: true,
      body: JSON.stringify({ status: "NO_ACTION_INITIAL_TODAY_NOT_STABLE", viewRestored: true,
        initial: { activePeriod: "TODAY", activePeriodEvidence: "FOOTBALL_PAGE_HEADING", rowCount: 75 } }) });
    const h = harness();
    await h.start();
    await h.poll();
    expect(h.collectorChunks()).toHaveLength(0);
    expect(h.forwarded.some(({ payload }) => payload.body.includes('"completedOwners":1'))).toBe(true);
  });

  it("resumes one owner per poll, restores Today between slices and emits only a complete bound generation", async () => {
    const h = harness();
    await h.start();
    for (let index = 0; index < 3; index++) {
      await h.poll();
      expect(h.collectorChunks()).toHaveLength(0);
      expect(h.selected()).toBe("TODAY");
    }
    await h.poll();
    const chunks = h.collectorChunks().map(({ payload }) => JSON.parse(payload.body));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatchObject({ sweepComplete: true, sweepDocumentKey: "bound-document" });
    const items = chunks.flatMap((chunk) => chunk.records);
    expect(items.filter((item) => item.kind === "OWNER_COMPLETE")).toHaveLength(4);
    expect(items.filter((item) => item.captureKind === "OWNER_GROUPS_EXPANDED")).toHaveLength(4);
    expect(items.filter((item) => item.kind === "TERMINAL")).toHaveLength(1);
    const emittedAt = h.collectorChunks()[0]!.observedAtMs;
    const captureClocks = items.filter((item) => item.kind === "CAPTURE").map((item) => item.capturedAtMs);
    expect(captureClocks.every((value) => value <= emittedAt)).toBe(true);
    expect(captureClocks[0]).toBeLessThan(emittedAt - 6_000);
    await h.poll();
    expect(h.collectorChunks()).toHaveLength(chunks.length);
  });

  it("blocks ordinary partial DOM while navigating but leaves the existing native WS lane active", async () => {
    const h = harness();
    await h.start();
    let release!: () => void;
    h.hold(() => new Promise<void>((resolve) => { release = resolve; }));
    const pending = h.poll();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const domCount = h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT").length;
    await h.observer.ingestDomSnapshot(source, "sports.example", JSON.stringify([record("partial")]));
    expect(h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(domCount);
    await h.observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "native", url: "wss://sports.example/socket.io/"
    });
    const nativeBaseline = `42${JSON.stringify(["m", "b1", [["c", "c2"],
      ["f", 0, ["type"]], [0, "reset"], [0, "o"], [0, "done"]], "native"])}`;
    await h.observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "native", response: { opcode: 1, payloadData: nativeBaseline }
    });
    expect(h.forwarded.some(({ transport, payload }) => transport === "WS_FRAME" && payload.body === nativeBaseline)).toBe(true);
    release();
    await pending;
  });

  it("does not overlap collector advance or release its DOM block after a timed-out work owner unlocks", async () => {
    let forceNextRun = false;
    let forceUnlock: (() => void) | undefined;
    const innerWork: Promise<unknown>[] = [];
    const workScheduler = {
      run: <T>(_sourceId: string, operation: () => Promise<T>): Promise<T> => {
        const inner = Promise.resolve().then(operation);
        innerWork.push(inner);
        if (!forceNextRun) return inner;
        forceNextRun = false;
        const unlocked = new Promise<T>((resolve) => {
          forceUnlock = () => resolve(undefined as T);
        });
        return Promise.race([inner, unlocked]);
      },
      clear: vi.fn()
    } as unknown as ProviderWorkScheduler;
    const h = harness(undefined, workScheduler);
    await h.start();
    await h.poll();
    await h.poll();
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    let releaseRestore!: () => void;
    const restorePending = new Promise<void>((resolve) => { releaseRestore = resolve; });
    h.holdRestore(() => restorePending);
    forceNextRun = true;
    const first = h.poll();
    await vi.waitFor(() => expect(adapter.restoreToday).toHaveBeenCalledOnce());
    h.advanceTime(30_001);
    forceUnlock?.();
    await first;

    const overlapping = h.poll();
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(adapter.captureOwner).toHaveBeenCalledTimes(3);
      expect(adapter.restoreToday).toHaveBeenCalledOnce();
      expect(h.collectorChunks()).toHaveLength(0);
      const domCount = h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT").length;
      await h.observer.ingestDomSnapshot(source, "sports.example", JSON.stringify([record("partial-overlap")]));
      expect(h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(domCount);
    } finally {
      releaseRestore?.();
      await Promise.allSettled([overlapping, ...innerWork]);
    }
  });

  it("never emits a terminal across an epoch replacement during an owner read", async () => {
    const h = harness();
    await h.start();
    let release!: () => void;
    h.hold(() => new Promise<void>((resolve) => { release = resolve; }));
    const pending = h.poll();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    h.observer.beginSourceEpoch(source.sourceId);
    release();
    await pending;
    expect(h.collectorChunks()).toHaveLength(0);
  });

  it("withholds the whole generation and partial DOM when Today cannot be restored", async () => {
    const h = harness();
    await h.start();
    // Captured Today owners already prove restoration. Exercise the Early
    // slice, which must independently restore Today before releasing DOM.
    await h.poll();
    await h.poll();
    h.setRestoreAllowed(false);
    await h.poll();
    expect(h.collectorChunks()).toHaveLength(0);
    const count = h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT").length;
    await h.observer.ingestDomSnapshot(source, "sports.example", JSON.stringify([record("partial")]));
    expect(h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(count);
    expect(h.forwarded.some(({ payload }) => payload.body.includes("TODAY_RESTORE_UNCONFIRMED"))).toBe(true);
  });

  it("pauses only for restoration after a successful Early slice then resumes the unchanged candidate", async () => {
    const h = harness();
    await h.start();
    await h.poll();
    await h.poll();
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    h.setRestoreAllowed(false);

    await h.poll();

    expect(adapter.captureOwner).toHaveBeenCalledTimes(3);
    expect(h.collectorChunks()).toHaveLength(0);
    expect(h.forwarded.some(({ payload }) => payload.body.includes('"status":"RESTORE_PENDING"'))).toBe(true);
    h.setRestoreAllowed(true);

    await h.poll();

    expect(adapter.captureOwner).toHaveBeenCalledTimes(3);
    expect(h.forwarded.filter(({ payload }) =>
      payload.body.includes('"status":"RESUMED_AFTER_RESTORE"'))).toHaveLength(1);
    expect(h.collectorChunks()).toHaveLength(0);

    await h.poll();

    expect(adapter.captureOwner).toHaveBeenCalledTimes(4);
    const items = h.collectorChunks().flatMap(({ payload }) => JSON.parse(payload.body).records);
    const completedOwnerIds = items.filter((item: { kind: string }) => item.kind === "OWNER_COMPLETE")
      .map((item: { ownerMatchId: string }) => item.ownerMatchId);
    expect(completedOwnerIds).toHaveLength(4);
    expect(new Set(completedOwnerIds).size).toBe(4);
    expect(items.filter((item: { kind: string }) => item.kind === "TERMINAL")).toHaveLength(1);
  });

  it("reports the exact safe collector failure code instead of hiding the failed stage", async () => {
    const h = harness();
    await h.start();
    h.hold(async () => { throw new Error("SABA_COLLECTOR_OWNER_IDENTITY_CHANGED"); });
    await h.poll();
    expect(h.collectorChunks()).toHaveLength(0);
    expect(h.forwarded.some(({ payload }) => payload.body.includes("SABA_COLLECTOR_OWNER_IDENTITY_CHANGED"))).toBe(true);
  });

  it("emits bounded period failure evidence once and only after Today restoration", async () => {
    const h = harness();
    await h.start();
    const options = vi.mocked(createSabaHiddenMarketPageAdapter).mock.calls[0]![0];
    const diagnostic = { expectedPeriod: "EARLY" as const, readCount: 4, elapsedMs: 15000,
      fingerprintSame: false, metadataSame: true, finalPhases: [{ actualPeriod: "UNKNOWN" as const,
        activePeriodEvidence: "CONFLICT" as const, tableCount: 2, publicRosterLength: 10,
        eligibleMoreCount: 8, metadataPrematchCount: 10,
        probeFingerprintHash: "12345678", metadataRowsHash: "abcdef12" }] };
    options.onPeriodUnstable?.(diagnostic);
    h.hold(async () => { throw new Error("SABA_COLLECTOR_PERIOD_NOT_STABLE"); });
    h.setRestoreAllowed(false);
    await h.poll();
    const diagnostics = () => h.forwarded.map(({ payload }) => JSON.parse(payload.body))
      .filter((body) => body.kind === "SABA_HIDDEN_COLLECTOR_PERIOD");
    expect(diagnostics()).toHaveLength(0);
    options.onPeriodUnstable?.({ ...diagnostic, expectedPeriod: "TODAY" });
    h.setRestoreAllowed(true);
    await h.poll();
    await h.poll();
    expect(diagnostics()).toEqual([{ ...diagnostic, kind: "SABA_HIDDEN_COLLECTOR_PERIOD",
      viewRestored: true }]);
    expect(h.collectorChunks()).toHaveLength(0);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it.each(["OPEN", "RESTORE"] as const)("emits a bounded %s metadata diagnostic once and ignores it after retirement", async (phase) => {
    const h = harness();
    await h.start();
    const options = vi.mocked(createSabaHiddenMarketPageAdapter).mock.calls[0]![0];
    const summary = { actualPeriod: "EARLY" as const, rowCount: 2, uniqueCount: 2,
      addedCount: 0, missingCount: 0, duplicateCount: 0,
      addedMatchIds: [], missingMatchIds: [], duplicateMatchIds: [],
      controlCounts: { eligibleMore: 1, openMore: 0, noEligibleControl: 1, unsafe: 0 },
      timeShapeCounts: { datedKickoff: 2, prefixedKickoff: 0, undatedKickoff: 0 },
      dateCounts: { explicit: 2, unknown: 0 } };
    const diagnostic = { binding: options.binding, period: "EARLY" as const, phase,
      ownerMatchId: "EARLY-0", reason: "METADATA_CONTROL" as const,
      changedRows: [{ matchId: "EARLY-1", beforeControl: "ELIGIBLE_MORE" as const,
        afterControl: "NO_ELIGIBLE_CONTROL" as const, timeShapeChanged: false, dateChanged: false }],
      capturedAtMs: 1_788_800_010_000, capturedMonotonicMs: 1_788_800_010,
      baseline: summary, restoredReads: { first: summary, final: summary } };

    options.onRestoreRosterMismatch?.(diagnostic);
    options.onRestoreRosterMismatch?.(diagnostic);
    await vi.waitFor(() => expect(h.forwarded.filter(({ payload }) =>
      payload.body.includes('"kind":"SABA_HIDDEN_COLLECTOR_ROSTER_MISMATCH"'))).toHaveLength(1));
    const emitted = h.forwarded.find(({ payload }) =>
      payload.body.includes('"kind":"SABA_HIDDEN_COLLECTOR_ROSTER_MISMATCH"'))!;
    expect(emitted).toMatchObject({ observedAtMs: diagnostic.capturedAtMs,
      receivedMonotonicMs: diagnostic.capturedMonotonicMs });
    expect(JSON.parse(emitted.payload.body)).toEqual({ ...diagnostic, kind: "SABA_HIDDEN_COLLECTOR_ROSTER_MISMATCH" });

    h.observer.beginSourceEpoch(source.sourceId);
    options.onRestoreRosterMismatch?.(diagnostic);
    expect(h.forwarded.filter(({ payload }) =>
      payload.body.includes('"kind":"SABA_HIDDEN_COLLECTOR_ROSTER_MISMATCH"'))).toHaveLength(1);
  });

  it.each(["FRAME_COMMAND_TIMEOUT", "OWNER_PREPARATION_TIMEOUT"] as const)(
    "resumes the same %s owner only after Today restoration is proven", async (code) => {
    const h = harness();
    await h.start();
    let fail = true;
    h.hold(async () => { if (fail) throw new Error(`SABA_COLLECTOR_${code}`); });
    h.setRestoreAllowed(false);
    await h.poll();
    expect(h.collectorChunks()).toHaveLength(0);
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    expect(adapter.captureOwner).toHaveBeenCalledTimes(1);
    h.setRestoreAllowed(true);
    await h.poll();
    expect(adapter.captureOwner).toHaveBeenCalledTimes(1);
    expect(h.forwarded.some(({ payload }) => payload.body.includes('"status":"RETRY_PENDING"'))).toBe(true);
    fail = false;
    for (let index = 0; index < 4; index++) await h.poll();
    const items = h.collectorChunks().flatMap(({ payload }) => JSON.parse(payload.body).records);
    expect(items.filter((item: { kind: string }) => item.kind === "OWNER_COMPLETE")).toHaveLength(4);
    expect(items.filter((item: { kind: string }) => item.kind === "TERMINAL")).toHaveLength(1);
  });

  it("attributes a roster deadline to its operation after successful independent Today restoration", async () => {
    const h = harness();
    await h.start(false);
    const adapter = vi.mocked(createSabaHiddenMarketPageAdapter).mock.results[0]!.value;
    const read = adapter.readRoster.getMockImplementation()!;
    adapter.readRoster.mockImplementation(async (period: "TODAY" | "EARLY") => {
      if (period === "EARLY") throw new Error("SABA_COLLECTOR_OPERATION_DEADLINE");
      return read(period);
    });
    for (let index = 0; index < 3; index++) await h.poll();
    const failure = h.forwarded.map(({ payload }) => JSON.parse(payload.body))
      .find((body) => body.kind === "SABA_HIDDEN_COLLECTOR" &&
        (body.reason === "SABA_COLLECTOR_OPERATION_DEADLINE" || body.collectionErrorCode === "SABA_COLLECTOR_OPERATION_DEADLINE"));
    expect(failure).toMatchObject({ viewRestored: true, collectionFailure: {
      operation: "READ_ROSTER", period: "EARLY", ownerMatchId: null,
      code: "SABA_COLLECTOR_OPERATION_DEADLINE", capturedAtMs: expect.any(Number),
      capturedMonotonicMs: expect.any(Number)
    } });
    expect(h.collectorChunks()).toHaveLength(0);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it("preserves both collection and restoration error codes when restoration also fails", async () => {
    const h = harness();
    await h.start();
    h.hold(async () => { throw new Error("SABA_COLLECTOR_SUPPLEMENTAL_UNSAFE_TEST"); });
    h.setRestoreAllowed(false);
    await h.poll();
    const failure = h.forwarded.map(({ payload }) => JSON.parse(payload.body))
      .find((body) => body.kind === "SABA_HIDDEN_COLLECTOR" && body.status === "INCOMPLETE");
    expect(failure).toMatchObject({ viewRestored: false,
      collectionErrorCode: "SABA_COLLECTOR_SUPPLEMENTAL_UNSAFE_TEST",
      restorationErrorCode: "SABA_COLLECTOR_TODAY_RESTORE_UNCONFIRMED",
      collectionFailure: { operation: "CAPTURE_OWNER", period: "TODAY", ownerMatchId: "TODAY-0",
        code: "SABA_COLLECTOR_SUPPLEMENTAL_UNSAFE_TEST" },
      restorationFailure: { operation: "RESTORE_TODAY", period: "TODAY", ownerMatchId: null,
        code: "SABA_COLLECTOR_TODAY_RESTORE_UNCONFIRMED" }
    });
    expect(h.collectorChunks()).toHaveLength(0);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it.each(["REJECTED", "NO_EPOCH", "PENDING"] as const)(
    "keeps an interrupted collector view blocked through bounded %s recovery", async (outcome) => {
      let releaseCallback!: () => void;
      const callbackPending = new Promise<void>((resolve) => { releaseCallback = resolve; });
      const recover = vi.fn(() => outcome === "REJECTED"
        ? Promise.reject(new Error("recovery rejected"))
        : outcome === "NO_EPOCH" ? Promise.resolve() : callbackPending);
      const h = harness(recover);
      await h.start();
      vi.useFakeTimers();
      let releaseOwner!: () => void;
      try {
        h.hold(() => new Promise<void>((resolve) => { releaseOwner = resolve; }));
        const pending = h.poll();
        await vi.waitFor(() => expect(releaseOwner).toBeTypeOf("function"));

        await h.observer.handleEvent(source, "Runtime.executionContextsCleared", {});
        releaseOwner();
        await pending;
        await vi.advanceTimersByTimeAsync(0);
        expect(recover).toHaveBeenCalledTimes(1);
        const recoveryStatuses = () => h.forwarded.filter(({ request }) =>
          request.pathnameClass === "/__fieldline_saba_navigation_probe__")
          .map(({ payload }) => JSON.parse(payload.body).status)
          .filter((status) => String(status).startsWith("RECOVERY_"));
        expect(recoveryStatuses()).toContain("RECOVERY_PENDING");
        if (outcome === "REJECTED") expect(recoveryStatuses()).toContain("RECOVERY_FAILED");
        if (outcome === "NO_EPOCH") expect(recoveryStatuses()).toContain("RECOVERY_NO_EPOCH");

        const domCount = h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT").length;
        await h.observer.ingestDomSnapshot(source, "sports.example", JSON.stringify([record("partial")]));
        expect(h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(domCount);

        h.sendCommand.mockClear();
        await h.observer.refreshCatalog(source);
        const unsafeRefreshControls = h.sendCommand.mock.calls.filter(([, method, params]) => {
          if (method !== "Runtime.evaluate") return false;
          const expression = String(params?.expression ?? "");
          return expression.includes("fieldline-saba-time-baseline") ||
            expression.includes("window.io && window.io.Socket") ||
            expression.includes("window.WebSocket && window.WebSocket");
        });
        expect(unsafeRefreshControls).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(299_999);
        expect(recover).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(recover).toHaveBeenCalledTimes(2);
        await h.observer.ingestDomSnapshot(source, "sports.example", JSON.stringify([record("partial-2")]));
        expect(h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(domCount);

        h.observer.beginSourceEpoch(source.sourceId);
        const statusCount = recoveryStatuses().length;
        releaseCallback();
        await vi.advanceTimersByTimeAsync(300_000);
        expect(recover).toHaveBeenCalledTimes(2);
        expect(recoveryStatuses()).toHaveLength(statusCount);
      } finally {
        releaseOwner?.();
        releaseCallback();
        vi.useRealTimers();
      }
    }
  );

  it("requests explicit unsafe-view recovery even while a complete native SABA baseline exists", async () => {
    const recover = vi.fn(async (_source: ObservedSource, _reason?: "UNSAFE_VIEW") => undefined);
    const h = harness(recover);
    await h.observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "native-ready-unsafe", url: "wss://sports.example/socket.io/"
    });
    const nativeBaseline = `42${JSON.stringify(["m", "b1", [["c", "c2"],
      ["f", 0, ["type", "matchid"]], [0, "reset"], [0, "o"], [0, "done"]], "native-ready"])}`;
    await h.observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "native-ready-unsafe", response: { opcode: 1, payloadData: nativeBaseline }
    });
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(true);
    await h.start();
    let releaseOwner!: () => void;
    h.hold(() => new Promise<void>((resolve) => { releaseOwner = resolve; }));
    const pending = h.poll();
    await vi.waitFor(() => expect(releaseOwner).toBeTypeOf("function"));

    await h.observer.handleEvent(source, "Runtime.executionContextsCleared", {});
    releaseOwner();
    await pending;

    await vi.waitFor(() => expect(recover).toHaveBeenCalledExactlyOnceWith(source, "UNSAFE_VIEW"));
  });

  it.each(["reattach", "contexts-cleared", "bridge-epoch", "child-detach"] as const)(
    "retires interrupted collection on %s and reaches bounded recovery without releasing partial DOM", async (boundary) => {
      const h = harness();
      if (boundary === "child-detach") await h.observer.handleEvent(source, "Runtime.executionContextCreated", {
        context: { id: 73, auxData: { frameId: "sports-child", isDefault: true } }
      }, "collector-child");
      await h.start();
      let release!: () => void;
      h.hold(() => new Promise<void>((resolve) => { release = resolve; }));
      const pending = h.poll();
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      if (boundary === "reattach") h.observer.prepareDebuggerReattach(source.tabId);
      else if (boundary === "bridge-epoch") h.observer.beginBridgeSourceEpoch(source.sourceId);
      else if (boundary === "child-detach") await h.observer.handleEvent(source, "Target.detachedFromTarget", {
        sessionId: "collector-child"
      });
      else await h.observer.handleEvent(source, "Runtime.executionContextsCleared", {});
      release();
      await pending;
      await vi.waitFor(() => expect(h.forwarded.some(({ payload }) =>
        payload.body.includes("RECOVERY_PENDING"))).toBe(true));
      expect(h.collectorChunks()).toHaveLength(0);
      const count = h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT").length;
      await h.observer.ingestDomSnapshot(source, "sports.example", JSON.stringify([record("partial")]));
      expect(h.forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(count);
      h.observer.beginSourceEpoch(source.sourceId);
    });
});
