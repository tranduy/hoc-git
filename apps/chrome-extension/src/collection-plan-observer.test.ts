import { describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";

describe("collection plan observer ownership", () => {
  it.each([false, true])("keeps APSPORT full roster and switches legacy detail admission (plan after roster: %s)", async afterRoster => {
    vi.useFakeTimers();
    const at = 1_800_000_000_000;
    vi.setSystemTime(at);
    const source = { lobby: "TSPORT", tabId: 7, sourceId: "chrome:TSPORT:7" } as const;
    const records = [1, 30, 80].map((h, i) => ({ "1": "league", "2": String(i + 1), "5": `Home ${i}`,
      "6": false, "10": "Active", "11": new Date(at + h * 3_600_000).toISOString(),
      "22": `Away ${i}`, "50": [], "53": "League" }));
    let sweepContinued = true;
    const detail = vi.fn(async ({ eventId }: { eventId: string }) => records.find(r => r["2"] === eventId) ?? null);
    const observer = new NetworkObserver({ now: Date.now, monotonicNow: () => Date.now() - at + 100,
      sendCommand: async (_tab, method) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "ap", loaderId: "loader" } } } : {},
      forward: async () => undefined, collectApsportEventDetail: detail,
      collectApsportCatalog: async options => {
        await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
          complete: true, prematchWindowHours: 24, records });
        if (afterRoster) {
          for (const record of records) options.onDetailState?.({ eventId: record["2"], state: "QUEUED" });
          options.onDetailState?.({ eventId: "1", state: "IN_FLIGHT" });
          await installPlan();
          expect(options.isCurrent()).toBe(true);
          options.onDetailState?.({ eventId: "1", state: "SUCCESS", hasMarkets: false });
        }
        sweepContinued = options.isCurrent() && options.shouldContinueDetails?.() !== false;
      } });
    const installPlan = () => observer.setCollectionPlan(source, { revision: at, events: records.map(r => ({
      eventId: r["2"], startAtUtcMs: Date.parse(r["11"]), isLive: false, urgent: r["2"] === "1" })) });
    try {
      await observer.start(source);
      await observer.handleEvent(source, "Runtime.executionContextCreated", { context: {
        id: 41, auxData: { isDefault: true, frameId: "ap" } } });
      await observer.handleEvent(source, "Network.requestWillBeSent", {
        requestId: "native", type: "Fetch", frameId: "ap", loaderId: "loader", request: {
          method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
          postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) } });
      if (!afterRoster) await installPlan();
      await observer.refreshCatalog(source);
      expect(sweepContinued).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      // The +30h fixture is walked too. Confining the walk to six hours kept
      // near kick-off corner books fresh and, unnoticed, meant no fixture
      // further out was ever asked for its corners - which is where the
      // corner arbitrage actually sits. The +80h fixture stays out: it is
      // beyond the 72-hour horizon the roster itself carries.
      expect(detail.mock.calls.map(c => c[0].eventId)).toEqual(["1", "2"]);
      await observer.maintain(source);
      await vi.advanceTimersByTimeAsync(2_000);
      // Nothing new is due yet: both books were just taken.
      expect(detail).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10_000);
      await observer.maintain(source);
      await vi.advanceTimersByTimeAsync(2_000);
      // The near fixture comes round again first: the scheduler orders on
      // refresh interval, which is what keeps the near window in front.
      expect(detail.mock.calls.map(c => c[0].eventId)).toEqual(["1", "2", "1"]);
    } finally { await observer.stop(source); vi.useRealTimers(); }
  });
  it("installs only into attached source contexts and rejects older plans without source recovery", async () => {
    const commands: { tabId: number; method: string; params?: Record<string, unknown> }[] = [];
    const observer = new NetworkObserver({ sendCommand: async (tabId, method, params) => {
      commands.push({ tabId, method, ...(params === undefined ? {} : { params }) }); return {};
    }, forward: vi.fn(async () => undefined), now: () => 1_800_000_000_000 });
    const source = { lobby: "BTI", tabId: 7, sourceId: "chrome:BTI:7" } as const;
    const plan = { revision: 3, events: [{ eventId: "1", startAtUtcMs: 1_800_003_600_000,
      isLive: false, urgent: true }] };
    await observer.setCollectionPlan(source, plan);
    expect(commands).toHaveLength(0);
    await observer.start(source);
    await observer.handleEvent(source, "Runtime.executionContextCreated", { context: {
      id: 41, origin: "https://bti.example", auxData: { isDefault: true, frameId: "sports" } } });
    commands.length = 0;
    await observer.setCollectionPlan(source, plan);
    expect(commands.filter(c => c.method === "Runtime.evaluate" &&
      String(c.params?.expression).includes("__fieldlineCollectionSchedulerV1"))).toHaveLength(1);
    expect(commands.every(c => c.tabId === 7 && c.method === "Runtime.evaluate")).toBe(true);
    commands.length = 0;
    await observer.setCollectionPlan(source, { ...plan, revision: 2 });
    expect(commands).toHaveLength(0);
    expect(observer.collectionStatus(source.sourceId)?.revision).toBe(3);
    const manual = { ...plan, manualRequestId: "manual-1" };
    await observer.setCollectionPlan(source, manual);
    expect(commands.filter(c => c.method === "Runtime.evaluate" &&
      String(c.params?.expression).includes("manual-1"))).toHaveLength(1);
    expect(observer.collectionStatus(source.sourceId)?.manualPending).toBe(1);
    commands.length = 0;
    await observer.setCollectionPlan(source, manual);
    await observer.setCollectionPlan(source, { ...manual, manualRequestId: "manual-2", events: [] });
    expect(commands).toHaveLength(0);
    await observer.stop(source);
    expect(observer.collectionStatus(source.sourceId)).toBeNull();
  });
  it("keeps pumping scheduled APSPORT detail until every due paired event has completed", async () => {
    vi.useFakeTimers();
    const at = 1_800_000_000_000;
    vi.setSystemTime(at);
    const source = { lobby: "TSPORT", tabId: 7, sourceId: "chrome:TSPORT:7" } as const;
    const records = Array.from({ length: 7 }, (_, index) => ({ "1": "league", "2": `event-${index}`,
      "5": `Home ${index}`, "6": false, "10": "Active",
      "11": new Date(at + (index + 1) * 3_600_000).toISOString(),
      "22": `Away ${index}`, "50": [], "53": "League" }));
    const detail = vi.fn(async ({ eventId }: { eventId: string }) =>
      records.find(record => record["2"] === eventId) ?? null);
    const observer = new NetworkObserver({ now: Date.now, monotonicNow: () => Date.now() - at + 100,
      sendCommand: async (_tab, method) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "ap", loaderId: "loader" } } } : {},
      forward: async () => undefined, collectApsportEventDetail: detail,
      collectApsportCatalog: async options => options.onRoster({ schemaVersion: 1,
        generation: options.generation, phase: "ROSTER", complete: true,
        prematchWindowHours: 24, records }) });
    try {
      await observer.start(source);
      await observer.handleEvent(source, "Runtime.executionContextCreated", { context: {
        id: 41, auxData: { isDefault: true, frameId: "ap" } } });
      await observer.handleEvent(source, "Network.requestWillBeSent", {
        requestId: "native", type: "Fetch", frameId: "ap", loaderId: "loader", request: {
          method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json" },
          postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) } });
      await observer.setCollectionPlan(source, { revision: at, events: records.map(record => ({
        eventId: record["2"], startAtUtcMs: Date.parse(record["11"]), isLive: false, urgent: false })) });
      await observer.refreshCatalog(source);

      await vi.advanceTimersByTimeAsync(20_000);

      // Every fixture is walked, the +7h one included. Confining this to six
      // hours kept near kick-off corner books fresh and, unnoticed, decided
      // that no fixture further out would ever be asked for its corners:
      // measured 2026-09-13, APSPORT carried corners on 53 of 1,288 fixtures
      // and shared none of them with BTI, while the corner arbitrage worth
      // finding sat ten hours to three days out. The near window is kept by
      // the scheduler ordering on refresh interval, not by excluding these.
      expect(new Set(detail.mock.calls.map(call => call[0].eventId))).toEqual(
        new Set(records.map(record => record["2"])));
    } finally { await observer.stop(source); vi.useRealTimers(); }
  });
});
