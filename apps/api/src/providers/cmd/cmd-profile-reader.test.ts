import { describe, expect, it, vi } from "vitest";
import type { ActiveSecretHandle, ProviderSecret } from "../../sessions/types.js";
import { CmdProfileReader } from "./cmd-profile-reader.js";

function handle(secret: ProviderSecret, provider = "CMD"): ActiveSecretHandle {
  return {
    sessionId: "cmd-session-test",
    provider,
    withSecret: async (consume) => consume(secret)
  };
}

describe("CmdProfileReader", () => {
  it("returns only normalized redacted profile fields from a CMD launch session", async () => {
    const readAccountStore = vi.fn(async () => ({
      DisplayUserName: "account-canary-9012",
      Curr: "VND",
      Bal: { BCredit: "100,000.00", Cas: "999999" }
    }));
    const reader = new CmdProfileReader({
      source: { readAccountStore },
      clock: { nowMs: () => 2_000 }
    });

    await expect(reader.readProfile(handle({
      kind: "LAUNCH_URL", value: "https://provider.test/launch?credential=unit-test"
    }))).resolves.toEqual({
      redactedLabel: "••••9012",
      currency: "VND",
      balance: "100000",
      asOfMs: 2_000
    });
    expect(reader.capabilities).toEqual(["PROFILE"]);
    expect(readAccountStore).toHaveBeenCalledWith({
      sessionId: "cmd-session-test",
      launchUrl: "https://provider.test/launch?credential=unit-test"
    });
  });

  it.each([
    ["SABA", { kind: "LAUNCH_URL", value: "https://provider.test/launch" }],
    ["CMD", { kind: "TOKEN", value: "unit-test-token" }]
  ] as const)("fails closed for provider/secret mismatch", async (provider, secret) => {
    const reader = new CmdProfileReader({
      source: { readAccountStore: vi.fn() },
      clock: { nowMs: () => 2_000 }
    });
    await expect(reader.readProfile(handle(secret, provider))).rejects.toThrow("CMD_PROFILE_UNAVAILABLE");
  });

  it("fails closed on CMD account-store schema drift without leaking values", async () => {
    const privateValue = "private-account-canary";
    const reader = new CmdProfileReader({
      source: { readAccountStore: async () => ({ DisplayUserName: privateValue, Bal: { Cas: "100" } }) },
      clock: { nowMs: () => 2_000 }
    });
    const result = reader.readProfile(handle({ kind: "LAUNCH_URL", value: "https://provider.test/launch" }));
    await expect(result).rejects.toThrow("CMD_PROFILE_UNAVAILABLE");
    await expect(result).rejects.not.toThrow(privateValue);
  });
});
