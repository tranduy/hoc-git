import type { TicketRealtimeCheckRequest, TicketRealtimeCheckResponse } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { TicketRealtimeCheckApi } from "./ticket-realtime-check.js";

const displayed = { provider: "SBOBET", accountId: "sbobet", providerEventId: "event",
  providerMarketId: "market", providerSelectionId: "over", selection: "OVER", line: "4.5",
  rawOdds: "-0.17", rawFormat: "MALAY", decimalOdds: "6.88235294117647", quoteStatus: "OPEN",
  providerObservedAtMs: 1_000, receivedMonotonicMs: 10, sequence: 2, requestedStake: "100000" } as const;
const request: TicketRealtimeCheckRequest = { eventLabel: "Philadelphia vs Inter Miami", marketType: "FT_TOTAL",
  scope: "FULL_TIME", capturedAtMs: 1_100,
  legs: [displayed, { ...displayed, provider: "APSPORT", accountId: "apsport", providerEventId: "event-ap",
    providerMarketId: "market-ap", providerSelectionId: "under", selection: "UNDER" }] };
const response: TicketRealtimeCheckResponse = { checkId: "check-1", eventLabel: request.eventLabel,
  marketType: request.marketType, scope: request.scope, capturedAtMs: request.capturedAtMs,
  completedAtMs: 1_200, persisted: true, legs: request.legs.map((leg) => ({ status: "MATCH", displayed: leg,
    direct: { accountId: leg.accountId, provider: leg.provider, providerEventId: leg.providerEventId,
      providerMarketId: leg.providerMarketId, providerSelectionId: leg.providerSelectionId,
      selection: leg.selection, line: leg.line, rawOdds: leg.rawOdds, rawFormat: leg.rawFormat,
      decimalOdds: leg.decimalOdds, quoteStatus: "OPEN", providerObservedAtMs: 1_150,
      receivedMonotonicMs: 11, sequence: 3, limitEvidence: null, constraint: null,
      eligible: false, reasons: ["LIMIT_UNAVAILABLE"] }, error: null,
    startedAtMs: 1_101, completedAtMs: 1_150, elapsedMs: 49 })) as unknown as TicketRealtimeCheckResponse["legs"] };

describe("TicketRealtimeCheckApi", () => {
  it("posts the exact displayed pair with no-store and strictly parses the direct result", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = new TicketRealtimeCheckApi(async (input, init) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(api.check(request)).resolves.toEqual(response);
    expect(calls[0]).toMatchObject({ url: "/api/preflight/realtime-check",
      init: { method: "POST", cache: "no-store", headers: { "content-type": "application/json" } } });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(request);
  });

  it("rejects malformed results", async () => {
    const api = new TicketRealtimeCheckApi(async () => new Response(JSON.stringify({ ...response, legs: [] }),
      { status: 200, headers: { "content-type": "application/json" } }));
    await expect(api.check(request)).rejects.toThrow("Invalid realtime ticket check response");
  });
});
