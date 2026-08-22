import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle, ProviderSecret } from "../../sessions/types.js";
import { normalizeSbobetKBalance, SbobetProfileReader } from "./sbobet-profile-reader.js";

function handle(secret: ProviderSecret = { kind: "LAUNCH_URL", value: "https://provider.test/launch" }): ActiveSecretHandle {
  return { sessionId: "session-1", provider: "SBOBET", category: "FOOTBALL",
    withSecret: async (consume) => consume(secret) };
}

describe("SBOBET profile reader", () => {
  it.each([
    ["29K", "29000"], ["329,868 K", "329868000"], ["1.5K", "1500"], ["0K", "0"]
  ])("normalizes the displayed thousand-VND balance %s", (raw, expected) => {
    expect(normalizeSbobetKBalance(raw)).toBe(expected);
  });

  it.each(["29", "K", "1.2345K", "-1K", "1e3K", " 1,2 K "])("rejects ambiguous balance %s", (raw) => {
    expect(normalizeSbobetKBalance(raw)).toBeNull();
  });

  it("returns only a redacted label and exact balance from an authenticated page", async () => {
    const reader = new SbobetProfileReader({ clock: { nowMs: () => 2_000 }, source: {
      readProfile: async () => ({ displayName: "development-user-3333", balanceText: "29K", observedAtMs: 1_900 })
    } });

    await expect(reader.readProfile(handle())).resolves.toEqual({
      redactedLabel: "••••3333", currency: "VND", balance: "29000", asOfMs: 1_900
    });
  });

  it("fails closed for a guest page or unsupported secret", async () => {
    const reader = new SbobetProfileReader({ clock: { nowMs: () => 2_000 }, source: {
      readProfile: async () => ({ displayName: "", balanceText: "", observedAtMs: 1_900 })
    } });

    await expect(reader.readProfile(handle())).rejects.toThrow("SBOBET_PROFILE_UNAVAILABLE");
    await expect(reader.readProfile(handle({ kind: "TOKEN", value: "opaque" }))).rejects.toThrow("SBOBET_PROFILE_UNAVAILABLE");
  });
});
