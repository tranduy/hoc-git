import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { Decimal, toDecimal, type FeeModel } from "@tool-chenh/core";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ProviderTicketPreflightReader } from "../provider-capabilities.js";
import type { ApsportCatalogSnapshot } from "./apsport-browser-manager.js";
import type { ApsportTicketConstraintSnapshot } from "./apsport-ticket-constraint.js";

export interface ApsportPreflightSource {
  readCatalog(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<ApsportCatalogSnapshot>;
  readTicketConstraint?(input: { readonly sessionId: string; readonly launchUrl: string;
    readonly providerSelectionId: string }): Promise<ApsportTicketConstraintSnapshot | null>;
}

function plain(value: ReturnType<typeof toDecimal>): string { return value.toFixed(value.decimalPlaces()); }

export class ApsportTicketPreflightReader implements ProviderTicketPreflightReader {
  readonly provider = "APSPORT" as const;
  readonly capabilities = ["PREFLIGHT"] as const;
  readonly #source: ApsportPreflightSource;
  readonly #clock: { nowMs(): number };
  readonly #fee: FeeModel | null;
  constructor(options: { readonly source: ApsportPreflightSource; readonly clock?: { nowMs(): number };
    readonly fee?: FeeModel }) {
    this.#source = options.source; this.#clock = options.clock ?? { nowMs: Date.now }; this.#fee = options.fee ?? null;
  }

  async preflight(handle: ActiveSecretHandle, request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    if (handle.provider !== "APSPORT" || handle.category !== "FOOTBALL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
      const snapshot = await this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
      const normalized = normalizeSbobetCatalog(snapshot.records, { provider: "APSPORT",
        settlementProfile: "football-regulation-including-added-time", observedAtMs: snapshot.observedAtMs,
        receivedMonotonicMs: snapshot.receivedMonotonicMs, sequence: 1 });
      const quote = normalized.quotes.find((candidate) => candidate.providerEventId === request.providerEventId &&
        candidate.providerMarketId === request.providerMarketId &&
        candidate.providerSelectionId === request.providerSelectionId && candidate.selection === request.selection &&
        candidate.line === request.line);
      if (quote === undefined) throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
      const decimalOdds = plain(toDecimal(quote.rawOdds, quote.rawFormat));
      const limit = await this.#source.readTicketConstraint?.({ sessionId: handle.sessionId,
        launchUrl: secret.value, providerSelectionId: quote.providerSelectionId }) ?? null;
      const nowMs = this.#clock.nowMs();
      const fresh = limit !== null && limit.providerSelectionId === quote.providerSelectionId &&
        Number.isFinite(limit.observedAtMs) && limit.observedAtMs <= nowMs + 1_000 && nowMs - limit.observedAtMs <= 1_000;
      const constraint = fresh && this.#fee !== null ? { currency: limit.currency, minStake: limit.minStake, maxStake: limit.maxStake,
        stakeStep: limit.stakeStep, balance: limit.balance, feeType: this.#fee.type,
        feeRate: this.#fee.type === "NONE" ? null : plain(new Decimal(this.#fee.rate)),
        verifiedAsOfMs: limit.observedAtMs, expiresAtMs: limit.observedAtMs + 3_000 } : null;
      const reasons: ProviderTicketPreflight["reasons"][number][] = [];
      if (!fresh) reasons.push("LIMIT_UNAVAILABLE");
      if (this.#fee === null) reasons.push("FINANCIAL_POLICY_UNAVAILABLE");
      if (decimalOdds !== request.expectedDecimalOdds) reasons.push("ODDS_CHANGED");
      if (quote.status !== "OPEN") reasons.push("MARKET_NOT_OPEN");
      if (constraint !== null) {
        const stake = toDecimal(request.requestedStake, "DECIMAL");
        if (stake.lt(toDecimal(constraint.minStake, "DECIMAL"))) reasons.push("BELOW_MIN");
        if (stake.gt(toDecimal(constraint.maxStake, "DECIMAL"))) reasons.push("ABOVE_MAX");
        if (!stake.mod(toDecimal(constraint.stakeStep, "DECIMAL")).isZero()) reasons.push("STAKE_STEP_MISMATCH");
        if (stake.gt(toDecimal(constraint.balance, "DECIMAL"))) reasons.push("INSUFFICIENT_BALANCE");
      }
      return { accountId: request.accountId, provider: "APSPORT", providerEventId: quote.providerEventId,
        providerMarketId: quote.providerMarketId, providerSelectionId: quote.providerSelectionId,
        selection: quote.selection, line: quote.line, decimalOdds, quoteStatus: quote.status,
        constraint, eligible: quote.status === "OPEN" && constraint !== null && reasons.length === 0, reasons };
    });
  }
}
