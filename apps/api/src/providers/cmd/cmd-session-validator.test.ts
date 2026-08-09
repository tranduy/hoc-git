import { describe, expect, it, vi } from "vitest";
import { CmdSessionValidator } from "./cmd-session-validator.js";

describe("CmdSessionValidator", () => {
  it("activates only a structurally verified CMD launch session", async () => {
    const verifyLaunch = vi.fn(async () => true);
    const validator = new CmdSessionValidator({ verifyLaunch });
    await expect(validator.validate({ kind: "LAUNCH_URL", value: "https://provider.test/launch" }))
      .resolves.toEqual({ ok: true });
    expect(validator.provider).toBe("CMD");
  });

  it("fails closed for wrong material, insufficient evidence, and probe failure", async () => {
    const wrong = new CmdSessionValidator({ verifyLaunch: vi.fn(async () => true) });
    await expect(wrong.validate({ kind: "TOKEN", value: "unit-test" }))
      .resolves.toEqual({ ok: false, reason: "SCHEMA_CHANGED" });
    const rejected = new CmdSessionValidator({ verifyLaunch: vi.fn(async () => false) });
    await expect(rejected.validate({ kind: "LAUNCH_URL", value: "https://provider.test/launch" }))
      .resolves.toEqual({ ok: false, reason: "SCHEMA_CHANGED" });
    const failed = new CmdSessionValidator({ verifyLaunch: vi.fn(async () => { throw new Error("private-canary"); }) });
    const result = await failed.validate({ kind: "LAUNCH_URL", value: "https://provider.test/launch" });
    expect(result).toEqual({ ok: false, reason: "UNREACHABLE" });
    expect(JSON.stringify(result)).not.toContain("private-canary");
  });
});
