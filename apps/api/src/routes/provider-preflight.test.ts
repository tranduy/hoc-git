import type { ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerProviderPreflightRoutes } from "./provider-preflight.js";

const request: ProviderTicketPreflightRequest = { accountId: "account-1", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "HOME", line: "-0.5",
  expectedDecimalOdds: "2.2", requestedStake: "100000" };
const result: ProviderTicketPreflight = { accountId: "account-1", provider: "SABA", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "HOME", line: "-0.5",
  rawOdds: "1.2", rawFormat: "HK", decimalOdds: "2.2", quoteStatus: "OPEN",
  providerObservedAtMs: 1_100, receivedMonotonicMs: 75, sequence: 18,
  limitEvidence: { currency: "VND", minStake: "50000",
    maxStake: "200000", stakeStep: "1000", balance: "300000", verifiedAsOfMs: 1000, expiresAtMs: 3000 },
  constraint: { currency: "VND", minStake: "50000",
    maxStake: "200000", stakeStep: "1000", balance: "300000", feeType: "NONE", feeRate: null,
    verifiedAsOfMs: 1000, expiresAtMs: 3000 }, eligible: true, reasons: [] };

describe("provider preflight route", () => {
  it("returns strict no-store read-only ticket evidence", async () => {
    const app = Fastify(); registerProviderPreflightRoutes(app, { preflight: async () => result });
    const response = await app.inject({ method: "POST", url: "/api/preflight/provider", payload: request });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    await app.close();
  });

  it("rejects malformed requests and maps fail-closed provider errors", async () => {
    const app = Fastify(); registerProviderPreflightRoutes(app, { preflight: async () => {
      throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
    } });
    expect((await app.inject({ method: "POST", url: "/api/preflight/provider", payload: { ...request,
      providerSelectionId: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/preflight/provider", payload: request })).statusCode).toBe(422);
    await app.close();
  });

  it("logs the displayed pair before reading both providers and returns adjacent comparison evidence", async () => {
    const order: string[] = [];
    const journal: unknown[] = [];
    const provider = { preflight: async (input: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> => {
      order.push(`PROVIDER:${input.accountId}`);
      return { ...result, accountId: input.accountId, provider: input.accountId === "account-1" ? "SABA" : "CMD",
        providerEventId: input.providerEventId, providerMarketId: input.providerMarketId,
        providerSelectionId: input.providerSelectionId, selection: input.selection, line: input.line,
        rawOdds: input.accountId === "account-1" ? "1.2" : "0.9", rawFormat: "HK",
        decimalOdds: input.accountId === "account-1" ? "2.2" : "1.9" };
    } };
    const app = Fastify();
    const register = registerProviderPreflightRoutes as unknown as (target: typeof app, service: typeof provider,
      options: unknown) => void;
    register(app, provider, { clock: { nowMs: (() => { let now = 1_500; return () => ++now; })() },
      idFactory: () => "check-1", journal: { append: async (entry: unknown) => {
        const type = (entry as { type: string }).type; order.push(type); journal.push(entry);
      } } });
    const payload = { eventLabel: "Alpha vs Beta", marketType: "FT_TOTAL", scope: "FULL_TIME", capturedAtMs: 1_000,
      legs: [{ provider: "SABA", accountId: "account-1", providerEventId: "event-1", providerMarketId: "market-1",
        providerSelectionId: "selection-1", selection: "OVER", line: "2.5", rawOdds: "1.2", rawFormat: "HK",
        decimalOdds: "2.2", quoteStatus: "OPEN", providerObservedAtMs: 900, receivedMonotonicMs: 70,
        sequence: 17, requestedStake: "100000" },
      { provider: "CMD", accountId: "account-2", providerEventId: "event-2", providerMarketId: "market-2",
        providerSelectionId: "selection-2", selection: "UNDER", line: "2.5", rawOdds: "1.1", rawFormat: "HK",
        decimalOdds: "2.1", quoteStatus: "OPEN", providerObservedAtMs: 910, receivedMonotonicMs: 71,
        sequence: 12, requestedStake: "120000" }] };

    const response = await app.inject({ method: "POST", url: "/api/preflight/realtime-check", payload });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ checkId: "check-1", eventLabel: "Alpha vs Beta", persisted: true,
      legs: [{ status: "MATCH", displayed: { provider: "SABA", rawOdds: "1.2" },
        direct: { provider: "SABA", rawOdds: "1.2", decimalOdds: "2.2" }, error: null },
      { status: "ODDS_CHANGED", displayed: { provider: "CMD", rawOdds: "1.1" },
        direct: { provider: "CMD", rawOdds: "0.9", decimalOdds: "1.9" }, error: null }] });
    expect(order).toEqual(["DISPLAY_CAPTURED", "PROVIDER:account-1", "PROVIDER:account-2", "CHECK_COMPLETED"]);
    expect(journal).toHaveLength(2);
    await app.close();
  });

  it("returns a per-leg timeout without hiding the other provider result", async () => {
    let release: ((value: ProviderTicketPreflight) => void) | undefined;
    const provider = { preflight: async (input: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> =>
      input.accountId === "account-1" ? result : new Promise((resolve) => { release = resolve; }) };
    const app = Fastify();
    const register = registerProviderPreflightRoutes as unknown as (target: typeof app, service: typeof provider,
      options: unknown) => void;
    register(app, provider, { requestTimeoutMs: 5 });
    const displayed = { provider: "SABA", accountId: "account-1", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "HOME", line: "-0.5",
      rawOdds: "1.2", rawFormat: "HK", decimalOdds: "2.2", quoteStatus: "OPEN",
      providerObservedAtMs: 900, receivedMonotonicMs: 70, sequence: 17, requestedStake: "100000" };
    const pending = app.inject({ method: "POST", url: "/api/preflight/realtime-check", payload: {
      eventLabel: "Alpha vs Beta", marketType: "FT_TOTAL", scope: "FULL_TIME", capturedAtMs: 1_000,
      legs: [displayed, { ...displayed, provider: "CMD", accountId: "account-2", providerEventId: "event-2",
      providerMarketId: "market-2", providerSelectionId: "selection-2", selection: "AWAY" }]
    } });
    const outcome = await Promise.race([pending, new Promise<"deadline">((resolve) => setTimeout(() => resolve("deadline"), 30))]);
    release?.({ ...result, accountId: "account-2", provider: "CMD", providerEventId: "event-2",
      providerMarketId: "market-2", providerSelectionId: "selection-2", selection: "AWAY", line: "-0.5" });
    await pending;
    await app.close();

    expect(outcome).not.toBe("deadline");
    if (outcome !== "deadline") expect(outcome.json()).toMatchObject({
      legs: [{ status: "MATCH" }, { status: "TIMEOUT", direct: null, error: "PREFLIGHT_TIMEOUT" }]
    });
  });
});
