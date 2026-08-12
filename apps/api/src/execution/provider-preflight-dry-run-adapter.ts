import type { ExecutionLegResult, PreflightLeg, ProviderId, ProviderTicketPreflight,
  ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import type { ExecutionLegAdapter } from "./two-leg-executor.js";

interface ProviderPreflightLike {
  preflight(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight>;
}

export class ProviderPreflightDryRunAdapter implements ExecutionLegAdapter {
  readonly provider: ProviderId;
  readonly #preflight: ProviderPreflightLike["preflight"];

  constructor(options: { readonly provider: ProviderId; readonly preflight: ProviderPreflightLike["preflight"] }) {
    this.provider = options.provider;
    this.#preflight = options.preflight;
  }

  async dryRun(leg: PreflightLeg): Promise<ExecutionLegResult> {
    const result = await this.#preflight({ accountId: leg.accountId, providerEventId: leg.providerEventId,
      providerMarketId: leg.providerMarketId, providerSelectionId: leg.providerSelectionId,
      selection: leg.selection, line: leg.line, expectedDecimalOdds: leg.decimalOdds, requestedStake: leg.stake });
    const identity = { provider: leg.provider, providerSelectionId: leg.providerSelectionId } as const;
    if (result.provider !== leg.provider || result.providerSelectionId !== leg.providerSelectionId) {
      return { ...identity, status: "UNKNOWN", reason: "IDENTITY_MISMATCH" };
    }
    if (result.quoteStatus !== "OPEN" || result.reasons.includes("MARKET_NOT_OPEN")) {
      return { ...identity, status: "REJECTED", reason: "MARKET_SUSPENDED" };
    }
    if (result.constraint === null || result.reasons.includes("FINANCIAL_POLICY_UNAVAILABLE") ||
      result.reasons.includes("LIMIT_UNAVAILABLE")) {
      return { ...identity, status: "UNKNOWN", reason: "ADAPTER_UNAVAILABLE" };
    }
    if (result.reasons.includes("ODDS_CHANGED")) {
      return { ...identity, status: "REJECTED", reason: "ODDS_CHANGED" };
    }
    if (result.reasons.includes("INSUFFICIENT_BALANCE")) {
      return { ...identity, status: "REJECTED", reason: "INSUFFICIENT_BALANCE" };
    }
    if (result.reasons.some((reason) => ["BELOW_MIN", "ABOVE_MAX", "STAKE_STEP_MISMATCH"].includes(reason))) {
      return { ...identity, status: "REJECTED", reason: "LIMIT_CHANGED" };
    }
    return result.eligible
      ? { ...identity, status: "ACCEPTED", reason: null }
      : { ...identity, status: "REJECTED", reason: "PROVIDER_REJECTED" };
  }
}
