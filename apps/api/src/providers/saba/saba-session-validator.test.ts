import { describe, expect, it } from "vitest";
import { SabaSessionValidator } from "./saba-session-validator.js";

describe("SabaSessionValidator", () => {
  it("accepts only a launch URL with verified SABA runtime evidence", async () => {
    const seen: string[] = [];
    const validator = new SabaSessionValidator({ verifyLaunch: async (url) => {
      seen.push(url);
      return true;
    } });
    await expect(validator.validate({ kind: "LAUNCH_URL", value: "https://saba.test/launch" }))
      .resolves.toEqual({ ok: true });
    expect(validator.provider).toBe("SABA");
    expect(seen).toEqual(["https://saba.test/launch"]);
    await expect(validator.validate({ kind: "TOKEN", value: "not-a-launch" }))
      .resolves.toEqual({ ok: false, reason: "SCHEMA_CHANGED" });
  });
});
