import { describe, expect, it } from "vitest";
import { proveCmdIdentity } from "./cmd-identity.js";

describe("CMD identity proof", () => {
  const candidate = { providerHint: "CMD", hostname: "sports.cmd.test" };
  const observations = [
    { hostname: "sports.cmd.test", method: "GET", transport: "NAVIGATION" as const, pathTemplate: "/:session/Newindex", status: 200, contentType: "text/html" },
    { hostname: "sports.cmd.test", method: "GET", transport: "XHR" as const, pathTemplate: "/:session/NewIndex/GetAppConfig", status: 200, contentType: "application/json", bodyShapeHash: "6a471d81d8c6be58ec077a5f6672083c1be064b02c7bbb2e40932173d0c270db" },
    { hostname: "api.cmd.test", method: "POST", transport: "XHR" as const, pathTemplate: "/api/menu/desktopMenu", status: 200, contentType: "application/json", bodyShapeHash: "3ddb067776b1837ef907a113b4efb4146b2cc443a2dded65dcd596183be709a8" }
  ];

  it("requires launch provenance plus independently repeated structural fingerprints", () => {
    expect(proveCmdIdentity(candidate, observations)).toEqual({ verified: true, reason: null });
    expect(proveCmdIdentity(candidate, observations.slice(0, 2))).toEqual({ verified: false, reason: "INSUFFICIENT_PROTOCOL_EVIDENCE" });
  });

  it("does not trust hostname or an unknown launcher label alone", () => {
    expect(proveCmdIdentity({ providerHint: "UNKNOWN", hostname: "sports.cmd.test" }, observations))
      .toEqual({ verified: false, reason: "LAUNCH_PROVENANCE_MISMATCH" });
    expect(proveCmdIdentity(candidate, [])).toEqual({ verified: false, reason: "INSUFFICIENT_PROTOCOL_EVIDENCE" });
  });
});
