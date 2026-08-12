import { describe, expect, it } from "vitest";
import { resolveProviderFees } from "./provider-fees.js";

describe("provider fee configuration", () => {
  it("keeps every provider unconfigured when the environment value is absent", () => {
    expect(resolveProviderFees({})).toEqual({});
  });

  it("accepts only explicit fee policies for supported preflight providers", () => {
    expect(resolveProviderFees({ PROVIDER_FEES_JSON: JSON.stringify({
      SABA: { type: "NONE" }, SBOBET: { type: "PROFIT", rate: "0.01" },
      APSPORT: { type: "PAYOUT", rate: "0.02" }, BTI: { type: "NONE" }
    }) })).toEqual({ SABA: { type: "NONE" }, SBOBET: { type: "PROFIT", rate: "0.01" },
      APSPORT: { type: "PAYOUT", rate: "0.02" }, BTI: { type: "NONE" } });
  });

  it.each([
    "not-json",
    JSON.stringify({ CMD: { type: "NONE" } }),
    JSON.stringify({ SABA: { type: "NONE", rate: "0" } }),
    JSON.stringify({ SABA: { type: "PROFIT", rate: "1" } }),
    JSON.stringify({ SABA: { type: "PROFIT", rate: "1e-2" } })
  ])("fails startup closed for an invalid policy: %s", (value) => {
    expect(() => resolveProviderFees({ PROVIDER_FEES_JSON: value })).toThrow("PROVIDER_FEES_INVALID");
  });
});
