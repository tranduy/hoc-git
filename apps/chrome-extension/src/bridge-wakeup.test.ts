import { describe, expect, it, vi } from "vitest";
import { BridgeWakeup } from "./bridge-wakeup.js";

describe("BridgeWakeup", () => {
  it("forces attached sources only on worker start and preserves poller cadence on alarms", async () => {
    let wake: (() => void) | undefined;
    const calls: string[] = [];
    const reconcileTabs = vi.fn(async () => { calls.push("reconcile"); });
    const ensureConnected = vi.fn(async () => { calls.push("connect"); return true; });
    const ensureAttached = vi.fn(async () => { calls.push("attach"); return ["chrome:IM:7"]; });
    const pollNow = vi.fn((_sourceIds?: readonly string[]) => { calls.push("poll"); });
    new BridgeWakeup({
      attachWake: (next) => { wake = next; },
      reconcileTabs,
      ensureConnected,
      ensureAttached,
      pollNow
    }).start();

    await vi.waitFor(() => expect(calls).toEqual(["connect", "reconcile", "attach", "poll"]));
    wake?.();
    await vi.waitFor(() => expect(calls).toEqual([
      "connect", "reconcile", "attach", "poll", "connect", "reconcile", "attach", "poll"
    ]));
    expect(pollNow).toHaveBeenCalledTimes(2);
    expect(pollNow).toHaveBeenNthCalledWith(1, ["chrome:IM:7"]);
    expect(pollNow).toHaveBeenNthCalledWith(2);
  });

  it("connects before a stalled tab reconciliation can block worker startup", () => {
    const ensureConnected = vi.fn(async () => true);
    const reconcileTabs = vi.fn(() => new Promise<void>(() => undefined));
    const ensureAttached = vi.fn(async () => ["chrome:IM:7"]);
    const pollNow = vi.fn();
    const wakeup = new BridgeWakeup({
      attachWake: vi.fn(),
      reconcileTabs,
      ensureConnected,
      ensureAttached,
      pollNow
    });

    void wakeup.wakeNow(true);

    expect(ensureConnected).toHaveBeenCalledTimes(1);
    expect(reconcileTabs).not.toHaveBeenCalled();
    expect(ensureAttached).not.toHaveBeenCalled();
    expect(pollNow).not.toHaveBeenCalled();
  });

  it("keeps waking on later alarms after a wake hangs forever", async () => {
    vi.useFakeTimers();
    try {
      let wake: (() => void) | undefined;
      // A chrome.debugger command against an unresponsive tab never settles.
      // Without a bound, the in-flight latch is held for the life of the
      // service worker and every later alarm becomes a silent no-op, so the
      // bridge stays disconnected until someone reloads the extension.
      const ensureConnected = vi.fn(async () => true);
      const ensureAttached = vi.fn(() => new Promise<string[]>(() => undefined));
      const wakeup = new BridgeWakeup({
        attachWake: (next) => { wake = next; },
        ensureConnected,
        ensureAttached,
        pollNow: vi.fn()
      });
      wakeup.start();

      await vi.advanceTimersByTimeAsync(1);
      expect(ensureConnected).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      wake?.();
      await vi.advanceTimersByTimeAsync(1);

      expect(ensureConnected).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("bridge rebuild watchdog", () => {
  it("forces a rebuild once the bridge has been silent past the limit", async () => {
    // Belt and braces for the failure that ends every source at once: whatever
    // latch or lost timer caused it, a bridge that has said nothing for minutes
    // must be torn down and rebuilt rather than waited on.
    const rebuilds: number[] = [];
    let contactAgeMs = 10_000;
    const wakeup = new BridgeWakeup({
      attachWake: vi.fn(),
      ensureConnected: vi.fn(async () => true),
      pollNow: vi.fn(),
      bridgeContactAgeMs: () => contactAgeMs,
      rebuildBridge: async () => { rebuilds.push(contactAgeMs); },
      rebuildAfterMs: 180_000
    });

    await wakeup.wakeNow();
    expect(rebuilds).toEqual([]);

    contactAgeMs = 180_001;
    await wakeup.wakeNow();
    expect(rebuilds).toEqual([180_001]);
  });

  it("never rebuilds while the bridge is still in contact", async () => {
    const rebuilds: number[] = [];
    const wakeup = new BridgeWakeup({
      attachWake: vi.fn(),
      ensureConnected: vi.fn(async () => true),
      pollNow: vi.fn(),
      bridgeContactAgeMs: () => 179_999,
      rebuildBridge: async () => { rebuilds.push(1); },
      rebuildAfterMs: 180_000
    });

    await wakeup.wakeNow();
    expect(rebuilds).toEqual([]);
  });
});

describe("watchdog on a bridge that does not exist", () => {
  it("rebuilds when there is no bridge at all", async () => {
    // The worst case is no bridge object: the worker restarted and its configure
    // never completed. Reporting that as "contacted infinitely recently" made the
    // watchdog skip exactly the case it exists for.
    const rebuilds: number[] = [];
    const wakeup = new BridgeWakeup({
      attachWake: vi.fn(),
      ensureConnected: vi.fn(async () => true),
      pollNow: vi.fn(),
      bridgeContactAgeMs: () => Number.POSITIVE_INFINITY,
      rebuildBridge: async () => { rebuilds.push(1); },
      rebuildAfterMs: 180_000
    });

    await wakeup.wakeNow();

    expect(rebuilds).toEqual([1]);
  });
});
