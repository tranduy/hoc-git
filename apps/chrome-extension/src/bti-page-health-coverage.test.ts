import { describe, expect, it } from "vitest";
import { parseBtiPageHealthProbe } from "./bti-page-health.js";

/**
 * Every counter the collector publishes has to survive the parser, or the probe
 * silently degrades to "UNKNOWN, no coverage" - the same shape a page that is
 * still loading produces, which is what made BTI unreadable for ten minutes.
 */
const coverage = {
  phase: "COMPLETE", liveLeagues: 23, prematchLeagues: 291, earlyLeagues: 154,
  earlyBatches: 16, earlyDone: 16, liveBatches: 3, prematchBatches: 30,
  liveDone: 3, prematchDone: 30, failed: 0, events: 1805, namedEvents: 1805,
  timedEvents: 1805, marketEvents: 900, validEvents: 1805,
  unnamedEvents: 0, unnamedWithin24h: 0, unnamedLater: 0, unnamedShapes: "",
  detailCachedEvents: 10, detailCachedBytes: 1024, detailPendingEvents: 2,
  detailRosterEvents: 12, detailEmptyEvents: 0, detailFailedEvents: 0,
  detailEvictedEvents: 0, detailNearTtlMs: 12000, detailDistantTtlMs: 60000,
  detailDueEvents: 1, detailDeferredEvents: 11, detailRetainedEventCap: 2048,
  detailQueueCap: 128, detailOverCapEvents: 0, rosterRefreshFailed: false,
  requestPaused: false, requestStatus: 0, requestRetryInMs: 0, authBlocked: false,
  detailCoverageComplete: true, detailQueuedEvents: 0, detailInFlightEvents: 0,
  detailOldestReceiptAgeMs: null,
  rosterStarts: 9, rosterCompleted: 8, rosterFailed: 0,
  rosterTeardown: "v0.s0", rosterLostSession: 0, rosterPaused: 0,
  rosterFetchNull: 0, rosterPartFail: "live:0,pre:0,early:0",
  rosterDoneEvents: 1805, rosterDoneWithin24h: 1002, rosterDoneLive: 31,
  rosterDonePrematch: 971, rosterDoneEarly: 803,
  rosterGateLive: "n0.f0.t0.m0.ok31", rosterGateToday: "n0.f0.t0.m0.ok971",
  rosterGateEarly: "n0.f0.t0.m0.ok803",
  rosterAnsweredLive: "23.23", rosterAnsweredToday: "291.291", rosterAnsweredEarly: "154.154",
  rosterBodyLiveKb: 22, rosterBodyLiveInitKb: 0, rosterBodyPrematchKb: 4639,
  rosterShapeLive: "0i,1a2,2s31,3s24,4a2,5b,6i,7z,8a37.p.0i,1o3,2s0,3z",
  rosterShapeToday: "0s,3s,5b,6b,7a5,9a0,13b,14o5,17o3.p.0z,1z,2z,3z",
  rosterShapeEarly: "0i,1a2,2s31,3s24,4a2,5b,6i,7z,8a37.p.0i,1o3,2s0,3z",
  rosterAgeMs: 3866, rosterCompletedAgeMs: 19736,
  nativeRosterEvents: 1805, nativePrematchEvents: 971, nativeLiveEvents: 31,
  nativeDetailEvents: 10, nativeMarketRows: 900, nativeSelectionRows: 1800,
  nativeNumericIds: 0, nativeMalformedRows: 0, nativeInventoryTruncated: false,
  nativeTypeCountsTruncated: false, nativeTypeCounts: "FT_AH:900,FT_TOTAL:800"
};

describe("BTI page health coverage", () => {
  it("accepts every counter the collector publishes", () => {
    const probe = parseBtiPageHealthProbe({ status: "HEALTHY", code: null,
      rosterCoverage: JSON.stringify(coverage) });
    expect(probe?.rosterCoverage).toBeTypeOf("string");
  });

  it("stays inside the 4096-character budget the bridge forwards", () => {
    expect(JSON.stringify(coverage).length).toBeLessThan(4096);
  });

  it("only uses characters the bridge does not strip", () => {
    expect(/^[-A-Za-z0-9_":{},.]+$/u.test(JSON.stringify(coverage))).toBe(true);
  });
});

describe("unnamed shape counts", () => {
  const withShapes = (unnamedShapes: string) => parseBtiPageHealthProbe({
    status: "HEALTHY", code: null,
    rosterCoverage: JSON.stringify({ ...coverage, unnamedShapes })
  });

  it("accepts the shapes the collector actually produces", () => {
    for (const shapes of ["", "none:12", "1.2.3.5:900", "1.2.3.5.8:4", "13.2:7", "none:3,1.2:9"]) {
      expect(withShapes(shapes), shapes).not.toBeNull();
    }
  });

  it("still refuses anything that is not an index shape", () => {
    for (const shapes of ["bad:1", "Arsenal:1", "1.2.3.5:9000000", "::"]) {
      expect(withShapes(shapes), shapes).toBeNull();
    }
  });
});
