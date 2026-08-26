import { describe, expect, it, vi } from "vitest";
import { CmdSnapshotPoller, type PollerWorkHealth } from "./cmd-snapshot-poller.js";

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

  it("retries CMD baseline recovery every five seconds before its twenty-second authority deadline", async () => {
    let now = 1_000;
    const refreshCatalog = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "CMD", tabId: 9, hostname: "cgnew.fts368.com", state: "ATTACHED" }],
      capture: vi.fn(async () => undefined), refreshCatalog, now: () => now
    });
    poller.pollNow();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
    now = 5_999;
    poller.pollNow();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
    now = 6_000;
    poller.pollNow();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledTimes(2);
  });

  it("starts bounded CMD recovery immediately without overlapping its normal refresh cadence", async () => {
    let now = 1_000;
    let releaseRecovery!: () => void;
    const pendingRecovery = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const recoverCmdCatalog = vi.fn(async () => pendingRecovery);
    const refreshCatalog = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "CMD", tabId: 9, hostname: "cgnew.fts368.com", state: "ATTACHED" }],
      capture: vi.fn(async () => undefined), recoverCmdCatalog, refreshCatalog, now: () => now
    });

    poller.pollNow();
    await Promise.resolve();
    expect(recoverCmdCatalog).toHaveBeenCalledExactlyOnceWith({
      lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9
    });
    expect(refreshCatalog).not.toHaveBeenCalled();

    now = 16_000;
    poller.pollNow();
    await Promise.resolve();
    expect(recoverCmdCatalog).toHaveBeenCalledTimes(1);
    expect(refreshCatalog).not.toHaveBeenCalled();

    releaseRecovery();
    await new Promise((resolve) => setTimeout(resolve, 0));
    poller.pollNow();
    await Promise.resolve();
    expect(recoverCmdCatalog).toHaveBeenCalledTimes(2);
    expect(refreshCatalog).not.toHaveBeenCalled();
  });

  it("defers CMD DOM capture when authenticated recovery was scheduled in the same tick", async () => {
    let now = 1_000;
    const recoverCmdCatalog = vi.fn(async () => undefined);
    const capture = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "CMD", tabId: 9, hostname: "cgnew.fts368.com", state: "ATTACHED" }],
      capture, recoverCmdCatalog, now: () => now
    });

    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recoverCmdCatalog).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();

    now = 3_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 }, "cgnew.fts368.com"
    );
  });

  it("retries a new TSPORT catalog bootstrap twice before returning to steady DOM capture", async () => {
    let now = 1_000;
    const capture = vi.fn(async () => undefined);
    const refreshCatalog = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "TSPORT", tabId: 11, hostname: "pacific.agenate.com", state: "ATTACHED" }],
      capture, refreshCatalog, now: () => now
    });

    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshCatalog).toHaveBeenCalledExactlyOnceWith({
      lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11
    });
    expect(capture).not.toHaveBeenCalled();

    now = 3_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();

    now = 11_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshCatalog).toHaveBeenCalledTimes(2);
    expect(capture).not.toHaveBeenCalled();

    now = 21_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshCatalog).toHaveBeenCalledTimes(3);
    expect(capture).not.toHaveBeenCalled();

    now = 31_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshCatalog).toHaveBeenCalledTimes(3);
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 }, "pacific.agenate.com"
    );

    now = 61_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshCatalog).toHaveBeenCalledTimes(3);
  });

  it("does not overlap a hung TSPORT bootstrap refresh with DOM capture or another refresh", async () => {
    let now = 1_000;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const capture = vi.fn(async () => undefined);
    const refreshCatalog = vi.fn(async () => pendingRefresh);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "TSPORT", tabId: 11, hostname: "pacific.agenate.com", state: "ATTACHED" }],
      capture, refreshCatalog, now: () => now
    });

    poller.pollNow();
    await Promise.resolve();
    now = 11_000;
    poller.pollNow();
    await Promise.resolve();
    now = 21_000;
    poller.pollNow();
    await Promise.resolve();

    expect(refreshCatalog).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
    releaseRefresh();
  });

  it("starts one new bounded TSPORT refresh window for an explicitly forced source", async () => {
    let now = 1_000;
    const sourceId = "chrome:TSPORT:11";
    const capture = vi.fn(async () => undefined);
    const refreshCatalog = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "TSPORT", tabId: 11, hostname: "pacific.agenate.com", state: "ATTACHED" }],
      capture, refreshCatalog, now: () => now
    });

    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshCatalog).toHaveBeenCalledTimes(1);

    now = 1_001;
    poller.pollNow([sourceId]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshCatalog).toHaveBeenCalledTimes(2);
    expect(refreshCatalog).toHaveBeenLastCalledWith({ lobby: "TSPORT", sourceId, tabId: 11 });
    expect(capture).not.toHaveBeenCalled();

    now = 11_001;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 21_001;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 31_001;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refreshCatalog).toHaveBeenCalledTimes(4);
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      { lobby: "TSPORT", sourceId, tabId: 11 }, "pacific.agenate.com"
    );
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

    now = 11_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("does not DOM-poll websocket-authoritative SABA while polling CMD/TSPORT once per tab", async () => {
    let callback: (() => void) | undefined;
    let scheduledDelayMs: number | undefined;
    let now = 1_000;
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
      now: () => now,
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
    expect(capture).toHaveBeenCalledTimes(2);
    now = 11_000;
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

  it("does not run heavy CMD and TSPORT discovery more than once per ten seconds", async () => {
    let callback: (() => void) | undefined;
    let now = 1_000;
    const maintain = vi.fn(async (_source: { readonly lobby: string; readonly tabId: number }) => undefined);
    const capture = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [
        { lobby: "CMD", tabId: 9, hostname: "cgnew.fts368.com", state: "ATTACHED" },
        { lobby: "TSPORT", tabId: 11, hostname: "pacific.agenate.com", state: "ATTACHED" },
        { lobby: "SABA", tabId: 10, hostname: "sports.example", state: "ATTACHED" }
      ],
      capture, maintain, now: () => now,
      setInterval: (next) => { callback = next; return 1; }
    });

    poller.start();
    callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maintain).toHaveBeenCalledTimes(3);
    expect(capture).toHaveBeenCalledTimes(2);

    now = 3_000;
    callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maintain).toHaveBeenCalledTimes(3);
    expect(capture).toHaveBeenCalledTimes(2);

    now = 11_000;
    callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maintain).toHaveBeenCalledTimes(5);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(maintain.mock.calls.slice(3).map(([source]) => source)).toEqual([
      expect.objectContaining({ lobby: "CMD", tabId: 9 }),
      expect.objectContaining({ lobby: "TSPORT", tabId: 11 })
    ]);

    now = 13_000;
    callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledTimes(4);
  });

  it("does not rescan complete CMD and TSPORT DOM catalogs on every two-second heartbeat", async () => {
    let now = 1_000;
    const capture = vi.fn(async () => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [
        { lobby: "CMD", tabId: 9, hostname: "cgnew.fts368.com", state: "ATTACHED" },
        { lobby: "TSPORT", tabId: 11, hostname: "pacific.agenate.com", state: "ATTACHED" }
      ],
      capture,
      now: () => now
    });

    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledTimes(2);

    now = 3_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledTimes(2);

    now = 11_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledTimes(4);
  });

  it("backs off a failed DOM capture instead of retrying heavy work every heartbeat", async () => {
    let now = 1_000;
    const capture = vi.fn()
      .mockRejectedValueOnce(new Error("capture-failed"))
      .mockResolvedValue(undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "TSPORT", tabId: 11, hostname: "pacific.agenate.com", state: "ATTACHED" }],
      capture, now: () => now
    });

    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledTimes(1);

    now = 3_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledTimes(1);

    now = 11_000;
    poller.pollNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("does not let an old source block a new lobby that reuses the same tab id", async () => {
    let now = 1_000;
    let tabs: Array<{ readonly lobby: "CMD" | "TSPORT"; readonly tabId: number;
      readonly hostname: string; readonly state: "ATTACHED" }> = [
      { lobby: "CMD", tabId: 9, hostname: "cgnew.fts368.com", state: "ATTACHED" }
    ];
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const maintain = vi.fn(async () => pending);
    const capture = vi.fn(async () => pending);
    const poller = new CmdSnapshotPoller({ list: () => tabs, capture, maintain, now: () => now });

    poller.pollNow();
    await Promise.resolve();
    expect(maintain).toHaveBeenCalledExactlyOnceWith(
      { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 }
    );
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 }, "cgnew.fts368.com"
    );

    tabs = [{ lobby: "TSPORT", tabId: 9, hostname: "pacific.agenate.com", state: "ATTACHED" }];
    now = 2_000;
    poller.pollNow();
    await Promise.resolve();

    expect(maintain).toHaveBeenLastCalledWith(
      { lobby: "TSPORT", sourceId: "chrome:TSPORT:9", tabId: 9 }
    );
    expect(capture).toHaveBeenLastCalledWith(
      { lobby: "TSPORT", sourceId: "chrome:TSPORT:9", tabId: 9 }, "pacific.agenate.com"
    );
    expect(maintain).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(2);

    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("keeps BTI evidence within five seconds without refetching its large lists every heartbeat", async () => {
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
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
    now = 5_000;
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

  it("does not let a hung IM reconciliation block the independent TSPORT catalog refresh", async () => {
    let releaseIm!: () => void;
    const hungIm = new Promise<void>((resolve) => { releaseIm = resolve; });
    const capture = vi.fn(async () => undefined);
    const refreshCatalog = vi.fn(async (source: { readonly lobby: string }) => {
      if (source.lobby === "IM") await hungIm;
    });
    const poller = new CmdSnapshotPoller({ list: () => [
      { lobby: "IM", tabId: 7, hostname: "imsports.directsb.net", state: "ATTACHED" },
      { lobby: "TSPORT", tabId: 9, hostname: "pacific.agenate.com", state: "ATTACHED" }
    ], capture, refreshCatalog, now: () => 1_000 });
    poller.pollNow();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledWith({ lobby: "IM", sourceId: "chrome:IM:7", tabId: 7 });
    expect(refreshCatalog).toHaveBeenCalledWith({ lobby: "TSPORT", sourceId: "chrome:TSPORT:9", tabId: 9 });
    expect(capture).not.toHaveBeenCalled();
    releaseIm();
  });

  it("releases a refreshCatalog guard that stays hung across twenty ticks", async () => {
    let callback: (() => void) | undefined;
    let now = 0;
    const refreshCatalog = vi.fn(async () => new Promise<void>(() => undefined));
    const reportWorkHealth = vi.fn(async (_source: { readonly sourceId: string }, _health: PollerWorkHealth) => undefined);
    const poller = new CmdSnapshotPoller({
      list: () => [{ lobby: "IM", tabId: 7, hostname: "imsports.directsb.net", state: "ATTACHED" }],
      capture: vi.fn(async () => undefined), refreshCatalog, now: () => now,
      intervalMs: 2_000, imDiscoveryIntervalMs: 1_000,
      reportWorkHealth,
      setInterval: (next) => { callback = next; return 1; }
    });

    poller.start();
    for (let tick = 0; tick < 20; tick += 1) {
      now = tick * 2_000;
      callback?.();
      await Promise.resolve();
    }

    expect(refreshCatalog).toHaveBeenCalledTimes(2);
    expect(reportWorkHealth.mock.calls.some(([, health]) => health.counters.forcedUnlocks === 1 &&
      health.lastOutcome?.outcome === "TIMEOUT")).toBe(true);
  });
});
