import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle, ProviderSecret } from "../../sessions/types.js";
import { ApsportProfileReader, normalizeApsportKBalance } from "./apsport-profile-reader.js";

function handle(secret: ProviderSecret = { kind: "LAUNCH_URL", value: "https://sport.asportsb.com/launch" }): ActiveSecretHandle {
  return { sessionId: "session-1", provider: "APSPORT", category: "FOOTBALL",
    withSecret: async (consume) => consume(secret) };
}

describe("APSPORT profile reader", () => {
  it.each([["29 K", "29000"], ["1.5K", "1500"], ["0K", "0"]])("normalizes %s as thousand VND", (raw, expected) => {
    expect(normalizeApsportKBalance(raw)).toBe(expected);
  });

  it.each(["29", "K", "-1K", "1.2345K"])("rejects ambiguous balance %s", (raw) => {
    expect(normalizeApsportKBalance(raw)).toBeNull();
  });

  it("returns a redacted identity and exact authenticated wallet balance", async () => {
    const reader = new ApsportProfileReader({ clock: { nowMs: () => 2_000 }, source: {
      readProfile: async () => ({ displayName: "development-user-3333", balanceText: "29 K", observedAtMs: 1_900 })
    } });
    await expect(reader.readProfile(handle())).resolves.toEqual({
      redactedLabel: "••••3333", currency: "VND", balance: "29000", asOfMs: 1_900
    });
  });

  it("fails closed for unsupported or incomplete data", async () => {
    const reader = new ApsportProfileReader({ clock: { nowMs: () => 2_000 }, source: {
      readProfile: async () => ({ displayName: "", balanceText: "", observedAtMs: 1_900 })
    } });
    await expect(reader.readProfile(handle())).rejects.toThrow("APSPORT_PROFILE_UNAVAILABLE");
    await expect(reader.readProfile(handle({ kind: "TOKEN", value: "opaque" }))).rejects.toThrow("APSPORT_PROFILE_UNAVAILABLE");
  });
});
