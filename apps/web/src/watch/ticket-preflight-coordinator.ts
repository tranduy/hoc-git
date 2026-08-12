import type { AccountStatus, ProviderId, ProviderStakeConstraint, ProviderTicketPreflight,
  ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import type { ProviderPreflightApiLike } from "../api/provider-preflight.js";
import { decimalOdds, type ComparisonEvent, type ComparisonRow } from "../catalog/comparison.js";
import { buildFixedBaseStakePlanForPair, enumerateOpposingLegPairs, type FixedBaseStakePlan,
  type FixedBaseStakePolicy, type OpposingLegPair } from "./fixed-base-stake.js";

export interface VerifiedTicketEvidence {
  readonly key: string;
  readonly eventKey: string;
  readonly rowKey: string;
  readonly plan: FixedBaseStakePlan;
  readonly verifiedAtMs: number;
  readonly expiresAtMs: number;
}

export interface TicketPreflightRefreshInput {
  readonly events: readonly ComparisonEvent[];
  readonly selectedAccounts: readonly AccountStatus[];
  readonly selectedProviders: ReadonlySet<ProviderId>;
  readonly policy: FixedBaseStakePolicy;
}

interface VerifiedPair {
  readonly plan: FixedBaseStakePlan;
  readonly expiresAtMs: number;
}

function pairRequest(row: ComparisonRow, pair: OpposingLegPair, provider: ProviderId,
  accountId: string, stake: string): ProviderTicketPreflightRequest | null {
  const candidate = pair.first.provider === provider ? pair.first : pair.second.provider === provider ? pair.second : null;
  if (candidate === null) return null;
  const cell = row.cells.find((value) => value.provider === provider &&
    value.market.providerMarketId === candidate.quote.providerMarketId);
  const odds = decimalOdds(candidate.quote);
  if (cell === undefined || odds === null) return null;
  return { accountId, providerEventId: cell.market.providerEventId,
    providerMarketId: cell.market.providerMarketId, providerSelectionId: candidate.quote.providerSelectionId,
    selection: candidate.quote.selection, line: cell.market.line,
    expectedDecimalOdds: new Decimal(odds).toFixed(new Decimal(odds).decimalPlaces()), requestedStake: stake };
}

function matchesRequest(result: ProviderTicketPreflight, request: ProviderTicketPreflightRequest,
  provider: ProviderId, nowMs: number): result is ProviderTicketPreflight & { constraint: ProviderStakeConstraint } {
  const constraint = result.constraint;
  return result.eligible && result.reasons.length === 0 && result.quoteStatus === "OPEN" && constraint !== null &&
    result.provider === provider && result.accountId === request.accountId &&
    result.providerEventId === request.providerEventId && result.providerMarketId === request.providerMarketId &&
    result.providerSelectionId === request.providerSelectionId && result.selection === request.selection &&
    result.line === request.line && result.decimalOdds === request.expectedDecimalOdds &&
    constraint.verifiedAsOfMs <= nowMs && constraint.expiresAtMs > nowMs;
}

function sameStakes(left: FixedBaseStakePlan, right: FixedBaseStakePlan): boolean {
  return left.legs.length === right.legs.length && left.legs.every((leg) =>
    right.legs.some((candidate) => candidate.provider === leg.provider && candidate.selection === leg.selection &&
      candidate.stake === leg.stake));
}

export class TicketPreflightCoordinator {
  readonly #inflight = new Map<string, Promise<ProviderTicketPreflight>>();
  #generation = 0;
  #verified = new Map<string, VerifiedTicketEvidence>();

  constructor(private readonly api: ProviderPreflightApiLike, private readonly now: () => number = Date.now) {}

  clear(): void {
    this.#generation += 1;
    this.#verified.clear();
  }

  async refresh(input: TicketPreflightRefreshInput): Promise<ReadonlyMap<string, VerifiedTicketEvidence>> {
    const generation = ++this.#generation;
    const nowMs = this.now();
    const accountByProvider = new Map<ProviderId, AccountStatus>();
    for (const account of input.selectedAccounts) {
      if (input.selectedProviders.has(account.provider) && account.sessionState === "ACTIVE" &&
        account.capabilities.includes("PREFLIGHT")) accountByProvider.set(account.provider, account);
    }

    const candidates = await Promise.all(input.events.flatMap((event) => event.rows.map(async (row) => {
      const verifiedPairs = await Promise.all(enumerateOpposingLegPairs(row, input.selectedProviders)
        .map(async (pair) => this.#verifyPair(row, pair, accountByProvider, input.policy, nowMs)));
      const plan = verifiedPairs.flatMap((value) => value === null ? [] : [value]).sort((left, right) =>
        new Decimal(right.plan.worstCaseProfit).comparedTo(left.plan.worstCaseProfit) ||
        new Decimal(right.plan.roi).comparedTo(left.plan.roi) ||
        left.plan.fingerprint.localeCompare(right.plan.fingerprint))[0];
      if (plan === undefined) return null;
      const key = `${event.key}::${row.key}`;
      return { key, eventKey: event.key, rowKey: row.key, plan: plan.plan,
        verifiedAtMs: nowMs, expiresAtMs: plan.expiresAtMs } satisfies VerifiedTicketEvidence;
    })));

    if (generation !== this.#generation) return new Map(this.#verified);
    this.#verified = new Map(candidates.flatMap((value) => value === null ? [] : [[value.key, value] as const]));
    return new Map(this.#verified);
  }

  async #verifyPair(row: ComparisonRow, pair: OpposingLegPair, accountByProvider: ReadonlyMap<ProviderId, AccountStatus>,
    policy: FixedBaseStakePolicy, nowMs: number): Promise<VerifiedPair | null> {
    const providers = [pair.first.provider, pair.second.provider] as const;
    const accounts = providers.map((provider) => accountByProvider.get(provider));
    if (accounts.some((account) => account === undefined) || accounts[0]!.id === accounts[1]!.id) return null;

    const optimisticPolicy: FixedBaseStakePolicy = { currency: policy.currency, baseStake: policy.baseStake,
      minStake: policy.minStake, maxStake: policy.maxStake, stakeStep: policy.stakeStep, balance: policy.balance,
      requireProviderConstraints: false };
    const optimistic = buildFixedBaseStakePlanForPair(row, pair, optimisticPolicy);
    if (optimistic === null || new Decimal(optimistic.worstCaseProfit).lt(20_000)) return null;
    const first = await this.#preflightPlan(row, pair, optimistic, providers, accounts as [AccountStatus, AccountStatus], nowMs);
    if (first === null) return null;
    const verifiedPolicy: FixedBaseStakePolicy = { ...policy, requireProviderConstraints: true,
      providerConstraints: { [providers[0]]: first.results[0].constraint,
        [providers[1]]: first.results[1].constraint } };
    const recalculated = buildFixedBaseStakePlanForPair(row, pair, verifiedPolicy, nowMs);
    if (recalculated === null || new Decimal(recalculated.worstCaseProfit).lt(20_000)) return null;
    if (sameStakes(optimistic, recalculated)) {
      return { plan: recalculated, expiresAtMs: Math.min(first.results[0].constraint.expiresAtMs,
        first.results[1].constraint.expiresAtMs) };
    }

    const final = await this.#preflightPlan(row, pair, recalculated, providers,
      accounts as [AccountStatus, AccountStatus], nowMs);
    if (final === null) return null;
    const finalPolicy: FixedBaseStakePolicy = { ...policy, requireProviderConstraints: true,
      providerConstraints: { [providers[0]]: final.results[0].constraint,
        [providers[1]]: final.results[1].constraint } };
    const finalPlan = buildFixedBaseStakePlanForPair(row, pair, finalPolicy, nowMs);
    if (finalPlan === null || !sameStakes(recalculated, finalPlan) ||
      new Decimal(finalPlan.worstCaseProfit).lt(20_000)) return null;
    return { plan: finalPlan, expiresAtMs: Math.min(final.results[0].constraint.expiresAtMs,
      final.results[1].constraint.expiresAtMs) };
  }

  async #preflightPlan(row: ComparisonRow, pair: OpposingLegPair, plan: FixedBaseStakePlan,
    providers: readonly [ProviderId, ProviderId], accounts: readonly [AccountStatus, AccountStatus], nowMs: number):
    Promise<{ readonly results: readonly [ProviderTicketPreflight & { constraint: ProviderStakeConstraint },
      ProviderTicketPreflight & { constraint: ProviderStakeConstraint }] } | null> {
    const requests = providers.map((provider, index) => {
      const leg = plan.legs.find((value) => value.provider === provider);
      return leg === undefined ? null : pairRequest(row, pair, provider, accounts[index]!.id, leg.stake);
    });
    const request0 = requests[0];
    const request1 = requests[1];
    if (request0 === null || request0 === undefined || request1 === null || request1 === undefined) return null;
    try {
      const [result0, result1] = await Promise.all([this.#request(request0), this.#request(request1)]);
      if (!matchesRequest(result0, request0, providers[0], nowMs) ||
        !matchesRequest(result1, request1, providers[1], nowMs) ||
        result0.constraint.currency !== result1.constraint.currency) return null;
      return { results: [result0, result1] };
    } catch {
      return null;
    }
  }

  #request(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    const key = JSON.stringify(request);
    const current = this.#inflight.get(key);
    if (current !== undefined) return current;
    const operation = this.api.preflight(request);
    this.#inflight.set(key, operation);
    const cleanup = (): void => { if (this.#inflight.get(key) === operation) this.#inflight.delete(key); };
    void operation.then(cleanup, cleanup);
    return operation;
  }
}
