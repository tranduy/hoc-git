import type { AccountStatus, ProviderId, ProviderTicketPreflight,
  ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import type { ProviderPreflightApiLike } from "../api/provider-preflight.js";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "../catalog/comparison.js";
import type { FixedBaseStakePolicy } from "./fixed-base-stake.js";
import { TicketPreflightCoordinator } from "./ticket-preflight-coordinator.js";

const nowMs = 10_000;
const policy: FixedBaseStakePolicy = { currency: "VND", baseStake: "100000", minStake: "30000",
  maxStake: "500000", stakeStep: "1000", balance: "500000" };

function catalog(provider: "SABA" | "SBOBET", accountId: string,
  odds: readonly [string, string]): LiveCatalogResponse {
  const eventId = `${provider}-event`;
  const marketId = `${provider}-market`;
  const selections = ["HOME", "AWAY"] as const;
  return {
    dataMode: "LIVE", accountId, provider, category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER",
    observedAtMs: nowMs, rejectedMarketCount: 0,
    events: [{ provider, category: "FOOTBALL", providerEventId: eventId, competition: "Test League",
      seasonStage: null, startAtUtcMs: 20_000, participantA: "Alpha FC", participantB: "Beta FC",
      eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
      fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null }],
    markets: [{ provider, category: "FOOTBALL", providerEventId: eventId, providerMarketId: marketId,
      marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5",
      settlementProfile: "football-regulation-including-added-time", status: "OPEN" }],
    quotes: selections.map((selection, index) => ({ provider, category: "FOOTBALL", providerEventId: eventId,
      providerMarketId: marketId, providerSelectionId: `${provider}-${selection}`, marketType: "FT_AH",
      scope: "FULL_TIME", selection, line: "-0.5", rawOdds: odds[index]!, rawFormat: "DECIMAL",
      status: "OPEN", isLive: false, sourceTimestampMs: nowMs, receivedMonotonicMs: 1, sequence: 1 }))
  };
}

function account(id: string, provider: ProviderId): AccountStatus {
  return { id, alias: id, provider, category: "FOOTBALL", sessionState: "ACTIVE", profileState: "FRESH",
    redactedLabel: null, currency: "VND", balance: "500000", balanceAsOfMs: nowMs,
    capabilities: ["CATALOG", "PROFILE", "PREFLIGHT"], reason: null };
}

function response(request: ProviderTicketPreflightRequest, provider: ProviderId,
  overrides: Partial<ProviderTicketPreflight> = {}): ProviderTicketPreflight {
  const constraint = { currency: "VND", minStake: "30000", maxStake: "500000", stakeStep: "5000",
    balance: "500000", feeType: "NONE" as const, feeRate: null, verifiedAsOfMs: nowMs, expiresAtMs: nowMs + 3_000 };
  return { accountId: request.accountId, provider, providerEventId: request.providerEventId,
    providerMarketId: request.providerMarketId, providerSelectionId: request.providerSelectionId,
    selection: request.selection, line: request.line, decimalOdds: request.expectedDecimalOdds,
    quoteStatus: "OPEN", limitEvidence: constraint, constraint, eligible: true, reasons: [], ...overrides };
}

class FakeApi implements ProviderPreflightApiLike {
  readonly requests: ProviderTicketPreflightRequest[] = [];
  constructor(private readonly mutate?: (value: ProviderTicketPreflight,
    request: ProviderTicketPreflightRequest) => ProviderTicketPreflight) {}
  async preflight(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    this.requests.push(request);
    const provider: ProviderId = request.accountId === "saba-account" ? "SABA" : "SBOBET";
    const value = response(request, provider);
    return this.mutate?.(value, request) ?? value;
  }
}

describe("TicketPreflightCoordinator", () => {
  it("verifies both exact final stakes after provider step rounding changes the hedge", async () => {
    const events = buildComparisonEvents([
      catalog("SABA", "saba-account", ["2.2", "1.2"]),
      catalog("SBOBET", "sbobet-account", ["1.2", "3"])
    ]);
    const api = new FakeApi();
    const coordinator = new TicketPreflightCoordinator(api, () => nowMs);

    const verified = await coordinator.refresh({ events,
      selectedAccounts: [account("saba-account", "SABA"), account("sbobet-account", "SBOBET")],
      selectedProviders: new Set<ProviderId>(["SABA", "SBOBET"]), policy });

    const evidence = [...verified.values()][0];
    expect(evidence?.plan.legs.map((leg) => ({ provider: leg.provider, stake: leg.stake }))).toEqual([
      { provider: "SABA", stake: "100000" }, { provider: "SBOBET", stake: "75000" }
    ]);
    expect(Number(evidence?.plan.worstCaseProfit)).toBeGreaterThanOrEqual(20_000);
    expect(api.requests.filter((request) => request.providerSelectionId === "SBOBET-AWAY")
      .map((request) => request.requestedStake)).toEqual(["73000", "75000"]);
    expect(api.requests.every((request) => request.requestedStake !== "0")).toBe(true);
  });

  it("fails closed when either final leg identity or eligibility is invalid", async () => {
    const events = buildComparisonEvents([
      catalog("SABA", "saba-account", ["2.5", "1.2"]),
      catalog("SBOBET", "sbobet-account", ["1.2", "2.5"])
    ]);
    const api = new FakeApi((value) => value.provider === "SBOBET"
      ? { ...value, providerMarketId: "wrong-market" } : value);
    const coordinator = new TicketPreflightCoordinator(api, () => nowMs);

    const verified = await coordinator.refresh({ events,
      selectedAccounts: [account("saba-account", "SABA"), account("sbobet-account", "SBOBET")],
      selectedProviders: new Set<ProviderId>(["SABA", "SBOBET"]), policy });

    expect(verified.size).toBe(0);
  });

  it("does not verify with one account reused for both providers or without PREFLIGHT capability", async () => {
    const events = buildComparisonEvents([
      catalog("SABA", "shared", ["2.5", "1.2"]), catalog("SBOBET", "shared", ["1.2", "2.5"])
    ]);
    const noPreflight = { ...account("shared", "SABA"), capabilities: ["CATALOG"] as const };
    const api = new FakeApi();
    const coordinator = new TicketPreflightCoordinator(api, () => nowMs);

    const verified = await coordinator.refresh({ events, selectedAccounts: [noPreflight],
      selectedProviders: new Set<ProviderId>(["SABA", "SBOBET"]), policy });

    expect(verified.size).toBe(0);
    expect(api.requests).toEqual([]);
  });
});
