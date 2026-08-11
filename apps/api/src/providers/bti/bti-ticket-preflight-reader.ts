import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { toDecimal } from "@tool-chenh/core";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ProviderTicketPreflightReader } from "../provider-capabilities.js";
import type { BtiCatalogSnapshot } from "./bti-browser-manager.js";
import type { BtiTicketConstraintSnapshot } from "./bti-ticket-constraint.js";

export interface BtiPreflightSource {
  readCatalog(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<BtiCatalogSnapshot>;
  readTicketConstraint?(input: { readonly sessionId: string; readonly launchUrl: string;
    readonly providerEventId: string; readonly providerMarketId: string;
    readonly providerSelectionId: string; readonly participantA: string; readonly participantB: string;
    readonly marketType: string; readonly selection: string; readonly line: string | null;
    readonly rawOdds: string; readonly decimalOdds: string }): Promise<BtiTicketConstraintSnapshot | null>;
}

function plain(value: ReturnType<typeof toDecimal>): string { return value.toFixed(value.decimalPlaces()); }

export class BtiTicketPreflightReader implements ProviderTicketPreflightReader {
  readonly provider = "BTI" as const;
  readonly capabilities = ["PREFLIGHT"] as const;
  readonly #source: BtiPreflightSource;
  readonly #clock: { nowMs(): number };
  constructor(options: { readonly source: BtiPreflightSource; readonly clock?: { nowMs(): number } }) {
    this.#source = options.source;
    this.#clock = options.clock ?? { nowMs: Date.now };
  }

  async preflight(handle: ActiveSecretHandle, request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    if (handle.provider !== "BTI" || handle.category !== "FOOTBALL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
      const snapshot = await this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
      const normalized = normalizeSbobetCatalog(snapshot.records, { provider: "BTI",
        settlementProfile: "football-regulation-including-added-time", observedAtMs: snapshot.observedAtMs,
        receivedMonotonicMs: snapshot.receivedMonotonicMs, sequence: 1 });
      const quote = normalized.quotes.find((candidate) => candidate.providerEventId === request.providerEventId &&
        candidate.providerMarketId === request.providerMarketId &&
        candidate.providerSelectionId === request.providerSelectionId && candidate.selection === request.selection &&
        candidate.line === request.line);
      if (quote === undefined) throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
      const decimalOdds = plain(toDecimal(quote.rawOdds, quote.rawFormat));
      const event = normalized.events.find((candidate) => candidate.providerEventId === quote.providerEventId);
      if (event === undefined) throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
      const limit = await this.#source.readTicketConstraint?.({ sessionId: handle.sessionId, launchUrl: secret.value,
        providerEventId: quote.providerEventId, providerMarketId: quote.providerMarketId,
        providerSelectionId: quote.providerSelectionId, participantA: event.participantA, participantB: event.participantB,
        marketType: quote.marketType, selection: quote.selection, line: quote.line, rawOdds: quote.rawOdds, decimalOdds }) ?? null;
      const nowMs = this.#clock.nowMs();
      const freshLimit = limit !== null && limit.providerSelectionId === quote.providerSelectionId &&
        Number.isFinite(limit.observedAtMs) && limit.observedAtMs <= nowMs + 1_000 && nowMs - limit.observedAtMs <= 1_000;
      const constraint = freshLimit ? { currency: limit.currency, minStake: limit.minStake, maxStake: limit.maxStake,
        stakeStep: limit.stakeStep, balance: limit.balance, feeType: "NONE" as const, feeRate: null,
        verifiedAsOfMs: limit.observedAtMs, expiresAtMs: limit.observedAtMs + 3_000 } : null;
      const reasons: ProviderTicketPreflight["reasons"][number][] = [];
      if (constraint === null) reasons.push("LIMIT_UNAVAILABLE");
      if (decimalOdds !== request.expectedDecimalOdds) reasons.push("ODDS_CHANGED");
      if (quote.status !== "OPEN") reasons.push("MARKET_NOT_OPEN");
      if (constraint !== null) {
        const stake = toDecimal(request.requestedStake, "DECIMAL");
        if (stake.lt(toDecimal(constraint.minStake, "DECIMAL"))) reasons.push("BELOW_MIN");
        if (stake.gt(toDecimal(constraint.maxStake, "DECIMAL"))) reasons.push("ABOVE_MAX");
        if (!stake.mod(toDecimal(constraint.stakeStep, "DECIMAL")).isZero()) reasons.push("STAKE_STEP_MISMATCH");
        if (stake.gt(toDecimal(constraint.balance, "DECIMAL"))) reasons.push("INSUFFICIENT_BALANCE");
      }
      return { accountId: request.accountId, provider: "BTI", providerEventId: quote.providerEventId,
        providerMarketId: quote.providerMarketId, providerSelectionId: quote.providerSelectionId,
        selection: quote.selection, line: quote.line, decimalOdds, quoteStatus: quote.status,
        constraint, eligible: quote.status === "OPEN" && constraint !== null && reasons.length === 0, reasons };
    });
  }
}
