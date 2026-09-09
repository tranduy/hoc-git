import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CMD_FULL_BASELINE_EXPRESSION, NetworkObserver } from "./network-observer.js";

const source = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
const groupId = "fa97fe7b-13d3-4b03-96db-000000000001";
type NativeRequest = { body: string; success: (value: unknown) => void };

function harness() {
  const roster: NativeRequest[] = [];
  const more: NativeRequest[] = [];
  const root: { dataset: Record<string, string>; __fieldlineCmdNativeCatalogV1?: {
    owners: Map<string, { doneAt: number; nativeMore: { body: string; observedAtMs: number } }>;
  } } = { dataset: {} };
  const context = vm.createContext({ Date, URL, URLSearchParams, Map, Set, setTimeout, clearTimeout,
    document: { documentElement: root }, location: { hostname: "cgnew.fts368.com",
      pathname: "/Member/BetOdds/HdpDouble.aspx", origin: "https://cgnew.fts368.com" },
    GetOddsUrl: () => "/Member/BetsView/BetLight/DataOdds.ashx",
    GetOddsParams: (kind: string) => new URLSearchParams({ fc: kind === "E_Full" ? "6" : "1",
      TimeFilter: "0", m_gameType: "S_", m_SortByTime: "0", m_LeagueList: "", SingleDouble: "double",
      clientTime: "", fav: "", exlist: "0", keywords: "", m_sp: "0" }).toString(),
    ISCACHEMODE: true, ISPARLAYBETVIEW: false, GetAccountId: () => "test-account",
    callWebService: (url: string, body: string, success: NativeRequest["success"]) => {
      (url.endsWith("GetAllOdds") ? more : roster).push({ body, success });
    }
  });
  let loaderId = "document-a";
  const observer = new NetworkObserver({ observerSessionId: "worker-a", forward: async () => undefined,
    sendCommand: async (_tab, method, params) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "odds", loaderId,
        url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx" } } };
      if (method === "Runtime.evaluate" && params?.expression === CMD_FULL_BASELINE_EXPRESSION) {
        // End this bounded control attempt after the actual native collector ran.
        return { result: { value: "function-unavailable" } };
      }
      if (method === "Runtime.evaluate" && typeof params?.expression === "string") {
        return { result: { value: vm.runInContext(params.expression, context) } };
      }
      return {};
    }
  });
  const bind = (id = 7) => observer.handleEvent(source, "Runtime.executionContextCreated", {
    context: { id, auxData: { frameId: "odds", isDefault: true } }
  });
  const refresh = async () => {
    await observer.recoverCmdCatalog(source);
    await vi.advanceTimersByTimeAsync(0);
  };
  const seed = () => {
    const row = Array<unknown>(91).fill(0);
    Object.assign(row, { 0: 101, 34: groupId, 51: "S" });
    roster.find(r => new URLSearchParams(r.body).get("fc") === "1")!.success({
      a: true, t: 1, data: [], today: [row], f: {}
    });
    roster.find(r => new URLSearchParams(r.body).get("fc") === "6")!.success({
      a: true, t: 2, today: [], f: {}
    });
    more[0]!.success({ d: [groupId, 101, [[0.97, 0.91]], []] });
  };
  return { observer, bind, refresh, seed, roster, more, root,
    setLoader: (value: string) => { loaderId = value; } };
}

describe("CMD native collection across bridge resync", () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("retains completed native owners and original clocks when only the bridge epoch changes", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const h = harness(); await h.bind(); await h.refresh(); h.seed();
    const original = h.root.__fieldlineCmdNativeCatalogV1!.owners.get(groupId)!;
    expect(original.nativeMore.observedAtMs).toBe(1_000);
    vi.setSystemTime(2_000);
    h.observer.beginBridgeSourceEpoch(source.sourceId);
    await h.refresh();
    expect(h.root.__fieldlineCmdNativeCatalogV1!.owners.get(groupId)).toBe(original);
    expect(original.nativeMore.observedAtMs).toBe(1_000);
    expect(h.roster).toHaveLength(2);
    expect(h.more).toHaveLength(1);
    // Retained in-page cache is not a newly observed/forwarded API baseline.
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, 0)).toBe(false);
    h.observer.releaseTab(source.tabId);
  });

  it.each(["source", "loader", "context", "reattach"] as const)(
    "still retires native owners when the %s identity changes", async change => {
      vi.useFakeTimers(); vi.setSystemTime(1_000);
      const h = harness(); await h.bind(); await h.refresh(); h.seed();
      vi.setSystemTime(2_000);
      if (change === "source") h.observer.beginSourceEpoch(source.sourceId);
      if (change === "loader") h.setLoader("document-b");
      if (change === "context") await h.bind(8);
      if (change === "reattach") { h.observer.prepareDebuggerReattach(source.tabId); await h.bind(8); }
      await h.refresh();
      expect(h.root.__fieldlineCmdNativeCatalogV1!.owners.size).toBe(0);
      expect(h.roster).toHaveLength(4);
      h.observer.releaseTab(source.tabId);
    });
});
