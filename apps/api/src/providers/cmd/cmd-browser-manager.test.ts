import { describe, expect, it } from "vitest";
import { cmdProfileDirectoryName, validateCmdLaunchUrl } from "./cmd-browser-manager.js";

describe("CMD browser manager safety", () => {
  it("accepts opaque HTTPS launch URLs without rewriting credential-bearing query data", () => {
    const input = "https://provider.test/launch?opaque=unit-test-value#route";
    expect(validateCmdLaunchUrl(input)).toBe(input);
  });

  it.each([
    "http://provider.test/launch",
    "https://user:pass@provider.test/launch",
    "javascript:alert(1)",
    "not-a-url"
  ])("rejects unsafe launch URL %s", (input) => {
    expect(() => validateCmdLaunchUrl(input)).toThrow("CMD_LAUNCH_URL_INVALID");
  });

  it("derives a stable profile directory without exposing the session identifier", () => {
    const sessionId = "private-session-canary";
    const directory = cmdProfileDirectoryName(sessionId);
    expect(directory).toMatch(/^cmd-[a-f0-9]{24}$/u);
    expect(directory).not.toContain(sessionId);
    expect(cmdProfileDirectoryName(sessionId)).toBe(directory);
  });
});
