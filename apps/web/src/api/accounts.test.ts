import { describe, expect, it } from "vitest";
import { AccountApi } from "./accounts.js";

const account = {
  id: "account-1",
  alias: "CMD account 1",
  provider: "CMD",
  sessionState: "ACTIVE",
  profileState: "FRESH",
  redactedLabel: "••••1445",
  currency: "UUS",
  balance: "0",
  balanceAsOfMs: 1_800_000_000_000,
  capabilities: ["PROFILE", "CATALOG"],
  reason: null
};

describe("AccountApi", () => {
  it("validates account lists and refresh responses at the HTTP boundary", async () => {
    const calls: string[] = [];
    const api = new AccountApi(async (input) => {
      const url = String(input);
      calls.push(url);
      return new Response(JSON.stringify(url === "/api/accounts" ? { accounts: [account] } : account), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await expect(api.list()).resolves.toEqual([account]);
    await expect(api.refresh("account-1")).resolves.toEqual(account);
    expect(calls).toEqual(["/api/accounts", "/api/accounts/account-1/refresh"]);
  });

  it("rejects malformed account data instead of showing an invented balance", async () => {
    const api = new AccountApi(async () => new Response(JSON.stringify({ accounts: [{ ...account, balance: "1e5" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));

    await expect(api.list()).rejects.toThrow("Invalid account response");
  });
});
