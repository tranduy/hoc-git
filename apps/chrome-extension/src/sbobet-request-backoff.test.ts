import { describe, expect, it } from "vitest";
import { SbobetRequestBackoff, SBOBET_RETRY_AFTER_EXPRESSION, type SbobetRequestBackoffState } from "./sbobet-request-backoff.js";

describe("shared SBOBET request backoff", () => {
  it("pauses all callers and doubles failed retry windows while preserving longer provider deadlines", () => {
    let now = 1_000;
    const backoff = new SbobetRequestBackoff({ now: () => now });
    for (const expected of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      backoff.fail(503);
      expect(backoff.retryInMs()).toBe(expected);
      expect(backoff.paused()).toBe(true);
      now += expected; expect(backoff.paused()).toBe(false);
    }
    backoff.fail(429, 600_000);
    expect(backoff.retryInMs()).toBe(600_000);
  });

  it("does not let concurrent successes erase a refusal or inflate failures per owner", () => {
    let now = 1_000;
    const backoff = new SbobetRequestBackoff({ now: () => now });
    backoff.fail(503); backoff.fail(503); backoff.succeeded(now);
    expect(backoff.retryInMs()).toBe(30_000);
    now += 30_001; backoff.succeeded(now); backoff.fail(503);
    expect(backoff.retryInMs()).toBe(30_000);
  });

  it("restores an auth cooldown before admitting work after a worker restart", async () => {
    let now = 1_000;
    let saved: SbobetRequestBackoffState | undefined;
    const first = new SbobetRequestBackoff({ now: () => now, save: async state => { saved = state; } });
    first.fail(403); await Promise.resolve(); await Promise.resolve();
    const second = new SbobetRequestBackoff({ now: () => now, load: async () => saved });
    expect(second.paused()).toBe(true);
    await second.ready(); expect(second.retryInMs()).toBe(900_000);
    now += 899_999; expect(second.paused()).toBe(true);
    now += 1; expect(second.paused()).toBe(false);
  });

  it("parses both Retry-After forms without shortening the server's requested pause", () => {
    const now = Date.now();
    const parse = new Function("value", `return ${SBOBET_RETRY_AFTER_EXPRESSION}(value)`);
    expect(parse("600")).toBe(600_000);
    expect(parse(new Date(now + 600_000).toUTCString())).toBeGreaterThan(598_000);
    expect(parse("invalid")).toBe(0);
    expect(parse("1e100")).toBe(0);
  });
});
