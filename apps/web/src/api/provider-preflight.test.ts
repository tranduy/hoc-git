import type { ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { ProviderPreflightApi } from "./provider-preflight.js";

const request: ProviderTicketPreflightRequest = {
  accountId: "saba-account",
  providerEventId: "saba-event",
  providerMarketId: "saba-market",
  providerSelectionId: "saba-home",
  selection: "HOME",
  line: "-0.5",
  expectedDecimalOdds: "2.2",
  requestedStake: "100000"
};

const providerPreflight: ProviderTicketPreflight = {
  accountId: "saba-account",
  provider: "SABA",
  providerEventId: "saba-event",
  providerMarketId: "saba-market",
  providerSelectionId: "saba-home",
  selection: "HOME",
  line: "-0.5",
  decimalOdds: "2.2",
  quoteStatus: "OPEN",
  limitEvidence: {
    currency: "VND", minStake: "30000", maxStake: "500000", stakeStep: "1000", balance: "600000",
    verifiedAsOfMs: 1_000, expiresAtMs: 4_000
  },
  constraint: {
    currency: "VND", minStake: "30000", maxStake: "500000", stakeStep: "1000", balance: "600000",
    feeType: "NONE", feeRate: null, verifiedAsOfMs: 1_000, expiresAtMs: 4_000
  },
  eligible: true,
  reasons: []
};

describe("ProviderPreflightApi", () => {
  it("posts one exact ticket leg with no-store and parses verified constraints", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const api = new ProviderPreflightApi(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(providerPreflight), { status: 200,
        headers: { "content-type": "application/json" } });
    });

    await expect(api.preflight(request)).resolves.toEqual(providerPreflight);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/preflight/provider");
    expect(calls[0]?.init).toMatchObject({ method: "POST", cache: "no-store",
      headers: { "content-type": "application/json" } });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(request);
    expect(calls.some((call) => call.url.includes("execution"))).toBe(false);
  });

  it("rejects an invalid outbound request before using the network", async () => {
    let called = false;
    const api = new ProviderPreflightApi(async () => { called = true; return new Response(); });

    await expect(api.preflight({ ...request, requestedStake: "-1" })).rejects.toThrow("Invalid provider preflight request");
    expect(called).toBe(false);
  });

  it("propagates a safe provider error from a non-success response", async () => {
    const api = new ProviderPreflightApi(async () => new Response(JSON.stringify({ error: "PREFLIGHT_UNAVAILABLE" }),
      { status: 503, headers: { "content-type": "application/json" } }));

    await expect(api.preflight(request)).rejects.toThrow("PREFLIGHT_UNAVAILABLE");
  });

  it("rejects malformed successful responses", async () => {
    const api = new ProviderPreflightApi(async () => new Response(JSON.stringify({ ...providerPreflight,
      constraint: { ...providerPreflight.constraint, expiresAtMs: 9_000 } }),
    { status: 200, headers: { "content-type": "application/json" } }));

    await expect(api.preflight(request)).rejects.toThrow("Invalid provider preflight response");
  });
});
