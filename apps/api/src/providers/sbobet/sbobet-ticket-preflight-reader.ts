import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { Decimal, toDecimal, type FeeModel } from "@tool-chenh/core";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ProviderTicketPreflightReader } from "../provider-capabilities.js";
import type { SbobetCatalogSnapshot } from "./sbobet-browser-manager.js";
import type { SbobetTicketConstraintSnapshot } from "./sbobet-ticket-constraint.js";

export interface SbobetPreflightSource {
  readCatalog(input: { sessionId: string; launchUrl: string }): Promise<SbobetCatalogSnapshot>;
  readTicketConstraint?(input: { sessionId: string; launchUrl: string; providerSelectionId: string;
    participantA: string; participantB: string; selection: string; line: string | null; rawOdds: string }):
    Promise<SbobetTicketConstraintSnapshot | null>;
}
function plain(value: ReturnType<typeof toDecimal>): string { return value.toFixed(value.decimalPlaces()); }
export class SbobetTicketPreflightReader implements ProviderTicketPreflightReader {
  readonly provider = "SBOBET" as const; readonly capabilities = ["PREFLIGHT"] as const;
  readonly #source: SbobetPreflightSource; readonly #clock: { nowMs(): number }; readonly #fee: FeeModel | null;
  constructor(options: { source: SbobetPreflightSource; clock?: { nowMs(): number }; fee?: FeeModel }) {
    this.#source = options.source; this.#clock = options.clock ?? { nowMs: Date.now }; this.#fee = options.fee ?? null;
  }
  async preflight(handle: ActiveSecretHandle, request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    if (handle.provider !== "SBOBET" || handle.category !== "FOOTBALL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
      const snapshot = await this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
      const normalized = normalizeSbobetCatalog(snapshot.records, { provider: "SBOBET",
        settlementProfile: "football-regulation-including-added-time", observedAtMs: snapshot.observedAtMs,
        receivedMonotonicMs: snapshot.receivedMonotonicMs, sequence: 1 });
      const quote = normalized.quotes.find((item) => item.providerEventId === request.providerEventId &&
        item.providerMarketId === request.providerMarketId && item.providerSelectionId === request.providerSelectionId &&
        item.selection === request.selection && item.line === request.line);
      if (quote === undefined) throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
      const decimalOdds = plain(toDecimal(quote.rawOdds, quote.rawFormat));
      const event = normalized.events.find((item) => item.providerEventId === quote.providerEventId);
      if (event === undefined) throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
      const limit = await this.#source.readTicketConstraint?.({ sessionId: handle.sessionId, launchUrl: secret.value,
        providerSelectionId: quote.providerSelectionId, participantA: event.participantA, participantB: event.participantB,
        selection: quote.selection, line: quote.line, rawOdds: quote.rawOdds }) ?? null;
      const nowMs = this.#clock.nowMs();
      const fresh = limit !== null && limit.providerSelectionId === quote.providerSelectionId &&
        Number.isFinite(limit.observedAtMs) && limit.observedAtMs <= nowMs + 1000 && nowMs - limit.observedAtMs <= 1000;
      const limitEvidence = fresh ? { currency: limit.currency, minStake: limit.minStake, maxStake: limit.maxStake,
        stakeStep: limit.stakeStep, balance: limit.balance,
        verifiedAsOfMs: limit.observedAtMs, expiresAtMs: limit.observedAtMs + 3000 } : null;
      const constraint = limitEvidence !== null && this.#fee !== null ? { ...limitEvidence, feeType: this.#fee.type,
        feeRate: this.#fee.type === "NONE" ? null : plain(new Decimal(this.#fee.rate)),
      } : null;
      const reasons: ProviderTicketPreflight["reasons"][number][] = [];
      if (!fresh) reasons.push("LIMIT_UNAVAILABLE");
      if (this.#fee === null) reasons.push("FINANCIAL_POLICY_UNAVAILABLE");
      if (decimalOdds !== request.expectedDecimalOdds) reasons.push("ODDS_CHANGED");
      if (quote.status !== "OPEN") reasons.push("MARKET_NOT_OPEN");
      if (limitEvidence !== null) {
        const stake = toDecimal(request.requestedStake, "DECIMAL");
        if (stake.lt(toDecimal(limitEvidence.minStake, "DECIMAL"))) reasons.push("BELOW_MIN");
        if (stake.gt(toDecimal(limitEvidence.maxStake, "DECIMAL"))) reasons.push("ABOVE_MAX");
        if (!stake.mod(toDecimal(limitEvidence.stakeStep, "DECIMAL")).isZero()) reasons.push("STAKE_STEP_MISMATCH");
        if (stake.gt(toDecimal(limitEvidence.balance, "DECIMAL"))) reasons.push("INSUFFICIENT_BALANCE");
      }
      return { accountId: request.accountId, provider: "SBOBET", providerEventId: quote.providerEventId,
        providerMarketId: quote.providerMarketId, providerSelectionId: quote.providerSelectionId,
        selection: quote.selection, line: quote.line, decimalOdds, quoteStatus: quote.status, limitEvidence, constraint,
        eligible: quote.status === "OPEN" && constraint !== null && reasons.length === 0, reasons };
    });
  }
}
