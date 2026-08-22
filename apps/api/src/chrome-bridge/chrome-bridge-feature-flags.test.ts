import { describe, expect, it } from "vitest";
import { isOpenProviderTicketEnabled } from "./chrome-bridge-feature-flags.js";

describe("chrome bridge feature flags", () => {
  it("keeps bookmaker-focus controls hidden unless explicitly enabled", () => {
    expect(isOpenProviderTicketEnabled(undefined)).toBe(false);
    expect(isOpenProviderTicketEnabled("false")).toBe(false);
    expect(isOpenProviderTicketEnabled("true")).toBe(true);
  });
});
