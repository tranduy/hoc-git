import { describe, expect, it, vi } from "vitest";
import { BRIDGE_WAKE_ALARM, LOBBY_HEARTBEAT_KIND, WakeTriggers } from "./wake-triggers.js";

function harness(overrides: { readonly now?: () => number; readonly minWakeIntervalMs?: number } = {}) {
  let alarm: ((alarm: { readonly name: string }) => void) | undefined;
  let message: ((message: unknown) => void) | undefined;
  const createAlarm = vi.fn();
  const triggers = new WakeTriggers({
    createAlarm,
    addAlarmListener: (listener) => { alarm = listener; },
    addMessageListener: (listener) => { message = listener; },
    ...overrides
  });
  return {
    triggers,
    createAlarm,
    fireAlarm: (name = BRIDGE_WAKE_ALARM) => alarm?.({ name }),
    sendHeartbeat: () => message?.({ kind: LOBBY_HEARTBEAT_KIND }),
    send: (payload: unknown) => message?.(payload)
  };
}

describe("WakeTriggers", () => {
  it("registers both ways back in as it is constructed, before anything it wakes exists", () => {
    const { createAlarm, fireAlarm, sendHeartbeat } = harness();
    expect(createAlarm).toHaveBeenCalledWith(BRIDGE_WAKE_ALARM, { periodInMinutes: 1 });
    expect(() => { fireAlarm(); sendHeartbeat(); }).not.toThrow();
  });

  it("replays the trigger that started the worker instead of dropping it", () => {
    const { triggers, sendHeartbeat } = harness();
    sendHeartbeat();
    const handler = vi.fn();
    triggers.attach(handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("replays a queued trigger once, however many arrived before the handler", () => {
    const { triggers, sendHeartbeat, fireAlarm } = harness();
    sendHeartbeat();
    fireAlarm();
    sendHeartbeat();
    const handler = vi.fn();
    triggers.attach(handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores alarms it does not own and messages that are not heartbeats", () => {
    const { triggers, fireAlarm, send } = harness();
    const handler = vi.fn();
    triggers.attach(handler);
    fireAlarm("some-other-alarm");
    send({ kind: "SOMETHING_ELSE" });
    send(null);
    send("not-an-object");
    expect(handler).not.toHaveBeenCalled();
  });

  it("collapses the heartbeats every open lobby tab sends into one wake per cadence", () => {
    let clock = 10_000;
    const { triggers, sendHeartbeat } = harness({ now: () => clock, minWakeIntervalMs: 60_000 });
    const handler = vi.fn();
    triggers.attach(handler);

    sendHeartbeat();
    expect(handler).toHaveBeenCalledTimes(1);
    sendHeartbeat();
    sendHeartbeat();
    expect(handler).toHaveBeenCalledTimes(1);

    clock += 60_000;
    sendHeartbeat();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("wakes on the first heartbeat a freshly started worker sees", () => {
    const { triggers, sendHeartbeat } = harness({ now: () => 1_000_000, minWakeIntervalMs: 60_000 });
    const handler = vi.fn();
    triggers.attach(handler);
    sendHeartbeat();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("never throttles the alarm, which is the fallback when heartbeats stop", () => {
    let clock = 0;
    const { triggers, fireAlarm } = harness({ now: () => clock, minWakeIntervalMs: 60_000 });
    const handler = vi.fn();
    triggers.attach(handler);
    fireAlarm();
    clock += 1_000;
    fireAlarm();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("keeps waking after a wake throws", () => {
    const { triggers, fireAlarm } = harness();
    const handler = vi.fn(() => { throw new Error("wake failed"); });
    triggers.attach(handler);
    expect(() => fireAlarm()).not.toThrow();
    expect(() => fireAlarm()).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
