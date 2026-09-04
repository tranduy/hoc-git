import { describe, expect, it, vi } from "vitest";
import { BtiPageRecoveryWatchdog, parseBtiPageHealthProbe } from "./bti-page-health.js";

const failedPage = {
  sourceId: "chrome:BTI:7",
  tabId: 7,
  status: "AUTH_ERROR",
  code: "1008"
} as const;

describe("BTI page health", () => {
  it("accepts only the bounded auth-error probe shape", () => {
    expect(parseBtiPageHealthProbe({ status: "AUTH_ERROR", code: "1008" }))
      .toEqual({ status: "AUTH_ERROR", code: "1008" });
    expect(parseBtiPageHealthProbe({ status: "AUTH_ERROR", code: "9999" })).toBeNull();
    expect(parseBtiPageHealthProbe("1008 login failed token=secret")).toBeNull();
  });

  it("reloads the exact failed tab immediately and rate-limits repeated samples", async () => {
    let now = 1_000;
    const reload = vi.fn(async (_source: { readonly sourceId: string; readonly tabId: number }) => undefined);
    const watchdog = new BtiPageRecoveryWatchdog({ reload, now: () => now });

    await watchdog.observe(failedPage);
    await watchdog.observe(failedPage);
    expect(reload).toHaveBeenCalledExactlyOnceWith({ sourceId: "chrome:BTI:7", tabId: 7 });

    now += 5 * 60_000;
    await watchdog.observe(failedPage);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("re-arms after the same page is healthy", async () => {
    const reload = vi.fn(async () => undefined);
    const watchdog = new BtiPageRecoveryWatchdog({ reload });

    await watchdog.observe(failedPage);
    await watchdog.observe({ ...failedPage, status: "HEALTHY", code: null });
    await watchdog.observe(failedPage);

    expect(reload).toHaveBeenCalledTimes(2);
  });
});
