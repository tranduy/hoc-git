import { describe, expect, it, vi } from "vitest";
import { AccountApi } from "./accounts.js";

const account = {
  id: "account-1",
  alias: "CMD account 1",
  provider: "CMD",
  category: null,
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
  it("aborts a hung account status request without blocking catalog monitoring", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
      const request = new AccountApi(fetcher as typeof fetch, 1_000).list();
      const outcome = expect(request).rejects.toThrow("Account request timed out");
      await vi.advanceTimersByTimeAsync(1_000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

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
