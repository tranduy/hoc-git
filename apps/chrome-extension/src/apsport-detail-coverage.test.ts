import { describe, expect, it } from "vitest";
import { ApsportDetailCoverage } from "./apsport-detail-coverage.js";

describe("ApsportDetailCoverage", () => {
  it("preserves successful evidence across roster renewal and distinguishes empty detail", () => {
    const coverage = new ApsportDetailCoverage();
    coverage.reconcileRoster(["with-markets", "empty"]);
    coverage.markSuccess("with-markets", true, 1_000);
    coverage.markSuccess("empty", false, 2_000);

    coverage.reconcileRoster(["empty", "with-markets"]);

    expect(coverage.snapshot(5_000)).toEqual({
      rosterEvents: 2, successfulEvents: 2, withMarketsEvents: 1, emptyEvents: 1,
      pendingEvents: 0, failedEvents: 0, queuedEvents: 0, inFlightEvents: 0,
      complete: true, oldestSuccessAgeMs: 4_000
    });
  });

  it("removes success for events removed from the prematch roster or transitioned live", () => {
    const coverage = new ApsportDetailCoverage();
    coverage.reconcileRoster(["prematch"]);
    coverage.markSuccess("prematch", true, 1_000);

    coverage.reconcileRoster([]);

    expect(coverage.snapshot(2_000)).toEqual({
      rosterEvents: 0, successfulEvents: 0, withMarketsEvents: 0, emptyEvents: 0,
      pendingEvents: 0, failedEvents: 0, queuedEvents: 0, inFlightEvents: 0,
      complete: true, oldestSuccessAgeMs: null
    });
  });

  it("does not report complete while work lacks success or has an unresolved latest failure", () => {
    const coverage = new ApsportDetailCoverage();
    expect(coverage.snapshot(1_000).complete).toBe(false);

    coverage.reconcileRoster(["queued", "failed"]);
    coverage.markQueued("queued");
    coverage.markInFlight("failed");
    coverage.markFailure("failed");

    expect(coverage.snapshot(2_000)).toEqual({
      rosterEvents: 2, successfulEvents: 0, withMarketsEvents: 0, emptyEvents: 0,
      pendingEvents: 2, failedEvents: 1, queuedEvents: 1, inFlightEvents: 0,
      complete: false, oldestSuccessAgeMs: null
    });
  });

  it("ignores an old in-flight result after generation cleanup", () => {
    const coverage = new ApsportDetailCoverage();
    coverage.reconcileRoster(["old"]);
    coverage.markInFlight("old");
    coverage.reset();
    coverage.markSuccess("old", true, 1_000);

    expect(coverage.snapshot(2_000)).toEqual({
      rosterEvents: 0, successfulEvents: 0, withMarketsEvents: 0, emptyEvents: 0,
      pendingEvents: 0, failedEvents: 0, queuedEvents: 0, inFlightEvents: 0,
      complete: false, oldestSuccessAgeMs: null
    });
  });
});
