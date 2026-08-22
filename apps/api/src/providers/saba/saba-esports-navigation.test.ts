import { describe, expect, it } from "vitest";
import { exactSabaLolUrl } from "./saba-esports-navigation.js";

describe("exactSabaLolUrl", () => {
  it("preserves the server session route while selecting only LoL", () => {
    expect(exactSabaLolUrl("https://esports.estorb.com/(S(route-value))/ESports/43/ALL?mode=m0#fragment"))
      .toBe("https://esports.estorb.com/(S(route-value))/ESports/43/LOL");
  });

  it("rejects lookalike hosts and unexpected sports paths", () => {
    expect(() => exactSabaLolUrl("https://esports.estorb.com.evil.test/ESports/43/ALL"))
      .toThrow("SABA_ESPORTS_URL_INVALID");
    expect(() => exactSabaLolUrl("https://esports.estorb.com/ESports/1/ALL"))
      .toThrow("SABA_ESPORTS_URL_INVALID");
  });
});

