import { describe, expect, it } from "vitest";
import { recoveryDelayMs, requiresAuthentication, type RecoverySignal } from "./session-recovery-policy.js";

describe("requiresAuthentication", () => {
  it.each<RecoverySignal>([
    { kind: "AUTH_EXPIRED", status: 401 },
    { kind: "AUTH_EXPIRED", status: 403 },
    { kind: "LOGIN_PAGE" },
    { kind: "TOKEN_EXPIRED", expiredAtMs: 999 }
  ])("requires login for verified authentication evidence %#", (signal) => {
    expect(requiresAuthentication(signal, 1_000)).toBe(true);
  });

  it.each<RecoverySignal>([
    { kind: "EMPTY_CATALOG" },
    { kind: "SCHEMA_ERROR" },
    { kind: "TIMEOUT" },
    { kind: "TOKEN_EXPIRED", expiredAtMs: 1_001 }
  ])("does not turn an ordinary catalog failure into a login %#", (signal) => {
    expect(requiresAuthentication(signal, 1_000)).toBe(false);
  });
});

describe("recoveryDelayMs", () => {
  it.each([
    [0, 5_000],
    [1, 15_000],
    [2, 60_000],
    [3, 300_000],
    [99, 300_000]
  ])("uses capped backoff for failure count %i", (failures, expected) => {
    expect(recoveryDelayMs(failures, 0)).toBe(expected);
  });

  it("bounds jitter to twenty percent", () => {
    expect(recoveryDelayMs(0, 1)).toBe(6_000);
    expect(recoveryDelayMs(0, 2)).toBe(6_000);
    expect(recoveryDelayMs(0, -1)).toBe(5_000);
  });
});
