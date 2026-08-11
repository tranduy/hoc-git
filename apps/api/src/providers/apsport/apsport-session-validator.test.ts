import { describe, expect, it, vi } from "vitest";
import { isVerifiedApsportIdentity } from "./apsport-browser-manager.js";
import { ApsportSessionValidator } from "./apsport-session-validator.js";

describe("APSPORT identity", () => {
  it("requires the current captured host plus sports and event surfaces", () => {
    expect(isVerifiedApsportIdentity({
      hostname: "sport.asportsb.com", hasSportsSurface: true, hasEventSurface: true
    })).toBe(true);
    expect(isVerifiedApsportIdentity({
      hostname: "spoof.test", hasSportsSurface: true, hasEventSurface: true
    })).toBe(false);
    expect(isVerifiedApsportIdentity({
      hostname: "sport.asportsb.com", hasSportsSurface: true, hasEventSurface: false
    })).toBe(false);
  });

  it("fails closed for unsupported material, schema mismatch, and probe failure", async () => {
    const accepted = new ApsportSessionValidator({ verifyLaunch: vi.fn(async () => true) });
    await expect(accepted.validate({ kind: "LAUNCH_URL", value: "https://sport.asportsb.com/launch" }))
      .resolves.toEqual({ ok: true });
    await expect(accepted.validate({ kind: "TOKEN", value: "private-canary" }))
      .resolves.toEqual({ ok: false, reason: "SCHEMA_CHANGED" });
    const rejected = new ApsportSessionValidator({ verifyLaunch: vi.fn(async () => false) });
    await expect(rejected.validate({ kind: "LAUNCH_URL", value: "https://sport.asportsb.com/launch" }))
      .resolves.toEqual({ ok: false, reason: "SCHEMA_CHANGED" });
    const failed = new ApsportSessionValidator({ verifyLaunch: vi.fn(async () => { throw new Error("private-canary"); }) });
    await expect(failed.validate({ kind: "LAUNCH_URL", value: "https://sport.asportsb.com/launch" }))
      .resolves.toEqual({ ok: false, reason: "UNREACHABLE" });
  });
});
