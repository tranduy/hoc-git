import { describe, expect, it } from "vitest";
import { CatalogApi } from "./catalog.js";

const response = {
  dataMode: "LIVE",
  accountId: "account-1",
  provider: "CMD",
  category: "FOOTBALL",
  comparisonState: "AWAITING_SECOND_PROVIDER",
  observedAtMs: 100,
  rejectedMarketCount: 0,
  events: [], markets: [], quotes: []
};

describe("CatalogApi", () => {
  it("loads a live account catalog through a path parameter", async () => {
    const calls: string[] = [];
    const api = new CatalogApi(async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(api.read("account-1")).resolves.toEqual(response);
    expect(calls).toEqual(["/api/catalog/accounts/account-1"]);
  });

  it("rejects a fixture or malformed response at the UI boundary", async () => {
    const api = new CatalogApi(async () => new Response(JSON.stringify({ ...response, dataMode: "FIXTURE" }), { status: 200 }));
    await expect(api.read("account-1")).rejects.toThrow("Invalid live catalog response");
  });

  it("accepts a verified supported provider instead of hard-coding CMD", async () => {
    const saba = { ...response, provider: "SABA" };
    const api = new CatalogApi(async () => new Response(JSON.stringify(saba), { status: 200 }));
    await expect(api.read("account-1")).resolves.toEqual(saba);
  });
});
