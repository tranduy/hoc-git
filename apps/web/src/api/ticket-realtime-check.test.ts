import type { TicketRealtimeCheckRequest, TicketRealtimeCheckResponse } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { TicketRealtimeCheckApi } from "./ticket-realtime-check.js";

const displayed = { provider: "SBOBET", accountId: "sbobet", providerEventId: "event",
  providerMarketId: "market", providerSelectionId: "over", selection: "OVER", line: "4.5",
  rawOdds: "-0.17", rawFormat: "MALAY", decimalOdds: "6.88235294117647", quoteStatus: "OPEN",
  providerObservedAtMs: 1_000, receivedMonotonicMs: 10, sequence: 2, requestedStake: "100000" } as const;
const request: TicketRealtimeCheckRequest = { eventLabel: "Philadelphia vs Inter Miami", marketType: "FT_TOTAL",
  participantA: "Philadelphia", participantB: "Inter Miami", scope: "FULL_TIME", capturedAtMs: 1_100,
  legs: [displayed, { ...displayed, provider: "APSPORT", accountId: "apsport", providerEventId: "event-ap",
    providerMarketId: "market-ap", providerSelectionId: "under", selection: "UNDER" }] };
const response: TicketRealtimeCheckResponse = { checkId: "check-1", eventLabel: request.eventLabel,
  participantA: request.participantA, participantB: request.participantB,
  marketType: request.marketType, scope: request.scope, capturedAtMs: request.capturedAtMs,
  completedAtMs: 1_200, persisted: true, legs: request.legs.map((leg) => ({ status: "MATCH",
    verificationStatus: "MATCH", directMethod: "DOM", displayed: leg,
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

  it("reports invalid receipt paths before fetch without exposing request values", async () => {
    let fetchCount = 0;
    const api = new TicketRealtimeCheckApi(async () => { fetchCount++; return new Response(); });
    const invalid = { ...request, eventLabel: "PRIVATE_EVENT_LABEL",
      legs: [request.legs[0], { ...request.legs[1], accountId: "PRIVATE_ACCOUNT_VALUE",
        receivedMonotonicMs: Number.POSITIVE_INFINITY, providerObservedAtMs: Number.NaN }] } as TicketRealtimeCheckRequest;

    await expect(api.check(invalid).catch(error => (error as Error).message)).resolves.toBe(
      "Invalid realtime ticket check request (fields: legs.1.providerObservedAtMs, legs.1.receivedMonotonicMs)");
    expect(fetchCount).toBe(0);
  });

  it("reports unknown request fields at the root without exposing their names or values", async () => {
    const api = new TicketRealtimeCheckApi(async () => { throw new Error("FETCH_MUST_NOT_RUN"); });
    const invalid = { ...request, PRIVATE_FIELD_NAME: "PRIVATE_FIELD_VALUE" };
    await expect(api.check(invalid).catch(error => (error as Error).message)).resolves.toBe(
      "Invalid realtime ticket check request (fields: request)");
  });

  it("reports malformed response paths without exposing returned values", async () => {
    const invalid = { ...response, legs: [{ ...response.legs[0], status: "PRIVATE_PROVIDER_RESPONSE" }, response.legs[1]] };
    const api = new TicketRealtimeCheckApi(async () => new Response(JSON.stringify(invalid),
      { status: 200, headers: { "content-type": "application/json" } }));
    await expect(api.check(request).catch(error => (error as Error).message)).resolves.toBe(
      "Invalid realtime ticket check response (fields: legs.0.status)");
  });

  it.each([-10_080, -180])("preserves a rebased BTI receipt of %s through the read-only audit round trip", async receivedMonotonicMs => {
    // BTI detail/roster caches can predate the current observer's monotonic origin.
    const signedRequest: TicketRealtimeCheckRequest = { ...request,
      legs: [{ ...request.legs[0], provider: "BTI", accountId: "bti", receivedMonotonicMs }, request.legs[1]] };
    const signedResponse: TicketRealtimeCheckResponse = { ...response,
      legs: [{ ...response.legs[0], displayed: signedRequest.legs[0], direct: null,
        status: "SOURCE_UNAVAILABLE", verificationStatus: null, error: "VISIBLE_PRICE_NOT_FOUND" }, response.legs[1]] };
    let posted: unknown;
    const api = new TicketRealtimeCheckApi(async (_input, init) => {
      posted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(signedResponse), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(api.check(signedRequest)).resolves.toEqual(signedResponse);
    expect(posted).toEqual(signedRequest);
  });
});
