import { describe, expect, it, vi } from "vitest";
import { BridgeWakeup } from "./bridge-wakeup.js";

describe("BridgeWakeup", () => {
  it("uses a Chrome alarm to reconnect after the MV3 worker sleeps", async () => {
    let listener: ((alarm: { readonly name: string }) => void) | undefined;
    const ensureConnected = vi.fn(async () => true);
    const ensureAttached = vi.fn(async () => undefined);
    const createAlarm = vi.fn();
    new BridgeWakeup({
      createAlarm,
      addAlarmListener: (next) => { listener = next; },
      ensureConnected,
      ensureAttached
    }).start();

    expect(createAlarm).toHaveBeenCalledWith("fieldline-bridge-wakeup", { periodInMinutes: 0.5 });
    listener?.({ name: "unrelated" });
    listener?.({ name: "fieldline-bridge-wakeup" });
    await Promise.resolve();
    expect(ensureConnected).toHaveBeenCalledTimes(1);
    expect(ensureAttached).toHaveBeenCalledTimes(1);
  });
});
