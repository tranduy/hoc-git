import { describe, expect, it, vi } from "vitest";
import { BTI_PAGE_HEALTH_EXPRESSION, BtiPageRecoveryWatchdog, btiHardRecoveryAction, btiSourceControlAction,
  parseBtiPageHealthProbe } from "./bti-page-health.js";

const failedPage = {
  sourceId: "chrome:BTI:7",
  tabId: 7,
  status: "AUTH_ERROR",
  code: "1008"
} as const;

describe("BTI page health", () => {
  it("preserves bounded current detail diagnostics through the actual page expression", () => {
    const coverage = { phase: "COMPLETE", liveLeagues: 10, prematchLeagues: 10,
      earlyLeagues: 178, earlyBatches: 18, earlyDone: 18,
      liveBatches: 1, prematchBatches: 1, liveDone: 1, prematchDone: 1, failed: 0,
      events: 196, namedEvents: 196, timedEvents: 196, marketEvents: 196, validEvents: 196,
      detailCachedEvents: 159, detailCachedBytes: 150_000_000, detailPendingEvents: 0,
      detailRosterEvents: 159, detailEmptyEvents: 1, detailFailedEvents: 0,
      detailEvictedEvents: 0, detailCoverageComplete: true, detailQueuedEvents: 0,
      detailInFlightEvents: 0, detailOldestReceiptAgeMs: 60_000,
      detailNearTtlMs: 12_000, detailDistantTtlMs: 60_000, detailDueEvents: 0,
      detailDeferredEvents: 0, detailRetainedEventCap: 2048, detailQueueCap: 128,
      detailOverCapEvents: 0, rosterRefreshFailed: false };
    const run = new Function("document", `return ${BTI_PAGE_HEALTH_EXPRESSION}`);
    const value = run({ readyState: "complete", body: { innerText: "BTI football" },
      documentElement: { dataset: { fieldlineBtiRosterCoverage: JSON.stringify(coverage) } } });
    const parsed = parseBtiPageHealthProbe(value);
    expect(parsed?.status).toBe("HEALTHY");
    expect(JSON.parse(parsed!.rosterCoverage!)).toMatchObject(coverage);
  });
  it("accepts only the bounded auth-error probe shape", () => {
    expect(parseBtiPageHealthProbe({ status: "AUTH_ERROR", code: "1008" }))
      .toEqual({ status: "AUTH_ERROR", code: "1008" });
    expect(parseBtiPageHealthProbe({ status: "AUTH_ERROR", code: "9999" })).toBeNull();
    expect(parseBtiPageHealthProbe("1008 login failed token=secret")).toBeNull();
  });

  it("forwards only bounded numeric BTI roster coverage", () => {
    const rosterCoverage = JSON.stringify({ phase: "HYDRATING", liveLeagues: 321,
      prematchLeagues: 45, liveBatches: 33, prematchBatches: 5, liveDone: 17,
      prematchDone: 5, failed: 0, events: 200, namedEvents: 198, timedEvents: 190,
      marketEvents: 31, validEvents: 188, detailCachedEvents: 171, detailCachedBytes: 9_871_234,
      detailPendingEvents: 29 });
    expect(parseBtiPageHealthProbe({ status: "HEALTHY", code: null, rosterCoverage }))
      .toEqual({ status: "HEALTHY", code: null, rosterCoverage });
    expect(parseBtiPageHealthProbe({ status: "HEALTHY", code: null,
      rosterCoverage: JSON.stringify({ phase: "FAILED", token: "secret" }) })).toBeNull();
  });

  it("keeps hard recovery in-page unless BTI proves an authentication failure", () => {
    expect(btiHardRecoveryAction({ status: "HEALTHY", code: null })).toBe("REFRESH");
    expect(btiHardRecoveryAction({ status: "UNKNOWN", code: null })).toBe("REFRESH");
    expect(btiHardRecoveryAction({ status: "AUTH_ERROR", code: "1008" })).toBe("RENEW");
  });

  it("does not turn restore and fresh-launch escalation back into another in-page refresh", () => {
    const healthy = { status: "HEALTHY", code: null } as const;
    expect(btiSourceControlAction("RELOAD", healthy)).toBe("REFRESH_CURRENT");
    expect(btiSourceControlAction("RELOAD", failedPage)).toBe("RENEW_CURRENT");
    expect(btiSourceControlAction("RESTORE", healthy)).toBe("RESTORE_DOCUMENT");
    expect(btiSourceControlAction("ENSURE", healthy)).toBe("ENSURE_LAUNCH");
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
