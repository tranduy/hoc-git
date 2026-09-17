import type { TicketRealtimeCheckResponse } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { ticketRealtimeCheckInvalidates, ticketRealtimeCheckInvalidatesDisplayedVersion } from
  "./ticket-realtime-validation.js";

function response(status: "MATCH" | "ODDS_CHANGED" | "SOURCE_UNAVAILABLE"): TicketRealtimeCheckResponse {
  return { legs: [{ status, verificationStatus: status === "MATCH" ? "MATCH" :
    status === "ODDS_CHANGED" ? "MISMATCH" : null }] } as unknown as TicketRealtimeCheckResponse;
}

describe("ticket realtime validation", () => {
  it("invalidates the displayed quote version when its direct price changed", () => {
    expect(ticketRealtimeCheckInvalidatesDisplayedVersion(response("ODDS_CHANGED"))).toBe(true);
    expect(ticketRealtimeCheckInvalidates(response("ODDS_CHANGED"))).toBe(false);
  });

  it("keeps an exact match but invalidates a displayed version whose source cannot be loaded", () => {
    expect(ticketRealtimeCheckInvalidates(response("MATCH"))).toBe(false);
    expect(ticketRealtimeCheckInvalidates(response("SOURCE_UNAVAILABLE"))).toBe(false);
    expect(ticketRealtimeCheckInvalidatesDisplayedVersion(response("SOURCE_UNAVAILABLE"))).toBe(true);
  });
});
