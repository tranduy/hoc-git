import { describe, expect, it, vi } from "vitest";
import { CmdSnapshotPoller } from "./cmd-snapshot-poller.js";

describe("CmdSnapshotPoller", () => {
  it("can share a proven service-worker heartbeat instead of relying only on its own timer", async () => {
    const refreshCatalog = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "BTI", tabId: 6, hostname: "prod.example.com", state: "ATTACHED" }],
      capture: vi.fn(async () => undefined), refreshCatalog, now: () => 1_000
    });

    poller.pollNow();
    await Promise.resolve();

    expect(refreshCatalog).toHaveBeenCalledTimes(1);
  });

  it("polls a newly reattached BTI source even after a just-completed empty scheduled tick", async () => {
    let callback: (() => void) | undefined;
    let tabs: Array<{ readonly lobby: "BTI"; readonly tabId: number; readonly hostname: string;
      readonly state: "ATTACHED" }> = [];
    let now = 1_000;
    const refreshCatalog = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => tabs,
      capture: vi.fn(async () => undefined), refreshCatalog, now: () => now,
      setInterval: (next) => { callback = next; return 1; }
    });

    poller.start();
    callback?.();
    tabs = [{ lobby: "BTI", tabId: 6, hostname: "prod.example.com", state: "ATTACHED" }];
    now = 1_001;
    poller.pollNow();
    await Promise.resolve();

    expect(refreshCatalog).toHaveBeenCalledExactlyOnceWith({
      lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6
    });
  });

  it("keeps both BTI and the current HTTP-based SBOBET catalog fresh", async () => {
    const refreshCatalog = vi.fn(async (_source: { readonly lobby: string; readonly sourceId: string;
      readonly tabId: number }) => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [
        { lobby: "BTI", tabId: 6, hostname: "prod.example.com", state: "ATTACHED" },
        { lobby: "KSPORT", tabId: 8, hostname: "sbobet.example", state: "ATTACHED" }
      ],
      capture: vi.fn(async () => undefined), refreshCatalog, now: () => 1_000
    });

    poller.pollNow();
    await Promise.resolve();

    expect(refreshCatalog.mock.calls.map(([source]) => source)).toEqual([
      { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 },
      { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 }
    ]);
  });

  it("re-requests IM's signed GetSE catalog on its slower cadence instead of once per reconnect", async () => {
    let now = 1_000;
    const refreshCatalog = vi.fn(async (_source: { readonly lobby: string; readonly sourceId: string;
      readonly tabId: number }) => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "IM", tabId: 7, hostname: "imsports.directsb.net", state: "ATTACHED" }],
      capture: vi.fn(async () => undefined), refreshCatalog, now: () => now, imDiscoveryIntervalMs: 15_000
    });

    poller.pollNow();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledExactlyOnceWith({ lobby: "IM", sourceId: "chrome:IM:7", tabId: 7 });

    now = 11_000;
    poller.pollNow();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledTimes(1);

    now = 16_500;
    poller.pollNow();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledTimes(2);
  });

  it("forces an explicitly reattached same-ID source despite recent cadence and in-flight attribution", async () => {
    let now = 1_000;
    let release!: () => void;
    const oldRefresh = new Promise<void>((resolve) => { release = resolve; });
    const refreshCatalog = vi.fn()
      .mockImplementationOnce(async () => oldRefresh)
      .mockImplementation(async () => undefined);
    const sourceId = "chrome:IM:7";
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "IM", tabId: 7, hostname: "imsports.directsb.net", state: "ATTACHED" }],
      capture: vi.fn(async () => undefined), refreshCatalog, now: () => now, imDiscoveryIntervalMs: 15_000
    });

    poller.pollNow();
    await Promise.resolve();
    now = 1_001;
    poller.pollNow([sourceId]);
    await vi.waitFor(() => expect(refreshCatalog).toHaveBeenCalledTimes(2));
    release();
  });

  it("coalesces a heartbeat wake-up with a just-completed scheduled catalog poll", async () => {
    let callback: (() => void) | undefined;
    let now = 1_000;
    const capture = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "CMD", tabId: 9, hostname: "cgnew.fts368.com", state: "ATTACHED" }],
      capture, now: () => now,
      setInterval: (next) => { callback = next; return 1; }
    });

    poller.start();
    callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledTimes(1);

    now = 3_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("does not DOM-poll websocket-authoritative SABA while polling CMD/TSPORT once per tab", async () => {
    let callback: (() => void) | undefined;
    let scheduledDelayMs: number | undefined;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const capture = vi.fn(async () => pending);
    const poller = new CmdSnapshotPoller({
      list: () => [
        { lobby: "CMD", tabId: 9, hostname: "cgnew.fts368.com", state: "ATTACHED" },
        { lobby: "SABA", tabId: 10, hostname: "sports.example", state: "ATTACHED" },
        { lobby: "TSPORT", tabId: 11, hostname: "pacific.agenate.com", state: "ATTACHED" }
      ],
      capture,
      setInterval: (next, delayMs) => { callback = next; scheduledDelayMs = delayMs; return 1; },
      clearInterval: vi.fn()
    });
    poller.start();
    expect(scheduledDelayMs).toBe(2_000);
    callback?.();
    callback?.();
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledWith(
      { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 }, "cgnew.fts368.com"
    );
    expect(capture).toHaveBeenCalledWith(
      { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 }, "pacific.agenate.com"
    );
    expect(capture).not.toHaveBeenCalledWith(
      { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 }, "sports.example"
    );
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    callback?.();
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(4);
  });

  it("does not replay cached provider snapshots during periodic live polling", async () => {
    let callback: (() => void) | undefined;
    let now = 1_000;
    const replaySnapshots = vi.fn(async () => true);
    const poller = new CmdSnapshotPoller({
      list: () => [], capture: vi.fn(async () => undefined), replaySnapshots,
      now: () => now,
      setInterval: (next) => { callback = next; return 1; }
    });

    poller.start();
    callback?.();
    await Promise.resolve();
    expect(replaySnapshots).not.toHaveBeenCalled();
    now = 59_999;
    callback?.();
    await Promise.resolve();
    expect(replaySnapshots).not.toHaveBeenCalled();
    now = 61_000;
    callback?.();
    await Promise.resolve();
    expect(replaySnapshots).not.toHaveBeenCalled();
  });

  it("keeps every attached provider tab active on a bounded cadence", async () => {
    let callback: (() => void) | undefined;
    let now = 1_000;
    const maintain = vi.fn(async (_source: { readonly lobby: string; readonly tabId: number }) => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [
        { lobby: "IM", tabId: 4, hostname: "imsports.directsb.net", state: "ATTACHED" },
        { lobby: "SABA", tabId: 5, hostname: "sports.example", state: "ATTACHED" }
      ],
      capture: vi.fn(async () => undefined), maintain, now: () => now,
      setInterval: (next) => { callback = next; return 1; }
    });

    poller.start();
    callback?.();
    await Promise.resolve();
    expect(maintain).toHaveBeenCalledTimes(2);
    now = 59_999;
    callback?.();
    await Promise.resolve();
    expect(maintain).toHaveBeenCalledTimes(2);
    now = 61_000;
    callback?.();
    await Promise.resolve();
    expect(maintain).toHaveBeenCalledTimes(4);
  });

  it("reacquires both IM market partitions every fifteen seconds", async () => {
    let now = 1_000;
    const maintain = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [
        { lobby: "IM", tabId: 4, hostname: "imsports.directsb.net", state: "ATTACHED" },
        { lobby: "SABA", tabId: 5, hostname: "sports.example", state: "ATTACHED" }
      ],
      capture: vi.fn(async () => undefined), maintain, now: () => now
    });

    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maintain).toHaveBeenCalledTimes(2);

    now = 15_999;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maintain).toHaveBeenCalledTimes(2);

    now = 16_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maintain).toHaveBeenCalledTimes(3);
    expect(maintain).toHaveBeenLastCalledWith(
      { lobby: "IM", sourceId: "chrome:IM:4", tabId: 4 }
    );
  });

  it("advances virtualized CMD and TSPORT tables on every snapshot cadence while other tabs stay bounded", async () => {
    let callback: (() => void) | undefined;
    let now = 1_000;
    const maintain = vi.fn(async (_source: { readonly lobby: string; readonly tabId: number }) => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [
        { lobby: "CMD", tabId: 9, hostname: "cgnew.fts368.com", state: "ATTACHED" },
        { lobby: "TSPORT", tabId: 11, hostname: "pacific.agenate.com", state: "ATTACHED" },
        { lobby: "SABA", tabId: 10, hostname: "sports.example", state: "ATTACHED" }
      ],
      capture: vi.fn(async () => undefined), maintain, now: () => now,
      setInterval: (next) => { callback = next; return 1; }
    });

    poller.start();
    callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maintain).toHaveBeenCalledTimes(3);

    now = 3_000;
    callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maintain).toHaveBeenCalledTimes(5);
    expect(maintain.mock.calls.slice(3).map(([source]) => source)).toEqual([
      expect.objectContaining({ lobby: "CMD", tabId: 9 }),
      expect.objectContaining({ lobby: "TSPORT", tabId: 11 })
    ]);
  });

  it("checks SABA's page-side odds mutation flag on the fast cadence without running the full collector", async () => {
    let callback: (() => void) | undefined;
    let now = 1_000;
    const maintain = vi.fn(async () => undefined);
    const pollSabaDomChanges = vi.fn(async () => undefined);
    const capture = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "SABA", tabId: 10, hostname: "sports.example", state: "ATTACHED" }],
      capture, maintain, pollSabaDomChanges, now: () => now,
      setInterval: (next) => { callback = next; return 1; }
    });

    poller.start();
    callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maintain).toHaveBeenCalledTimes(1);
    expect(pollSabaDomChanges).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();

    now = 3_000;
    callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maintain).toHaveBeenCalledTimes(1);
    expect(pollSabaDomChanges).toHaveBeenCalledTimes(2);
  });

  it("requests genuine provider catalogs every two seconds without overlapping a tab", async () => {
    let callback: (() => void) | undefined;
    let now = 1_000;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const refreshCatalog = vi.fn(async () => pending);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "BTI", tabId: 6, hostname: "prod.example.com", state: "ATTACHED" }],
      capture: vi.fn(async () => undefined), refreshCatalog, now: () => now,
      setInterval: (next) => { callback = next; return 1; }
    });

    poller.start();
    callback?.();
    callback?.();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
    now = 3_000;
    callback?.();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    callback?.();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledTimes(2);
  });

  it("does not let a slow keep-active task block BTI catalog refreshes", async () => {
    let callback: (() => void) | undefined;
    let releaseMaintenance: (() => void) | undefined;
    const pendingMaintenance = new Promise<void>((resolve) => { releaseMaintenance = resolve; });
    const maintain = vi.fn(async () => pendingMaintenance);
    const refreshCatalog = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "BTI", tabId: 6, hostname: "prod.example.com", state: "ATTACHED" }],
      capture: vi.fn(async () => undefined), maintain, refreshCatalog,
      now: () => 1_000,
      setInterval: (next) => { callback = next; return 1; }
    });

    poller.start();
    callback?.();
    await Promise.resolve();

    expect(maintain).toHaveBeenCalledTimes(1);
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
    releaseMaintenance?.();
  });
});
