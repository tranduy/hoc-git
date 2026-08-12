import { describe, expect, it } from "vitest";
import { ExecutionSafetyGate } from "./execution-safety-gate.js";

describe("ExecutionSafetyGate", () => {
  it("is disabled by default and never issues an arm token", () => {
    const gate = new ExecutionSafetyGate();
    expect(() => gate.arm("ticket-1", "ARM ticket-1")).toThrow("LIVE_EXECUTION_DISABLED");
  });

  it("requires an exact confirmation and consumes a short-lived token once", () => {
    let now = 1000;
    const gate = new ExecutionSafetyGate({ enabled: true, clock: { nowMs: () => now },
      ttlMs: 1000, tokenFactory: () => "arm-token-123456" });
    expect(() => gate.arm("ticket-1", "yes")).toThrow("LIVE_CONFIRMATION_INVALID");
    const token = gate.arm("ticket-1", "ARM ticket-1");
    expect(gate.consume("ticket-2", token)).toBe(false);
    expect(gate.consume("ticket-1", token)).toBe(true);
    expect(gate.consume("ticket-1", token)).toBe(false);
    const expired = gate.arm("ticket-1", "ARM ticket-1"); now = 2001;
    expect(gate.consume("ticket-1", expired)).toBe(false);
  });

  it("latches the kill switch and invalidates every outstanding arm", () => {
    const gate = new ExecutionSafetyGate({ enabled: true, clock: { nowMs: () => 1000 },
      tokenFactory: () => "arm-token-123456" });
    const token = gate.arm("ticket-1", "ARM ticket-1");
    gate.trip("PARTIAL_FAILURE");
    expect(gate.status()).toEqual({ enabled: true, killSwitchTripped: true, reason: "PARTIAL_FAILURE" });
    expect(gate.consume("ticket-1", token)).toBe(false);
    expect(() => gate.arm("ticket-2", "ARM ticket-2")).toThrow("LIVE_KILL_SWITCH_TRIPPED");
  });
});
