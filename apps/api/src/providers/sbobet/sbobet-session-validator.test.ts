import { describe, expect, it } from "vitest";
import { SbobetSessionValidator } from "./sbobet-session-validator.js";

describe("SbobetSessionValidator", () => {
  it("accepts only a launch URL with verified SBOBET runtime evidence", async () => {
    const validator = new SbobetSessionValidator({ verifyLaunch: async () => true });
    await expect(validator.validate({ kind: "LAUNCH_URL", value: "https://launch.example.test" }))
      .resolves.toEqual({ ok: true });
    await expect(validator.validate({ kind: "TOKEN", value: "opaque" }))
      .resolves.toEqual({ ok: false, reason: "SCHEMA_CHANGED" });
  });
});
