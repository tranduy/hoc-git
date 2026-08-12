import { normalizeObservedFootballCatalog, type CmdCatalogInputRecord } from "@tool-chenh/adapters";
import type { ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { Decimal, toDecimal, type FeeModel } from "@tool-chenh/core";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ProviderTicketPreflightReader } from "../provider-capabilities.js";
import type { CmdTicketConstraintSnapshot } from "../cmd/cmd-ticket-constraint.js";
import { normalizeSabaMoney } from "./saba-money.js";

export interface SabaPreflightSource {
  readCatalog(input: { sessionId: string; launchUrl: string }): Promise<readonly CmdCatalogInputRecord[]>;
  readTicketConstraint?(input: { sessionId: string; launchUrl: string; providerEventId: string;
    providerMarketId: string; providerSelectionId: string; selection: "HOME" | "AWAY" }):
    Promise<CmdTicketConstraintSnapshot | null>;
}

function plain(value: ReturnType<typeof toDecimal>): string { return value.toFixed(value.decimalPlaces()); }

export class SabaTicketPreflightReader implements ProviderTicketPreflightReader {
  readonly provider = "SABA" as const;
  readonly capabilities = ["PREFLIGHT"] as const;
  readonly #source: SabaPreflightSource;
  readonly #clock: { nowMs(): number; monotonicNowMs(): number };
  readonly #fee: FeeModel | null;

  constructor(options: { readonly source: SabaPreflightSource;
    readonly clock?: { nowMs(): number; monotonicNowMs(): number }; readonly fee?: FeeModel }) {
    this.#source = options.source;
    this.#clock = options.clock ?? { nowMs: Date.now, monotonicNowMs: () => performance.now() };
    this.#fee = options.fee ?? null;
  }

  async preflight(handle: ActiveSecretHandle, request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    if (handle.provider !== "SABA" || handle.category !== "FOOTBALL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
      const observedAtMs = this.#clock.nowMs();
      const records = await this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
      const normalized = normalizeObservedFootballCatalog("SABA", records, { observedAtMs,
        receivedMonotonicMs: this.#clock.monotonicNowMs(), timezoneOffsetMinutes: 420, sequence: 1 });
      const quote = normalized.quotes.find((item) => item.providerEventId === request.providerEventId &&
        item.providerMarketId === request.providerMarketId && item.providerSelectionId === request.providerSelectionId &&
        item.selection === request.selection && item.line === request.line);
      if (quote === undefined || (quote.selection !== "HOME" && quote.selection !== "AWAY")) {
        throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
      }
      const limit = await this.#source.readTicketConstraint?.({ sessionId: handle.sessionId, launchUrl: secret.value,
        providerEventId: quote.providerEventId, providerMarketId: quote.providerMarketId,
        providerSelectionId: quote.providerSelectionId, selection: quote.selection }) ?? null;
      const nowMs = this.#clock.nowMs();
      const fresh = limit !== null && limit.providerSelectionId === quote.providerSelectionId &&
        limit.observedAtMs <= nowMs + 1_000 && nowMs - limit.observedAtMs <= 1_000;
      const minStake = fresh ? normalizeSabaMoney({ currency: limit.currency, amount: limit.minStake }) : null;
      const maxStake = fresh ? normalizeSabaMoney({ currency: limit.currency, amount: limit.maxStake }) : null;
      const stakeStep = fresh ? normalizeSabaMoney({ currency: limit.currency, amount: limit.stakeStep }) : null;
      const balance = fresh ? normalizeSabaMoney({ currency: limit.currency, amount: limit.balance }) : null;
      const completeMoney = minStake !== null && maxStake !== null && stakeStep !== null && balance !== null &&
        minStake.unitScale === maxStake.unitScale && minStake.unitScale === stakeStep.unitScale &&
        minStake.unitScale === balance.unitScale;
      const constraint = fresh && completeMoney && this.#fee !== null ? { currency: "VND" as const, minStake: minStake.amount,
        maxStake: maxStake.amount, stakeStep: stakeStep.amount, balance: balance.amount,
        feeType: this.#fee.type, feeRate: this.#fee.type === "NONE" ? null : plain(new Decimal(this.#fee.rate)),
        verifiedAsOfMs: limit.observedAtMs,
        expiresAtMs: limit.observedAtMs + 3_000 } : null;
      const rawOdds = fresh ? limit.rawOdds : quote.rawOdds;
      const decimalOdds = plain(toDecimal(rawOdds, quote.rawFormat));
      const reasons: ProviderTicketPreflight["reasons"][number][] = [];
      if (!fresh || !completeMoney) reasons.push("LIMIT_UNAVAILABLE");
      if (this.#fee === null) reasons.push("FINANCIAL_POLICY_UNAVAILABLE");
      if (decimalOdds !== request.expectedDecimalOdds) reasons.push("ODDS_CHANGED");
      if (quote.status !== "OPEN") reasons.push("MARKET_NOT_OPEN");
      if (constraint !== null) {
        const stake = toDecimal(request.requestedStake, "DECIMAL");
        if (stake.lt(constraint.minStake)) reasons.push("BELOW_MIN");
        if (stake.gt(constraint.maxStake)) reasons.push("ABOVE_MAX");
        if (!stake.mod(constraint.stakeStep).isZero()) reasons.push("STAKE_STEP_MISMATCH");
        if (stake.gt(constraint.balance)) reasons.push("INSUFFICIENT_BALANCE");
      }
      return { accountId: request.accountId, provider: "SABA", providerEventId: quote.providerEventId,
        providerMarketId: quote.providerMarketId, providerSelectionId: quote.providerSelectionId,
        selection: quote.selection, line: quote.line, decimalOdds, quoteStatus: quote.status, constraint,
        eligible: quote.status === "OPEN" && constraint !== null && reasons.length === 0, reasons };
    });
  }
}
