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
  it("persists a complete operator report and lists it by canonical event", async () => {
    const entries: unknown[] = [];
    const reportJournal = {
      append: async (entry: unknown) => { entries.push(entry); },
      list: async (eventKey: string) => entries.filter((entry) =>
        (entry as { request: { eventKey: string } }).request.eventKey === eventKey)
    };
    const app = Fastify();
    const register = registerProviderPreflightRoutes as unknown as (target: typeof app,
      service: { preflight(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> },
      options: unknown) => void;
    register(app, { preflight: async () => result }, { reportJournal, idFactory: () => "report-1",
      clock: { nowMs: () => 2_000 } });
    const displayed = { provider: "SABA", accountId: "saba-account", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-home", selection: "HOME", line: "-0.5",
      rawOdds: "0.91", rawFormat: "MALAY", decimalOdds: "1.91", quoteStatus: "OPEN",
      providerObservedAtMs: 1_900, receivedMonotonicMs: 70, sequence: 17, requestedStake: "100000" };
    const payload = { eventKey: "canonical-event-1", ticketKey: "FT_AH|FULL_TIME|-0.5",
      reason: "Giá trên sàn khác giá tool", reportedAtMs: 1_950, competition: "Premier Test",
      startAtUtcMs: 3_000, display: { eventLabel: "Alpha vs Beta", participantA: "Alpha", participantB: "Beta",
        marketType: "FT_AH", scope: "FULL_TIME", capturedAtMs: 1_950,
        legs: [displayed, { ...displayed, provider: "CMD", accountId: "cmd-account",
          providerEventId: "event-2", providerMarketId: "market-2", providerSelectionId: "selection-away",
          selection: "AWAY", rawOdds: "0.95", decimalOdds: "1.95" }] },
      estimate: { state: "OBSERVATION", roi: "-0.02", worstCaseProfit: "-2000", totalStake: "200000",
        movementMagnitude: "0.04" }, realtimeCheck: null };

    const created = await app.inject({ method: "POST", url: "/api/ticket-reports", payload });
    const listed = await app.inject({ method: "GET",
      url: "/api/ticket-reports?eventKey=canonical-event-1" });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ reportId: "report-1", createdAtMs: 2_000,
      request: { reason: "Giá trên sàn khác giá tool", display: { legs: [
        { providerSelectionId: "selection-home", rawOdds: "0.91", sequence: 17 },
        { providerSelectionId: "selection-away", rawOdds: "0.95", sequence: 17 }
      ] }, realtimeCheck: null } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ reports: [created.json()] });
    await app.close();
  });

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
    const payload = { eventLabel: "Alpha vs Beta", participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", capturedAtMs: 1_000,
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

  it("uses only post-click prices read from the attached bookmaker DOM when that probe is configured", async () => {
    const provider = { preflight: async (): Promise<ProviderTicketPreflight> => {
      throw new Error("catalog preflight must not run for a visible-price check");
    } };
    const probes: unknown[] = [];
    const app = Fastify();
    registerProviderPreflightRoutes(app, provider, { visiblePriceProbe: { probe: async (input) => {
      probes.push(input);
      return { rawOdds: input.provider === "SABA" ? "1.2" : "0.9", observedAtMs: 1_020,
        method: input.provider === "SABA" ? "DOM" : "IN_PAGE_FETCH" };
    } }, clock: { nowMs: (() => { let now = 1_030; return () => ++now; })() }, idFactory: () => "dom-check" });
    const displayed = { provider: "SABA" as const, accountId: "account-1", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "OVER", line: "2.5",
      rawOdds: "1.2", rawFormat: "HK" as const, decimalOdds: "2.2000000000000002", quoteStatus: "OPEN" as const,
      providerObservedAtMs: 900, receivedMonotonicMs: 70, sequence: 17, requestedStake: "100000" };
    const response = await app.inject({ method: "POST", url: "/api/preflight/realtime-check", payload: {
      eventLabel: "Alpha vs Beta", participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", capturedAtMs: 1_000,
      legs: [displayed, { ...displayed, provider: "CMD", accountId: "account-2", providerEventId: "event-2",
        providerMarketId: "market-2", providerSelectionId: "selection-2", selection: "UNDER", rawOdds: "1.1",
        decimalOdds: "2.1", providerParticipantA: "Beta Local", providerParticipantB: "Alpha Local",
        providerSelection: "OVER", providerLine: "-2.5" }]
    } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ legs: [
      { status: "MATCH", verificationStatus: "MATCH", directMethod: "DOM",
        direct: { provider: "SABA", rawOdds: "1.2", decimalOdds: "2.2",
        providerObservedAtMs: 1_020, sequence: null } },
      { status: "ODDS_CHANGED", verificationStatus: "MISMATCH", directMethod: "IN_PAGE_FETCH",
        direct: { provider: "CMD", rawOdds: "0.9", decimalOdds: "1.9",
        providerObservedAtMs: 1_020, sequence: null } }
    ] });
    expect(probes).toEqual([
      { provider: "SABA", providerEventId: "event-1", providerMarketId: "market-1",
        providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
        participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL",
        scope: "FULL_TIME", selection: "OVER", line: "2.5", requestedAtMs: 1_000 },
      { provider: "CMD", providerEventId: "event-2", providerMarketId: "market-2",
        providerSelectionId: "selection-2", eventLabel: "Beta Local vs Alpha Local",
        participantA: "Beta Local", participantB: "Alpha Local", marketType: "FT_TOTAL",
        scope: "FULL_TIME", selection: "OVER", line: "-2.5", requestedAtMs: 1_000 }
    ]);
    const completed = response.json();
    expect(completed).toMatchObject({ participantA: "Alpha", participantB: "Beta" });
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
      eventLabel: "Alpha vs Beta", participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", capturedAtMs: 1_000,
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

  it("logs distinct NOT_FOUND and AMBIGUOUS direct outcomes with their attempted read methods", async () => {
    const journal: unknown[] = [];
    const provider = { preflight: async (): Promise<ProviderTicketPreflight> => result };
    const app = Fastify();
    registerProviderPreflightRoutes(app, provider, { journal: { append: async (entry) => { journal.push(entry); } },
      visiblePriceProbe: { probe: async (input) => {
        throw Object.assign(new Error(input.provider === "SABA" ? "VISIBLE_PRICE_NOT_FOUND" :
          "VISIBLE_PRICE_AMBIGUOUS"), { method: input.provider === "SABA" ? "DOM" : "IN_PAGE_FETCH" });
      } } });
    const displayed = { provider: "SABA" as const, accountId: "account-1", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "OVER", line: "2.5",
      rawOdds: "1.2", rawFormat: "HK" as const, decimalOdds: "2.2", quoteStatus: "OPEN" as const,
      providerObservedAtMs: 900, receivedMonotonicMs: 70, sequence: 17, requestedStake: "100000" };
    const response = await app.inject({ method: "POST", url: "/api/preflight/realtime-check", payload: {
      eventLabel: "Alpha vs Beta", participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", capturedAtMs: 1_000,
      legs: [displayed, { ...displayed, provider: "BTI", accountId: "account-2",
        providerEventId: "event-2", providerMarketId: "market-2", providerSelectionId: "selection-2",
        selection: "UNDER" }]
    } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ legs: [
      { verificationStatus: "NOT_FOUND", directMethod: "DOM", direct: null },
      { verificationStatus: "AMBIGUOUS", directMethod: "IN_PAGE_FETCH", direct: null }
    ] });
    expect(journal[0]).toMatchObject({ type: "DISPLAY_CAPTURED", request: {
      participantA: "Alpha", participantB: "Beta", legs: [
        { providerEventId: "event-1", providerMarketId: "market-1", providerSelectionId: "selection-1" },
        { providerEventId: "event-2", providerMarketId: "market-2", providerSelectionId: "selection-2" }
      ] } });
    expect(journal[1]).toMatchObject({ type: "CHECK_COMPLETED", legs: [
      { verificationStatus: "NOT_FOUND", directMethod: "DOM" },
      { verificationStatus: "AMBIGUOUS", directMethod: "IN_PAGE_FETCH" }
    ] });
    await app.close();
  });
});
