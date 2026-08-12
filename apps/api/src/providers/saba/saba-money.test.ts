import { describe, expect, it } from "vitest";
import { normalizeSabaMoney } from "./saba-money.js";

describe("normalizeSabaMoney", () => {
  it("converts the observed SABA INH display unit into VND exactly", () => {
    expect(normalizeSabaMoney({ currency: "INH", amount: "29.61" }))
      .toEqual({ currency: "VND", amount: "29610", unitScale: "1000" });
    expect(normalizeSabaMoney({ currency: "INH", amount: "54945" }))
      .toEqual({ currency: "VND", amount: "54945000", unitScale: "1000" });
  });

  it("keeps VND unchanged and fails closed for unsupported units", () => {
    expect(normalizeSabaMoney({ currency: "VND", amount: "30000" }))
      .toEqual({ currency: "VND", amount: "30000", unitScale: "1" });
    expect(normalizeSabaMoney({ currency: "UUS", amount: "1" })).toBeNull();
    expect(normalizeSabaMoney({ currency: "INH", amount: "NaN" })).toBeNull();
  });
});
