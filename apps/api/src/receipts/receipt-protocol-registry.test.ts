import type { AccountStatus } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { ReceiptProtocolRegistry } from "./receipt-protocol-registry.js";

const account: AccountStatus = {
  id: "account-1", alias: "SBOBET", provider: "SBOBET", category: "FOOTBALL",
  sessionState: "ACTIVE", profileState: "FRESH", redactedLabel: "••••3333", currency: "VND",
  balance: "29000", balanceAsOfMs: 1_000, capabilities: ["PROFILE", "CATALOG"], reason: null
};

function registry(output: unknown = {
  controlLabel: "Bet history",
  observations: [{ hostname: "book.test", method: "GET", pathTemplate: "/api/history", status: 200,
    contentType: "application/json", shape: "object{rows:array<empty>}", bodyHash: "a".repeat(64) }]
}): ReceiptProtocolRegistry {
  return new ReceiptProtocolRegistry({
    accounts: {
      listStatuses: async () => [account],
      withActiveHandle: async (_id, _provider, consume) => consume({
        sessionId: "session-1", provider: "SBOBET", category: "FOOTBALL",
        withSecret: async (use) => use({ kind: "LAUNCH_URL", value: "https://private.test/token" })
      })
    },
    readers: [{ provider: "SBOBET", inspect: async () => output }]
  });
}

describe("ReceiptProtocolRegistry", () => {
  it("returns only schema-validated read-only protocol evidence", async () => {
    await expect(registry().inspect({ accountId: "account-1" })).resolves.toEqual(expect.objectContaining({
      provider: "SBOBET", accountId: "account-1", observations: [expect.objectContaining({ pathTemplate: "/api/history" })]
    }));
  });

  it("rejects inactive, unsupported, and secret-bearing provider output", async () => {
    await expect(new ReceiptProtocolRegistry({ accounts: {
      listStatuses: async () => [{ ...account, sessionState: "ACTION_REQUIRED" }],
      withActiveHandle: async () => { throw new Error("must not run"); }
    }, readers: [] }).inspect({ accountId: "account-1" })).rejects.toThrow("RECEIPT_PROTOCOL_ACCOUNT_UNAVAILABLE");

    await expect(registry({ controlLabel: "Bet history", observations: [{
      hostname: "book.test", method: "GET", pathTemplate: "/api/history?token=secret", status: 200,
      contentType: "application/json", shape: "object{}", bodyHash: "a".repeat(64)
    }] }).inspect({ accountId: "account-1" })).rejects.toThrow();
  });
});
