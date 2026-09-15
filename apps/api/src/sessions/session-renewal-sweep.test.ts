import { describe, expect, it, vi } from "vitest";
import type { RedactedSessionStatus } from "@tool-chenh/contracts";
import { createSessionRenewalSweep, sessionsDueForRenewal } from "./session-renewal-sweep.js";

const NOW = 1_700_000_000_000;

const session = (changes: Partial<RedactedSessionStatus> = {}): RedactedSessionStatus => ({
  id: "fabet-parent", provider: "FABET", category: "FOOTBALL", source: "FABET_LOGIN",
  state: "ACTIVE", trustedHostname: "fabet.monster", acquiredAtMs: NOW - 86_400_000,
  lastValidatedAtMs: NOW - 86_400_000, renewAfterMs: NOW - 1, nextRetryAtMs: null,
  secretConfigured: true, reason: null, ...changes
});

describe("sessionsDueForRenewal", () => {
  it("renews a credential parent that outlived its own deadline", () => {
    // Measured 2026-09-15: this session was 28.4 hours past renewal and nothing
    // in the process was looking at that number.
    expect(sessionsDueForRenewal([session()], NOW)).toEqual(["fabet-parent"]);
  });

  it("leaves a parent inside its deadline alone", () => {
    expect(sessionsDueForRenewal([session({ renewAfterMs: NOW + 1 })], NOW)).toEqual([]);
  });

  it("never starts a second renewal on top of one in flight", () => {
    expect(sessionsDueForRenewal([session({ state: "RENEWING" })], NOW)).toEqual([]);
  });

  it("retries a failed parent only once its backoff has passed", () => {
    const failed = session({ state: "INVALID", reason: "AUTH_BACKOFF", nextRetryAtMs: NOW + 1 });
    expect(sessionsDueForRenewal([failed], NOW)).toEqual([]);
    expect(sessionsDueForRenewal([{ ...failed, nextRetryAtMs: NOW }], NOW)).toEqual(["fabet-parent"]);
  });

  it("ignores the derived children, which the parent republishes", () => {
    // Children hold launch URLs, not credentials. Renewing one concurrently
    // expires it before the parent can preserve its verified identity.
    const child = session({ id: "saba-child", provider: "SABA", state: "ACTION_REQUIRED" });
    expect(sessionsDueForRenewal([child], NOW)).toEqual([]);
  });

  it("ignores sessions that are not Fabet logins at all", () => {
    const manual = session({ id: "manual", source: "MANUAL_PROVIDER_SESSION", provider: "SBOBET" });
    expect(sessionsDueForRenewal([manual], NOW)).toEqual([]);
  });
});

describe("createSessionRenewalSweep", () => {
  const sweepWith = (renew: (id: string) => Promise<RedactedSessionStatus>,
    sessions: readonly RedactedSessionStatus[] = [session()]) => {
    const records: string[] = [];
    const value = createSessionRenewalSweep({
      list: async () => sessions, renew, clock: { nowMs: () => NOW },
      record: (level, message) => { records.push(`${level}:${message}`); }
    });
    return { value, records };
  };

  it("renews a due session and restarts no reader", async () => {
    const renew = vi.fn(async (id: string) => session({ id, renewAfterMs: NOW + 86_400_000 }));
    const { value, records } = sweepWith(renew);

    await expect(value.runOnce()).resolves.toBe(1);
    expect(renew).toHaveBeenCalledExactlyOnceWith("fabet-parent");
    expect(records).toEqual([expect.stringContaining("INFO:")]);
  });

  it("says so when a renewal is refused instead of failing quietly", async () => {
    // The whole defect was a dead session with no record that it died.
    const renew = async (id: string) =>
      session({ id, state: "ACTION_REQUIRED", reason: "INTERACTIVE_AUTH_REQUIRED" });
    const { value, records } = sweepWith(renew);

    await expect(value.runOnce()).resolves.toBe(0);
    expect(records).toEqual([expect.stringContaining("WARN:")]);
    expect(records[0]).toContain("INTERACTIVE_AUTH_REQUIRED");
  });

  it("records a thrown renewal rather than letting it escape the timer", async () => {
    const { value, records } = sweepWith(async () => { throw new Error("FABET_SESSION_UNAVAILABLE"); });

    await expect(value.runOnce()).resolves.toBe(0);
    expect(records[0]).toContain("ERROR:");
    expect(records[0]).toContain("FABET_SESSION_UNAVAILABLE");
  });

  it("does not stack sweeps when one is still running", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const renew = vi.fn(async (id: string) => { await gate; return session({ id }); });
    const { value } = sweepWith(renew);

    const first = value.runOnce();
    const second = value.runOnce();
    expect(second).toBe(first);
    release?.();
    await first;
    expect(renew).toHaveBeenCalledOnce();
  });

  it("touches nothing when no session is due", async () => {
    const renew = vi.fn(async (id: string) => session({ id }));
    const { value, records } = sweepWith(renew, [session({ renewAfterMs: NOW + 1 })]);

    await expect(value.runOnce()).resolves.toBe(0);
    expect(renew).not.toHaveBeenCalled();
    expect(records).toEqual([]);
  });

  it("stops cleanly and arms only one timer", () => {
    const cleared: unknown[] = [];
    const value = createSessionRenewalSweep({
      list: async () => [], renew: async (id) => session({ id }),
      setTimer: () => "timer-1", clearTimer: (timer) => { cleared.push(timer); }
    });

    value.start();
    value.start();
    value.stop();
    value.stop();
    expect(cleared).toEqual(["timer-1"]);
  });
});

describe("backoff the sweep owns", () => {
  const failing = (state: RedactedSessionStatus["state"], reason: string) =>
    async (id: string): Promise<RedactedSessionStatus> =>
      ({ ...session({ id }), state, reason } as RedactedSessionStatus);

  it("stops asking at full cadence when the answer cannot change", async () => {
    // session-manager writes nextRetryAtMs when its own Fabet parent renewal
    // fails, but renew() does not, so a sweep honouring only nextRetryAtMs
    // retries forever. Measured 2026-09-16: eight identical
    // AUTH_EGRESS_UNAVAILABLE entries in one hour, five minutes apart, each a
    // login attempt that could not have succeeded.
    let now = NOW;
    const renew = vi.fn(failing("INVALID", "AUTH_EGRESS_UNAVAILABLE"));
    const records: string[] = [];
    const value = createSessionRenewalSweep({
      list: async () => [session()], renew, clock: { nowMs: () => now },
      record: (level, message) => { records.push(`${level}:${message}`); }
    });

    await value.runOnce();
    expect(renew).toHaveBeenCalledOnce();

    // Inside the window the sweep asks nothing and says nothing.
    now += 299_000;
    await value.runOnce();
    expect(renew).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);

    now += 2_000;
    await value.runOnce();
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it("names the wait so a quiet journal is not mistaken for a quiet failure", async () => {
    const records: string[] = [];
    const value = createSessionRenewalSweep({
      list: async () => [session()], renew: failing("INVALID", "AUTH_EGRESS_UNAVAILABLE"),
      clock: { nowMs: () => NOW }, record: (level, message) => { records.push(`${level}:${message}`); }
    });
    await value.runOnce();
    expect(records[0]).toContain("AUTH_EGRESS_UNAVAILABLE");
    expect(records[0]).toContain("5 phút");
  });

  it("forgets the backoff the moment a renewal works", async () => {
    let now = NOW;
    let succeed = false;
    const renew = vi.fn(async (id: string) => succeed
      ? session({ id, renewAfterMs: now + 86_400_000 })
      : ({ ...session({ id }), state: "INVALID", reason: "AUTH_EGRESS_UNAVAILABLE" } as RedactedSessionStatus));
    const value = createSessionRenewalSweep({
      list: async () => [session()], renew, clock: { nowMs: () => now }
    });
    await value.runOnce();
    succeed = true;
    now += 300_000;
    await value.runOnce();
    now += 1_000;
    await value.runOnce();
    expect(renew).toHaveBeenCalledTimes(3);
  });
});
