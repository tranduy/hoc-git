import { describe, expect, it } from "vitest";
import { DpapiProtector } from "./dpapi-protector.js";

describe.runIf(process.platform === "win32")("DpapiProtector", () => {
  it("round-trips bytes for the current Windows user", async () => {
    const protector = new DpapiProtector();
    const cleartext = new TextEncoder().encode("dpapi-roundtrip-canary");

    const ciphertext = await protector.protect(cleartext);

    expect(new TextDecoder().decode(ciphertext)).not.toContain("dpapi-roundtrip-canary");
    expect(Array.from(await protector.unprotect(ciphertext))).toEqual(Array.from(cleartext));
  });
});
