import { describe, expect, it, vi } from "vitest";
import { isVerifiedBtiIdentity } from "./bti-browser-manager.js";
import { BtiSessionValidator } from "./bti-session-validator.js";

describe("BTI identity", () => {
  it("requires the current dynamic host pattern and direct live Football API", () => {
    expect(isVerifiedBtiIdentity({ hostname: "prod20091.fxf774.com", title: "Sportsbook", hasFootball: true, hasLiveInitial: true })).toBe(true);
    expect(isVerifiedBtiIdentity({ hostname: "spoof.test", title: "Sportsbook", hasFootball: true, hasLiveInitial: true })).toBe(false);
    expect(isVerifiedBtiIdentity({ hostname: "prod20091.fxf774.com", title: "Sportsbook", hasFootball: true, hasLiveInitial: false })).toBe(false);
  });
  it("fails closed for unsupported material and probe mismatch", async () => {
    const accepted = new BtiSessionValidator({ verifyLaunch: vi.fn(async () => true) });
    await expect(accepted.validate({ kind: "LAUNCH_URL", value: "https://prod20091.fxf774.com/launch" })).resolves.toEqual({ ok: true });
    await expect(accepted.validate({ kind: "TOKEN", value: "private" })).resolves.toEqual({ ok: false, reason: "SCHEMA_CHANGED" });
    const rejected = new BtiSessionValidator({ verifyLaunch: vi.fn(async () => false) });
    await expect(rejected.validate({ kind: "LAUNCH_URL", value: "https://prod20091.fxf774.com/launch" })).resolves.toEqual({ ok: false, reason: "SCHEMA_CHANGED" });
  });
});
