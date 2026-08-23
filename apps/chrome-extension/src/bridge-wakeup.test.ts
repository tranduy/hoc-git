import { describe, expect, it, vi } from "vitest";
import { BridgeWakeup } from "./bridge-wakeup.js";

describe("BridgeWakeup", () => {
  it("reconciles, reconnects, reattaches, and polls immediately on worker start and alarm", async () => {
    let listener: ((alarm: { readonly name: string }) => void) | undefined;
    const calls: string[] = [];
    const reconcileTabs = vi.fn(async () => { calls.push("reconcile"); });
    const ensureConnected = vi.fn(async () => { calls.push("connect"); return true; });
    const ensureAttached = vi.fn(async () => { calls.push("attach"); });
    const pollNow = vi.fn(() => { calls.push("poll"); });
    const createAlarm = vi.fn();
    new BridgeWakeup({
      createAlarm,
      addAlarmListener: (next) => { listener = next; },
      reconcileTabs,
      ensureConnected,
      ensureAttached,
      pollNow
    }).start();

    expect(createAlarm).toHaveBeenCalledWith("fieldline-bridge-wakeup", { periodInMinutes: 0.5 });
    await vi.waitFor(() => expect(calls).toEqual(["reconcile", "connect", "attach", "poll"]));
    listener?.({ name: "unrelated" });
    listener?.({ name: "fieldline-bridge-wakeup" });
    await vi.waitFor(() => expect(calls).toEqual([
      "reconcile", "connect", "attach", "poll", "reconcile", "connect", "attach", "poll"
    ]));
    expect(pollNow).toHaveBeenCalledTimes(2);
  });
});
