import { describe, expect, it } from "vitest";
import { normalizeCmdAccountStore } from "./cmd-profile.js";

describe("normalizeCmdAccountStore", () => {
  it("uses betting credit, currency, and a masked account label", () => {
    expect(normalizeCmdAccountStore({
      DisplayUserName: "member-canary-1234",
      Curr: "vnd",
      Bal: { BCredit: "100,000.00", Cas: "50000", Curr: "VND" }
    }, 123_456)).toEqual({
      redactedLabel: "••••1234",
      currency: "VND",
      balance: "100000",
      asOfMs: 123_456,
      source: "ACCOUNT_STORE_BETTING_CREDIT"
    });
  });

  it("falls back through safe account labels and top-level currency", () => {
    expect(normalizeCmdAccountStore({
      LicUserName: "xy",
      Curr: "USD",
      Bal: { BCredit: 25.5 }
    }, 10)).toEqual(expect.objectContaining({
      redactedLabel: "••",
      currency: "USD",
      balance: "25.5"
    }));
  });

  it.each([
    [{ DisplayUserName: "user-1234", Curr: "VND", Bal: { BCredit: "1e5" } }],
    [{ DisplayUserName: "user-1234", Curr: "VND", Bal: { BCredit: "10,00" } }],
    [{ DisplayUserName: "user-1234", Curr: "VND", Bal: { BCredit: "-1" } }],
    [{ DisplayUserName: "user-1234", Curr: "VNĐ", Bal: { BCredit: "100" } }],
    [{ DisplayUserName: "user-1234", Curr: "VND", Bal: { Cas: "100" } }],
    [{ DisplayUserName: "user-1234", Curr: "VND", Bal: { BCredit: Number.NaN } }]
  ])("fails closed for malformed or non-wagering balance evidence", (raw) => {
    expect(normalizeCmdAccountStore(raw, 10)).toBeNull();
  });

  it("never exposes a full account label", () => {
    const rawLabel = "private-account-canary";
    const result = normalizeCmdAccountStore({
      Name: rawLabel,
      Curr: "VND",
      Bal: { BCredit: "100" }
    }, 10);
    expect(result?.redactedLabel).not.toContain(rawLabel);
    expect(JSON.stringify(result)).not.toContain(rawLabel);
  });
});
