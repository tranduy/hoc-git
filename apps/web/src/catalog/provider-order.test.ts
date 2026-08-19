import { describe, expect, it } from "vitest";
import { compareProviders, sortProviders } from "./provider-order.js";

describe("fixed provider order", () => {
  it("uses one deterministic order regardless of feed arrival order", () => {
    expect(sortProviders(["BTI", "CMD", "SBOBET", "APSPORT", "IM", "SABA"]))
      .toEqual(["SABA", "IM", "SBOBET", "CMD", "APSPORT", "BTI"]);
  });

  it("uses a stable lexical tie-break for duplicate-provider account rows", () => {
    const sources = [{ provider: "CMD" as const, accountId: "z" },
      { provider: "SABA" as const, accountId: "b" }, { provider: "SABA" as const, accountId: "a" }];
    expect([...sources].sort((left, right) => compareProviders(left.provider, right.provider) ||
      left.accountId.localeCompare(right.accountId)).map((source) => source.accountId)).toEqual(["a", "b", "z"]);
  });
});
