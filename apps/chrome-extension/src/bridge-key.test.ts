import { describe, expect, it } from "vitest";
import { resolveInstallationKey } from "./bridge-key.js";

describe("resolveInstallationKey", () => {
  it("keeps the persisted key when one already exists", () => {
    expect(resolveInstallationKey("persisted-key", "bundled-key")).toBe("persisted-key");
  });

  it("uses the local build key only when storage is empty", () => {
    expect(resolveInstallationKey("  ", " bundled-key ")).toBe("bundled-key");
  });

  it("stays unconfigured when neither key exists", () => {
    expect(resolveInstallationKey(undefined, "")).toBe("");
  });
});
