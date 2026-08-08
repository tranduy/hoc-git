import type {
  BlockedDiagnostic,
  CanonicalMarket,
  Opportunity,
  ProviderQuote,
  StakeLeg
} from "@tool-chenh/contracts";
import { calculateArbitrage } from "../arbitrage/calculate.js";
import {
  optimizeStakes,
  type StakeConstraint
} from "../arbitrage/optimize-stakes.js";
import type { MarketMappingResult } from "../mapping/market-mapper.js";
import { Decimal, toDecimal } from "../odds/convert.js";
import { effectiveDecimal, type FeeModel } from "../odds/effective.js";
import type { QuoteSnapshot, QuoteSnapshotEntry } from "../quotes/quote-book.js";

export interface OpportunityLegCandidate {
  readonly canonicalOutcomeId: string;
  readonly quoteKey: string;
  readonly fee: FeeModel;
  readonly constraint: StakeConstraint;
}

export interface OpportunityCandidate {
  readonly market: CanonicalMarket;
  readonly mapping: MarketMappingResult;
  readonly legs: readonly OpportunityLegCandidate[];
}

export interface OpportunityEvaluationContext {
  readonly candidates: readonly OpportunityCandidate[];
  readonly bankroll: string;
  readonly minimumNetMargin: string;
  readonly minimumWorstCaseProfit: string;
  readonly minimumRoi: string;
  readonly minimumRemainingTtlMs: number;
}

interface EvaluatedLeg {
  readonly candidate: OpportunityLegCandidate;
  readonly snapshot: QuoteSnapshotEntry;
  readonly decimalOdds: Decimal;
  readonly effectiveOdds: Decimal;
}

const PLAIN_DECIMAL = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainDecimal(value: Decimal): string {
  if (value.isZero()) return "0";
  return value.toFixed(value.decimalPlaces());
}

function parseNonNegative(value: string): Decimal | null {
  if (!PLAIN_DECIMAL.test(value)) return null;
  const decimal = new Decimal(value);
  return decimal.isFinite() && decimal.gte(0) ? decimal : null;
}

function sameLine(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  if (!PLAIN_DECIMAL.test(left) || !PLAIN_DECIMAL.test(right)) return false;
  return new Decimal(left).eq(right);
}

function diagnostic(
  candidate: OpportunityCandidate,
  code: string,
  reason: string
): BlockedDiagnostic {
  return {
    code,
    category: candidate.market.category,
    canonicalMarketId: candidate.mapping.canonicalMarketId,
    reason,
    mappingEvidence: candidate.mapping.evidence
  };
}

type MappingSide = "LEFT" | "RIGHT";

function matchesMappedSource(
  quote: ProviderQuote,
  source: MarketMappingResult["sourceMarkets"]["left"],
  providerSelectionId: string
): boolean {
  return quote.provider === source.provider &&
    quote.providerEventId === source.providerEventId &&
    quote.providerMarketId === source.providerMarketId &&
    quote.providerSelectionId === providerSelectionId;
}

function mappedQuoteSide(
  mapping: MarketMappingResult,
  canonicalOutcomeId: string,
  quote: ProviderQuote
): MappingSide | null {
  const found = mapping.selectionMappings.find(
    (selection) => selection.canonicalOutcomeId === canonicalOutcomeId
  );
  if (found === undefined) return null;
  if (
    matchesMappedSource(
      quote,
      mapping.sourceMarkets.left,
      found.leftProviderSelectionId
    )
  ) {
    return "LEFT";
  }
  if (
    matchesMappedSource(
      quote,
      mapping.sourceMarkets.right,
      found.rightProviderSelectionId
    )
  ) {
    return "RIGHT";
  }
  return null;
}

function quoteReasonCode(entry: QuoteSnapshotEntry): string {
  const reason = entry.ineligibilityReasons[0];
  return reason === undefined ? "QUOTE_INELIGIBLE" : `QUOTE_${reason}`;
}

export class OpportunityEngine {
  #blockedDiagnostics: readonly BlockedDiagnostic[] = [];

  get blockedDiagnostics(): readonly BlockedDiagnostic[] {
    return this.#blockedDiagnostics;
  }

  evaluate(
    snapshot: QuoteSnapshot,
    context: OpportunityEvaluationContext
  ): readonly Opportunity[] {
    const opportunities: Opportunity[] = [];
    const diagnostics: BlockedDiagnostic[] = [];

    for (const candidate of context.candidates) {
      const blocked = this.#evaluateCandidate(snapshot, context, candidate);
      if ("diagnostic" in blocked) diagnostics.push(blocked.diagnostic);
      else opportunities.push(blocked.opportunity);
    }

    this.#blockedDiagnostics = diagnostics;
    return opportunities.sort((left, right) => {
      const margin = new Decimal(right.netMargin).comparedTo(left.netMargin);
      if (margin !== 0) return margin;
      const profit = new Decimal(right.worstCaseProfit).comparedTo(left.worstCaseProfit);
      if (profit !== 0) return profit;
      if (left.quoteAgeMs !== right.quoteAgeMs) return left.quoteAgeMs - right.quoteAgeMs;
      return compareText(left.canonicalMarketId, right.canonicalMarketId) ||
        compareText(left.opportunityId, right.opportunityId);
    });
  }

  #evaluateCandidate(
    snapshot: QuoteSnapshot,
    context: OpportunityEvaluationContext,
    candidate: OpportunityCandidate
  ): { readonly opportunity: Opportunity } | { readonly diagnostic: BlockedDiagnostic } {
    const { market, mapping } = candidate;
    if (mapping.status !== "VERIFIED") {
      return {
        diagnostic: diagnostic(
          candidate,
          `MAPPING_${mapping.status}`,
          `market mapping status is ${mapping.status}`
        )
      };
    }
    if (market.mappingStatus !== "VERIFIED") {
      return {
        diagnostic: diagnostic(candidate, `MAPPING_${market.mappingStatus}`, "canonical market is not verified")
      };
    }
    if (
      mapping.executionConfidence !== "HIGH" ||
      mapping.canonicalMarketId === null ||
      mapping.canonicalMarketId !== market.canonicalMarketId
    ) {
      return {
        diagnostic: diagnostic(candidate, "MAPPING_BLOCKED", "mapping provenance is not executable")
      };
    }
    const { left, right } = mapping.sourceMarkets;
    if (
      left.provider.trim() === "" || right.provider.trim() === "" ||
      left.providerEventId.trim() === "" || right.providerEventId.trim() === "" ||
      left.providerMarketId.trim() === "" || right.providerMarketId.trim() === "" ||
      left.provider === right.provider ||
      !market.providerMarketIds.includes(left.providerMarketId) ||
      !market.providerMarketIds.includes(right.providerMarketId)
    ) {
      return {
        diagnostic: diagnostic(candidate, "MAPPING_SOURCE_PROVENANCE", "mapped source identity is incomplete or inconsistent")
      };
    }
    if (market.marketType === "OBSERVE_ONLY") {
      return {
        diagnostic: diagnostic(candidate, "OBSERVE_ONLY", "observe-only markets cannot be executed")
      };
    }
    if (
      !Number.isFinite(context.minimumRemainingTtlMs) ||
      context.minimumRemainingTtlMs < 0
    ) {
      return {
        diagnostic: diagnostic(candidate, "INVALID_POLICY", "minimum remaining TTL must be non-negative")
      };
    }

    const mappedOutcomes = new Set(mapping.selectionMappings.map((item) => item.canonicalOutcomeId));
    const candidateOutcomes = candidate.legs.map((leg) => leg.canonicalOutcomeId);
    if (
      mappedOutcomes.size < 2 ||
      candidate.legs.length !== mappedOutcomes.size ||
      new Set(candidateOutcomes).size !== candidateOutcomes.length ||
      new Set(candidate.legs.map((leg) => leg.quoteKey)).size !== candidate.legs.length ||
      candidateOutcomes.some((outcome) => !mappedOutcomes.has(outcome))
    ) {
      return {
        diagnostic: diagnostic(candidate, "INCOMPLETE_OUTCOME_SET", "candidate must cover every mapped outcome exactly once")
      };
    }

    const orderedCandidates = [...candidate.legs].sort((left, right) =>
      compareText(left.canonicalOutcomeId, right.canonicalOutcomeId)
    );
    const evaluatedLegs: EvaluatedLeg[] = [];
    const usedSides = new Set<MappingSide>();
    for (const leg of orderedCandidates) {
      const entry = snapshot.byKey[leg.quoteKey];
      if (entry === undefined) {
        return {
          diagnostic: diagnostic(candidate, "QUOTE_MISSING", `quote is missing for ${leg.canonicalOutcomeId}`)
        };
      }
      const mappedSide = mappedQuoteSide(mapping, leg.canonicalOutcomeId, entry.quote);
      if (mappedSide === null) {
        return {
          diagnostic: diagnostic(candidate, "QUOTE_NOT_MAPPED", "quote selection is not part of the verified mapping")
        };
      }
      usedSides.add(mappedSide);
      if (
        entry.quote.category !== market.category ||
        entry.quote.marketType !== market.marketType ||
        entry.quote.scope !== market.scope ||
        !sameLine(entry.quote.line, market.line)
      ) {
        return {
          diagnostic: diagnostic(candidate, "QUOTE_MARKET_MISMATCH", "quote metadata differs from the canonical market")
        };
      }
      if (!entry.eligible) {
        return {
          diagnostic: diagnostic(candidate, quoteReasonCode(entry), "quote is not eligible")
        };
      }
      if (
        entry.expiresAtMonotonicMs - snapshot.monotonicGeneratedAtMs <
        context.minimumRemainingTtlMs
      ) {
        return {
          diagnostic: diagnostic(candidate, "OPPORTUNITY_TTL", "quote lifetime is below the configured reserve")
        };
      }

      try {
        const decimalOdds = toDecimal(entry.quote.rawOdds, entry.quote.rawFormat);
        const effectiveOdds = effectiveDecimal(decimalOdds, leg.fee);
        if (!effectiveOdds.isFinite() || effectiveOdds.lte(1)) {
          throw new Error("effective odds must be finite and greater than one");
        }
        evaluatedLegs.push({
          candidate: leg,
          snapshot: entry,
          decimalOdds,
          effectiveOdds
        });
      } catch {
        return {
          diagnostic: diagnostic(candidate, "INVALID_ODDS_OR_FEE", "odds or fee model is invalid")
        };
      }
    }

    if (usedSides.size < 2) {
      return {
        diagnostic: diagnostic(candidate, "NOT_CROSS_BOOK", "candidate must use quotes from both mapped sources")
      };
    }

    const odds = evaluatedLegs.map((leg) => plainDecimal(leg.effectiveOdds));
    const arbitrage = calculateArbitrage(odds);
    const minimumNetMargin = parseNonNegative(context.minimumNetMargin);
    if (minimumNetMargin === null) {
      return {
        diagnostic: diagnostic(candidate, "INVALID_POLICY", "minimum net margin must be non-negative")
      };
    }
    if (!arbitrage.isArbitrage || arbitrage.theoreticalMargin.lt(minimumNetMargin)) {
      return {
        diagnostic: diagnostic(candidate, "MARGIN_BELOW_THRESHOLD", "effective net margin is below policy")
      };
    }

    for (const leg of evaluatedLegs) {
      const minStake = parseNonNegative(leg.candidate.constraint.minStake);
      const maxStake = parseNonNegative(leg.candidate.constraint.maxStake);
      const stakeStep = parseNonNegative(leg.candidate.constraint.stakeStep);
      const balance = parseNonNegative(leg.candidate.constraint.balance);
      if (
        minStake === null || maxStake === null || stakeStep === null || balance === null ||
        minStake.lte(0) || stakeStep.lte(0)
      ) {
        return {
          diagnostic: diagnostic(candidate, "INVALID_STAKE_CONSTRAINT", "stake constraint is invalid")
        };
      }
      if (maxStake.lt(minStake) || maxStake.div(stakeStep).floor().times(stakeStep).lt(minStake)) {
        return {
          diagnostic: diagnostic(candidate, "MAX_STAKE_TOO_LOW", "maximum stake cannot satisfy minimum stake")
        };
      }
      if (balance.lt(minStake) || balance.div(stakeStep).floor().times(stakeStep).lt(minStake)) {
        return {
          diagnostic: diagnostic(candidate, "UNAVAILABLE_BALANCE", "balance cannot satisfy minimum stake")
        };
      }
    }

    let plan;
    try {
      plan = optimizeStakes({
        odds,
        constraints: evaluatedLegs.map((leg) => leg.candidate.constraint),
        bankroll: context.bankroll,
        minimumWorstCaseProfit: context.minimumWorstCaseProfit,
        minimumRoi: context.minimumRoi
      });
    } catch {
      return {
        diagnostic: diagnostic(candidate, "INVALID_STAKE_CONSTRAINT", "stake policy or constraint is invalid")
      };
    }
    if (plan === null) {
      return {
        diagnostic: diagnostic(candidate, "STAKE_CONSTRAINTS", "no exact profitable stake plan exists")
      };
    }

    const legs: StakeLeg[] = evaluatedLegs.map((leg, index) => ({
      provider: leg.snapshot.quote.provider,
      providerEventId: leg.snapshot.quote.providerEventId,
      providerMarketId: leg.snapshot.quote.providerMarketId,
      providerSelectionId: leg.snapshot.quote.providerSelectionId,
      selection: leg.snapshot.quote.selection,
      rawOdds: leg.snapshot.quote.rawOdds,
      rawFormat: leg.snapshot.quote.rawFormat,
      decimalOdds: plainDecimal(leg.decimalOdds),
      effectiveDecimal: plainDecimal(leg.effectiveOdds),
      stake: plan.stakes[index]!,
      minStake: leg.candidate.constraint.minStake,
      maxStake: leg.candidate.constraint.maxStake,
      payout: plan.payouts[index]!,
      quoteAgeMs: leg.snapshot.quoteAgeMs,
      quoteStatus: leg.snapshot.quote.status,
      sourceTimestampMs: leg.snapshot.quote.sourceTimestampMs,
      receivedMonotonicMs: leg.snapshot.quote.receivedMonotonicMs,
      sequence: leg.snapshot.quote.sequence,
      eligible: true,
      ineligibleReasons: []
    }));
    const quoteAgeMs = Math.max(...evaluatedLegs.map((leg) => leg.snapshot.quoteAgeMs));
    const identity = evaluatedLegs
      .map((leg) => `${leg.snapshot.key}@${leg.snapshot.quote.sequence ?? "none"}`)
      .join("|");
    return {
      opportunity: {
        opportunityId: `opportunity|${encodeURIComponent(market.canonicalMarketId)}|${identity}`,
        canonicalEventId: market.canonicalEventId,
        canonicalMarketId: market.canonicalMarketId,
        category: market.category,
        marketType: market.marketType,
        scope: market.scope,
        line: market.line,
        settlementProfile: market.settlementProfile,
        legs,
        inverseSum: plainDecimal(arbitrage.inverseSum),
        netMargin: plainDecimal(arbitrage.theoreticalMargin),
        worstCaseProfit: plan.worstCaseProfit,
        roi: plan.roi,
        quoteAgeMs,
        mappingEvidence: mapping.evidence,
        executionConfidence: "HIGH"
      }
    };
  }
}
