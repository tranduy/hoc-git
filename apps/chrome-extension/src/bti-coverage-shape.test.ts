import { describe, expect, it } from "vitest";
import { btiCoverageShape } from "./network-observer.js";

describe("btiCoverageShape", () => {
  it("names the phase and the counts that explain a stall", () => {
    // Measured 2026-09-16: BTI sat in HARD_RECOVERY for twenty-nine minutes
    // with its catalog frozen and no quote changing, and the only collector
    // fact the diagnostic carried was BTI_COV[chars:1918]. The collector had
    // gathered all of this and the length was all that survived.
    const shape = btiCoverageShape(JSON.stringify({
      phase: "FAILED", failed: 3, rosterRefreshFailed: true, authBlocked: false,
      requestPaused: true, requestStatus: 403, requestRetryInMs: 12_345.7,
      liveLeagues: 0, prematchLeagues: 0, events: 0, validEvents: 0,
      detailPendingEvents: 41, detailFailedEvents: 2, detailCoverageComplete: false
    }));
    expect(shape).toContain("phase:FAILED");
    expect(shape).toContain("rosterRefreshFailed:1");
    expect(shape).toContain("requestStatus:403");
    expect(shape).toContain("requestRetryInMs:12346");
    expect(shape).toContain("detailPendingEvents:41");
  });

  it("carries nothing but phase names, booleans and counts", () => {
    // The diagnostic contract is shape only: no values, targets or identifiers.
    const shape = btiCoverageShape(JSON.stringify({
      phase: "COMPLETE", events: 1500,
      leagueName: "Premier League", url: "https://example.invalid/x", token: "secret"
    }));
    expect(shape).toBe("phase:COMPLETE;events:1500");
  });

  it("says which way it failed rather than returning nothing", () => {
    expect(btiCoverageShape(undefined)).toBe("none");
    expect(btiCoverageShape("")).toBe("none");
    expect(btiCoverageShape("{oops")).toBe("unparsable:5");
    expect(btiCoverageShape("[1,2]")).toBe("not-an-object:5");
    expect(btiCoverageShape("{\"other\":1}")).toBe("no-known-fields:11");
  });
});

describe("a collector that is waiting, not absent", () => {
  it("tells a paused collector apart from no collector at all", () => {
    // BTI_COV[none] used to mean both, and they want opposite responses: a
    // paused collector needs time, an absent one needs the tab reopened.
    // Measured 2026-09-16, BTI reported none for eighty-four minutes while its
    // page was live and serving odds.
    expect(btiCoverageShape(undefined)).toBe("none");
    expect(btiCoverageShape(JSON.stringify({
      phase: "PAUSED", authBlocked: true, requestPaused: true,
      requestStatus: 403, requestRetryInMs: 240_000
    }))).toBe("phase:PAUSED;authBlocked:1;requestPaused:1;requestStatus:403;requestRetryInMs:240000");
  });

  it("names each way a run gives up", () => {
    for (const phase of ["ROSTER_BACKOFF", "SESSION_LOST", "CANCELLED"]) {
      expect(btiCoverageShape(JSON.stringify({ phase }))).toBe(`phase:${phase}`);
    }
  });
});
