import { describe, expect, it } from "vitest";
import { proveCmdIdentity } from "./cmd-identity.js";

describe("CMD identity proof", () => {
  const candidate = { providerHint: "CMD", hostname: "sports.cmd.test" };
  const observations = [
    { hostname: "sports.cmd.test", method: "GET", transport: "NAVIGATION" as const, pathTemplate: "/launch", status: 200, contentType: "text/html" },
    { hostname: "api.cmd.test", method: "GET", transport: "FETCH" as const, pathTemplate: "/api/events", status: 200, contentType: "application/json" },
    { hostname: "stream.cmd.test", method: "GET", transport: "WEBSOCKET" as const, pathTemplate: "/feed", status: 101, contentType: null }
  ];

  it("requires launch provenance plus JSON API and websocket signals", () => {
    expect(proveCmdIdentity(candidate, observations)).toEqual({ verified: true, reason: null });
    expect(proveCmdIdentity(candidate, observations.slice(0, 2))).toEqual({ verified: false, reason: "INSUFFICIENT_PROTOCOL_EVIDENCE" });
  });

  it("does not trust hostname or an unknown launcher label alone", () => {
    expect(proveCmdIdentity({ providerHint: "UNKNOWN", hostname: "sports.cmd.test" }, observations))
      .toEqual({ verified: false, reason: "LAUNCH_PROVENANCE_MISMATCH" });
    expect(proveCmdIdentity(candidate, [])).toEqual({ verified: false, reason: "INSUFFICIENT_PROTOCOL_EVIDENCE" });
  });
});
