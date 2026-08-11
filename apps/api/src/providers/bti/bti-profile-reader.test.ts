import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import { BtiProfileReader, normalizeBtiKBalance } from "./bti-profile-reader.js";

const handle: ActiveSecretHandle = { sessionId: "session", provider: "BTI", category: "FOOTBALL",
  withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://prod20091.fxf774.com/launch" }) };

describe("BTI profile", () => {
  it.each([["29.61 K", "29610"], ["0 K", "0"], ["1.5K", "1500"]])("normalizes %s as exact VND", (input, output) => {
    expect(normalizeBtiKBalance(input)).toBe(output);
  });
  it("returns only redacted identity and verified VND balance claims", async () => {
    const reader = new BtiProfileReader({ clock: { nowMs: () => 2_000 }, source: { readProfile: async () => ({
      displayName: "development-user", balanceText: "29.61 K", currencyCode: "VND", observedAtMs: 1_900
    }) } });
    await expect(reader.readProfile(handle)).resolves.toEqual({ redactedLabel: "••••0890", currency: "VND", balance: "29610", asOfMs: 1_900 });
  });
  it("fails closed for unsupported currency", async () => {
    const reader = new BtiProfileReader({ clock: { nowMs: () => 2_000 }, source: { readProfile: async () => ({
      displayName: "development-user", balanceText: "29.61 K", currencyCode: "UNKNOWN", observedAtMs: 1_900
    }) } });
    await expect(reader.readProfile(handle)).rejects.toThrow("BTI_PROFILE_UNAVAILABLE");
  });
});
