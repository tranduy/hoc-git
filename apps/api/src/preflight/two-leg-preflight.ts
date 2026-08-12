import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { PreflightRequestSchema, PreflightTicketSchema, type Opportunity, type PreflightRequest,
  type PreflightTicket, type ProviderId, type ProviderTicketPreflight,
  type ProviderStakeConstraint, type ProviderTicketPreflightRequest, type StakeLeg } from "@tool-chenh/contracts";
import { Decimal, effectiveDecimal } from "@tool-chenh/core";

interface OpportunitySource {
  getSnapshot(): { readonly opportunities: readonly Opportunity[] };
}

interface ProviderPreflightSource {
  providerForAccount(accountId: string): Promise<ProviderId>;
  preflight(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight>;
}

interface Clock { nowMs(): number }

function plain(value: Decimal): string {
  return value.toFixed(value.decimalPlaces());
}

function driftBps(expected: string, actual: string): Decimal {
  const base = new Decimal(expected);
  if (!base.isFinite() || base.lte(0)) throw new Error("PREFLIGHT_ODDS_DRIFT");
  return new Decimal(actual).minus(base).abs().div(base).mul(10_000);
}

function feeFor(leg: StakeLeg): { type: "NONE" } | { type: "PROFIT" | "PAYOUT"; rate: string } {
  return leg.feeType === "NONE" ? { type: "NONE" } : { type: leg.feeType, rate: leg.feeRate! };
}

function stakeFitsConstraint(stakeText: string, constraint: ProviderStakeConstraint): boolean {
  try {
    const stake = new Decimal(stakeText);
    const min = new Decimal(constraint.minStake);
    const max = new Decimal(constraint.maxStake);
    const step = new Decimal(constraint.stakeStep);
    const balance = new Decimal(constraint.balance);
    return stake.isFinite() && min.isFinite() && max.isFinite() && step.isFinite() && balance.isFinite() &&
      stake.gte(min) && stake.lte(max) && stake.lte(balance) && step.gt(0) && stake.mod(step).isZero();
  } catch {
    return false;
  }
}

export class TwoLegPreflight {
  readonly #opportunities: OpportunitySource;
  readonly #providers: ProviderPreflightSource;
  readonly #clock: Clock;
  readonly #idFactory: () => string;
  readonly #nonceFactory: () => string;
  readonly #signer: (payload: string) => string;
  readonly #timeoutMs: number;

  constructor(options: { readonly opportunities: OpportunitySource; readonly providers: ProviderPreflightSource;
    readonly clock?: Clock; readonly idFactory?: () => string; readonly nonceFactory?: () => string;
    readonly signer?: (payload: string) => string; readonly timeoutMs?: number }) {
    this.#opportunities = options.opportunities;
    this.#providers = options.providers;
    this.#clock = options.clock ?? { nowMs: Date.now };
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#nonceFactory = options.nonceFactory ?? (() => randomBytes(24).toString("hex"));
    const key = randomBytes(32);
    this.#signer = options.signer ?? ((payload) => createHmac("sha256", key).update(payload).digest("hex"));
    this.#timeoutMs = options.timeoutMs ?? 3_000;
  }

  verifyTicket(input: PreflightTicket): boolean {
    const parsed = PreflightTicketSchema.safeParse(input);
    if (!parsed.success) return false;
    const { signature, ...unsigned } = parsed.data;
    const expected = Buffer.from(this.#signer(JSON.stringify(unsigned)), "utf8");
    const actual = Buffer.from(signature, "utf8");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async preflight(input: PreflightRequest): Promise<PreflightTicket> {
    const request = PreflightRequestSchema.parse(input);
    const opportunity = this.#opportunities.getSnapshot().opportunities
      .find((candidate) => candidate.opportunityId === request.opportunityId);
    if (opportunity === undefined || opportunity.executionConfidence !== "HIGH") {
      throw new Error("PREFLIGHT_OPPORTUNITY_UNAVAILABLE");
    }
    if (opportunity.legs.length !== 2 || new Set(opportunity.legs.map((leg) => leg.provider)).size !== 2 ||
      opportunity.legs.some((leg) => !leg.eligible || leg.quoteStatus !== "OPEN")) {
      throw new Error("PREFLIGHT_NOT_TWO_OPEN_LEGS");
    }

    const accountIds = [request.accountAId, request.accountBId] as const;
    const accountProviders = await Promise.all(accountIds.map(async (id) => this.#providers.providerForAccount(id)));
    if (new Set(accountProviders).size !== 2) throw new Error("PREFLIGHT_PROVIDER_COVERAGE_MISMATCH");
    const accountByProvider = new Map(accountProviders.map((provider, index) => [provider, accountIds[index]!]));
    const providerLegs = opportunity.legs.map((leg) => {
      const accountId = accountByProvider.get(leg.provider as ProviderId);
      if (accountId === undefined) throw new Error("PREFLIGHT_PROVIDER_COVERAGE_MISMATCH");
      return { leg, accountId };
    });

    const calls = providerLegs.map(({ leg, accountId }) => this.#providers.preflight({
      accountId, providerEventId: leg.providerEventId, providerMarketId: leg.providerMarketId,
      providerSelectionId: leg.providerSelectionId, selection: leg.selection, line: opportunity.line,
      expectedDecimalOdds: leg.decimalOdds, requestedStake: leg.stake
    }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("PREFLIGHT_TIMEOUT")), this.#timeoutMs);
      timer.unref?.();
    });
    let results: readonly ProviderTicketPreflight[];
    try {
      results = await Promise.race([Promise.all(calls), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const issuedAtMs = this.#clock.nowMs();
    const current = this.#opportunities.getSnapshot().opportunities
      .find((candidate) => candidate.opportunityId === opportunity.opportunityId);
    if (current === undefined || current.executionConfidence !== "HIGH" ||
      current.canonicalEventId !== opportunity.canonicalEventId ||
      current.canonicalMarketId !== opportunity.canonicalMarketId || current.line !== opportunity.line ||
      current.legs.length !== 2 || current.legs.some((leg, index) =>
        leg.provider !== opportunity.legs[index]!.provider ||
        leg.providerEventId !== opportunity.legs[index]!.providerEventId ||
        leg.providerMarketId !== opportunity.legs[index]!.providerMarketId ||
        leg.providerSelectionId !== opportunity.legs[index]!.providerSelectionId)) {
      throw new Error("PREFLIGHT_OPPORTUNITY_CHANGED");
    }
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]!;
      const leg = providerLegs[index]!.leg;
      const constraint = result.constraint;
      if (constraint === null || result.quoteStatus !== "OPEN") throw new Error("PREFLIGHT_LEG_UNAVAILABLE");
      if (constraint.expiresAtMs <= issuedAtMs) throw new Error("PREFLIGHT_EXPIRED");
      if (driftBps(leg.decimalOdds, result.decimalOdds).gt(request.maxOddsDriftBps)) {
        throw new Error("PREFLIGHT_ODDS_DRIFT");
      }
      const remainingReasons = result.reasons.filter((reason) => reason !== "ODDS_CHANGED");
      if (remainingReasons.length > 0 || (!result.eligible && !result.reasons.includes("ODDS_CHANGED"))) {
        throw new Error("PREFLIGHT_LEG_UNAVAILABLE");
      }
      if (constraint.currency !== leg.stakeCurrency || constraint.feeType !== leg.feeType ||
        constraint.feeRate !== leg.feeRate) throw new Error("PREFLIGHT_FINANCIAL_POLICY_MISMATCH");
      if (!stakeFitsConstraint(leg.stake, constraint)) throw new Error("PREFLIGHT_LEG_UNAVAILABLE");
    }

    const totalStakeBase = opportunity.legs.reduce((sum, leg) => sum.plus(leg.stakeBase), new Decimal(0));
    const payouts = opportunity.legs.map((leg, index) => {
      const result = results[index]!;
      const baseRate = new Decimal(leg.stakeBase).div(leg.stake);
      return new Decimal(leg.stake).mul(effectiveDecimal(new Decimal(result.decimalOdds), feeFor(leg))).mul(baseRate);
    });
    const worstCaseProfit = Decimal.min(...payouts).minus(totalStakeBase);
    if (!worstCaseProfit.gt(0) || worstCaseProfit.lt(opportunity.worstCaseProfit)) {
      throw new Error("PREFLIGHT_PROFIT_BELOW_SIGNAL");
    }
    const expiresAtMs = Math.min(...results.map((result) => result.constraint!.expiresAtMs), issuedAtMs + 3_000);
    if (expiresAtMs <= issuedAtMs) throw new Error("PREFLIGHT_EXPIRED");

    const legs = providerLegs.map(({ leg, accountId }, index) => ({
      accountId, provider: results[index]!.provider, providerEventId: leg.providerEventId,
      providerMarketId: leg.providerMarketId, providerSelectionId: leg.providerSelectionId,
      selection: leg.selection, line: opportunity.line, decimalOdds: results[index]!.decimalOdds, stake: leg.stake,
      currency: results[index]!.constraint!.currency, balance: results[index]!.constraint!.balance,
      balanceAsOfMs: results[index]!.constraint!.verifiedAsOfMs,
      quoteAsOfMs: results[index]!.constraint!.verifiedAsOfMs
    })) as unknown as PreflightTicket["legs"];
    const unsigned = { ticketId: this.#idFactory(), opportunityId: opportunity.opportunityId,
      canonicalEventId: opportunity.canonicalEventId, canonicalMarketId: opportunity.canonicalMarketId,
      baseCurrency: opportunity.baseCurrency, totalStakeBase: plain(totalStakeBase),
      worstCaseProfit: plain(worstCaseProfit), issuedAtMs, expiresAtMs, nonce: this.#nonceFactory(), legs };
    return PreflightTicketSchema.parse({ ...unsigned, signature: this.#signer(JSON.stringify(unsigned)) });
  }
}
