import type { CanonicalMarket, ProviderQuote } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import type { MarketMappingResult } from "../mapping/market-mapper.js";
import { OpportunityEngine, type OpportunityEvaluationContext } from "./engine.js";
import {
  QuoteBook,
  quoteKey,
  quoteMarketKey,
  type QuoteClockContext,
  type QuoteSnapshot
} from "../quotes/quote-book.js";

const WALL_CLOCK_EPOCH_MS = 1_800_000_000_000;
const clock = (monotonicNowMs = 1_000): QuoteClockContext => ({
  monotonicNowMs,
  wallClockNowMs: WALL_CLOCK_EPOCH_MS + monotonicNowMs - 1_000
});

const policy = {
  SABA: {
    websocketTtlMs: 1_000,
    pollingTtlMs: 5_000,
    maxFutureClockSkewMs: 100,
    missingSourceTimestamp: "USE_RECEIVED_TIME" as const
  },
  IM: {
    websocketTtlMs: 1_000,
    pollingTtlMs: 5_000,
    maxFutureClockSkewMs: 100,
    missingSourceTimestamp: "USE_RECEIVED_TIME" as const
  }
};

const quote = (overrides: Partial<ProviderQuote> = {}): ProviderQuote => ({
  provider: "SABA",
  category: "FOOTBALL",
  providerEventId: "saba-event",
  providerMarketId: "saba-market",
  providerSelectionId: "saba-over",
  marketType: "FT_TOTAL",
  scope: "FULL_TIME",
  selection: "OVER",
  line: "2.5",
  rawOdds: "2.2",
  rawFormat: "DECIMAL",
  status: "OPEN",
  isLive: true,
  sourceTimestampMs: WALL_CLOCK_EPOCH_MS,
  receivedMonotonicMs: 1_000,
  sequence: 1,
  ...overrides
});

const leftQuote = quote();
const rightQuote = quote({
  provider: "IM",
  providerEventId: "im-event",
  providerMarketId: "im-market",
  providerSelectionId: "im-under",
  selection: "UNDER"
});

const evidence = [{
  gate: "sameSettlementProfile",
  passed: true,
  expected: "profile-v1",
  actual: "profile-v1",
  reason: "hard gate passed"
}];

const canonicalMarket = (overrides: Partial<CanonicalMarket> = {}): CanonicalMarket => ({
  canonicalMarketId: "market|event-1|FULL_TIME|FT_TOTAL|2.5|profile-v1",
  canonicalEventId: "event-1",
  category: "FOOTBALL",
  marketType: "FT_TOTAL",
  scope: "FULL_TIME",
  line: "2.5",
  settlementProfile: "profile-v1",
  providerMarketIds: ["saba-market", "im-market"],
  mappingStatus: "VERIFIED",
  mappingEvidence: evidence,
  ...overrides
});

const mapping = (overrides: Partial<MarketMappingResult> = {}): MarketMappingResult => ({
  status: "VERIFIED",
  canonicalMarketId: canonicalMarket().canonicalMarketId,
  normalizedLine: "2.5",
  selectionMappings: [
    {
      canonicalOutcomeId: "OVER",
      leftProviderSelectionId: "saba-over",
      rightProviderSelectionId: "im-over"
    },
    {
      canonicalOutcomeId: "UNDER",
      leftProviderSelectionId: "saba-under",
      rightProviderSelectionId: "im-under"
    }
  ],
  sourceMarkets: {
    left: {
      provider: "SABA",
      providerEventId: "saba-event",
      providerMarketId: "saba-market"
    },
    right: {
      provider: "IM",
      providerEventId: "im-event",
      providerMarketId: "im-market"
    }
  },
  executionConfidence: "HIGH",
  evidence,
  ...overrides
});

const constraint = {
  minStake: "10",
  maxStake: "100",
  stakeStep: "1",
  balance: "100"
};

const fx = {
  sourceCurrency: "USD",
  baseCurrency: "USD",
  rate: "1",
  spreadRate: "0",
  asOfMs: WALL_CLOCK_EPOCH_MS,
  maxAgeMs: 60_000
} as const;

function snapshot(
  nowMs = 1_000,
  quotes: readonly ProviderQuote[] = [leftQuote, rightQuote]
): QuoteSnapshot {
  const book = new QuoteBook(policy);
  const byMarket = new Map<string, ProviderQuote[]>();
  for (const item of quotes) {
    const key = quoteMarketKey(item);
    byMarket.set(key, [...(byMarket.get(key) ?? []), item]);
  }
  for (const marketQuotes of byMarket.values()) {
    book.apply({
      source: {
        provider: marketQuotes[0]!.provider,
        category: marketQuotes[0]!.category
      },
      kind: "FULL_SNAPSHOT",
      transport: "WEBSOCKET",
      sequence: marketQuotes[0]!.sequence,
      clock: clock(),
      quotes: marketQuotes
    });
  }
  return book.snapshot(clock(nowMs));
}

function context(
  overrides: Partial<OpportunityEvaluationContext> = {}
): OpportunityEvaluationContext {
  return {
    minimumNetMargin: "0.05",
    minimumWorstCaseProfit: "0",
    minimumRoi: "0",
    minimumRemainingTtlMs: 0,
    baseCurrency: "USD",
    evaluatedAtMs: WALL_CLOCK_EPOCH_MS,
    bankroll: "200",
    candidates: [{
      market: canonicalMarket(),
      mapping: mapping(),
      eventIsLive: true,
      legs: [
        {
          canonicalOutcomeId: "OVER",
          quoteKey: quoteKey(leftQuote),
          fee: { type: "NONE" },
          constraint,
          fx
        },
        {
          canonicalOutcomeId: "UNDER",
          quoteKey: quoteKey(rightQuote),
          fee: { type: "NONE" },
          constraint,
          fx
        }
      ]
    }],
    ...overrides
  };
}

describe("OpportunityEngine fail-closed policy", () => {
  it("emits one HIGH-confidence opportunity for a verified market with fresh open quotes", () => {
    const engine = new OpportunityEngine();

    const opportunities = engine.evaluate(snapshot(), context());

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      canonicalMarketId: canonicalMarket().canonicalMarketId,
      netMargin: "0.1",
      worstCaseProfit: "20",
      executionConfidence: "HIGH",
      quoteAgeMs: 0
    });
    expect(opportunities[0]?.legs.map((leg) => [leg.provider, leg.stake])).toEqual([
      ["SABA", "100"],
      ["IM", "100"]
    ]);
    expect(engine.blockedDiagnostics).toEqual([]);
  });

  it("blocks a mapping that requires review and exposes the reason only in diagnostics", () => {
    const engine = new OpportunityEngine();
    const review = context({
      candidates: [{
        ...context().candidates[0]!,
        mapping: mapping({ status: "REVIEW_REQUIRED", canonicalMarketId: null, executionConfidence: "BLOCKED" })
      }]
    });

    expect(engine.evaluate(snapshot(), review)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("MAPPING_REVIEW_REQUIRED");
  });

  it("blocks a stale quote", () => {
    const engine = new OpportunityEngine();

    expect(engine.evaluate(snapshot(2_000), context())).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("QUOTE_STALE");
  });

  it("rejects a reused mapped selection ID from another provider event and market", () => {
    const engine = new OpportunityEngine();
    const rogue = {
      ...leftQuote,
      providerEventId: "other-event",
      providerMarketId: "other-market"
    };
    const base = context();
    const candidate = base.candidates[0]!;
    const crossWired: OpportunityEvaluationContext = {
      ...base,
      candidates: [{
        ...candidate,
        legs: [
          { ...candidate.legs[0]!, quoteKey: quoteKey(rogue) },
          candidate.legs[1]!
        ]
      }]
    };

    expect(engine.evaluate(snapshot(1_000, [rogue, rightQuote]), crossWired)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("QUOTE_NOT_MAPPED");
  });

  it("rejects a candidate whose outcome legs all come from one mapped side", () => {
    const engine = new OpportunityEngine();
    const leftUnder = {
      ...leftQuote,
      providerSelectionId: "saba-under",
      selection: "UNDER"
    };
    const base = context();
    const candidate = base.candidates[0]!;
    const sameSource: OpportunityEvaluationContext = {
      ...base,
      candidates: [{
        ...candidate,
        legs: [
          candidate.legs[0]!,
          { ...candidate.legs[1]!, quoteKey: quoteKey(leftUnder) }
        ]
      }]
    };

    expect(engine.evaluate(snapshot(1_000, [leftQuote, leftUnder]), sameSource)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("NOT_CROSS_BOOK");
  });

  it("blocks a suspended market quote immediately", () => {
    const engine = new OpportunityEngine();
    const suspended = snapshot(1_000, [
      { ...leftQuote, status: "SUSPENDED" },
      rightQuote
    ]);

    expect(engine.evaluate(suspended, context())).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("QUOTE_SUSPENDED");
  });

  it("blocks quotes whose live state contradicts the authoritative mapped event", () => {
    const engine = new OpportunityEngine();
    const base = context();
    const mismatched = {
      ...base,
      candidates: [{ ...base.candidates[0]!, eventIsLive: false }]
    } as OpportunityEvaluationContext;

    expect(engine.evaluate(snapshot(), mismatched)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("QUOTE_LIVE_STATE_MISMATCH");
  });

  it("blocks an effective margin below policy", () => {
    const engine = new OpportunityEngine();

    expect(engine.evaluate(snapshot(), context({ minimumNetMargin: "0.11" }))).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("MARGIN_BELOW_THRESHOLD");
  });

  it("blocks fee-adjusted odds at or below one instead of throwing", () => {
    const engine = new OpportunityEngine();
    const base = context();
    const candidate = base.candidates[0]!;
    const invalidEffectiveOdds: OpportunityEvaluationContext = {
      ...base,
      candidates: [{
        ...candidate,
        legs: [
          { ...candidate.legs[0]!, fee: { type: "PAYOUT", rate: "0.6" } },
          candidate.legs[1]!
        ]
      }]
    };

    expect(engine.evaluate(snapshot(), invalidEffectiveOdds)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("INVALID_ODDS_OR_FEE");
  });

  it("fails closed when a provider financial policy is missing", () => {
    const engine = new OpportunityEngine();
    const base = context();
    const candidate = base.candidates[0]!;
    const missing = {
      ...base,
      candidates: [{
        ...candidate,
        legs: [{ ...candidate.legs[0]!, fx: null }, candidate.legs[1]!]
      }]
    };

    expect(engine.evaluate(snapshot(), missing)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("FINANCIAL_POLICY_MISSING");
  });

  it("fails closed when an FX quote is stale", () => {
    const engine = new OpportunityEngine();

    expect(engine.evaluate(snapshot(), context({
      evaluatedAtMs: WALL_CLOCK_EPOCH_MS + 60_001
    }))).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("FX_STALE");
  });

  it("fails closed with an FX-specific diagnostic for an invalid rate", () => {
    const engine = new OpportunityEngine();
    const base = context();
    const candidate = base.candidates[0]!;
    const invalid = {
      ...base,
      candidates: [{
        ...candidate,
        legs: [{ ...candidate.legs[0]!, fx: { ...fx, rate: "0" } }, candidate.legs[1]!]
      }]
    };

    expect(engine.evaluate(snapshot(), invalid)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("INVALID_FX");
  });

  it("exposes exact mixed-currency fee and FX assumptions in base-currency cash flows", () => {
    const engine = new OpportunityEngine();
    const base = context({
      bankroll: "200",
      minimumNetMargin: "0"
    });
    const candidate = base.candidates[0]!;
    const result = engine.evaluate(snapshot(), {
      ...base,
      candidates: [{
        ...candidate,
        legs: [
          {
            ...candidate.legs[0]!,
            constraint: { minStake: "50", maxStake: "50", stakeStep: "1", balance: "50" },
            fx: { ...fx, sourceCurrency: "EUR", rate: "2" }
          },
          {
            ...candidate.legs[1]!,
            constraint: { minStake: "100", maxStake: "100", stakeStep: "1", balance: "100" }
          }
        ]
      }]
    });

    expect(result[0]).toMatchObject({
      baseCurrency: "USD",
      totalStakeBase: "200",
      netMargin: "0.1",
      legs: [
        { stake: "50", stakeCurrency: "EUR", stakeBase: "100", payout: "220", fxRate: "2" },
        { stake: "100", stakeCurrency: "USD", stakeBase: "100", payout: "220", fxRate: "1" }
      ]
    });
  });

  it("applies the margin threshold to realized post-rounding ROI", () => {
    const engine = new OpportunityEngine();
    const highOdds = [
      { ...leftQuote, rawOdds: "2.4" },
      { ...rightQuote, rawOdds: "2.4" }
    ];
    const base = context({ minimumNetMargin: "0.15", bankroll: "21" });
    const candidate = base.candidates[0]!;
    const rounded = {
      ...base,
      candidates: [{
        ...candidate,
        legs: [
          {
            ...candidate.legs[0]!,
            quoteKey: quoteKey(highOdds[0]!),
            constraint: { minStake: "10", maxStake: "10", stakeStep: "10", balance: "10" }
          },
          {
            ...candidate.legs[1]!,
            quoteKey: quoteKey(highOdds[1]!),
            constraint: { minStake: "11", maxStake: "11", stakeStep: "11", balance: "11" }
          }
        ]
      }]
    };

    expect(engine.evaluate(snapshot(1_000, highOdds), rounded)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("MARGIN_BELOW_THRESHOLD");
  });

  it("blocks unavailable balance without passing invalid inputs to the optimizer", () => {
    const engine = new OpportunityEngine();
    const base = context();
    const candidate = base.candidates[0]!;
    const unavailable: OpportunityEvaluationContext = {
      ...base,
      candidates: [{
        ...candidate,
        legs: [
          { ...candidate.legs[0]!, constraint: { ...constraint, balance: "0" } },
          candidate.legs[1]!
        ]
      }]
    };

    expect(engine.evaluate(snapshot(), unavailable)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("UNAVAILABLE_BALANCE");
  });

  it("blocks a maximum stake below the minimum stake", () => {
    const engine = new OpportunityEngine();
    const base = context();
    const candidate = base.candidates[0]!;
    const lowMaximum: OpportunityEvaluationContext = {
      ...base,
      candidates: [{
        ...candidate,
        legs: [
          { ...candidate.legs[0]!, constraint: { ...constraint, maxStake: "5" } },
          candidate.legs[1]!
        ]
      }]
    };

    expect(engine.evaluate(snapshot(), lowMaximum)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("MAX_STAKE_TOO_LOW");
  });

  it("never emits OBSERVE_ONLY coverage as an executable opportunity", () => {
    const engine = new OpportunityEngine();
    const base = context();
    const observeOnly: OpportunityEvaluationContext = {
      ...base,
      candidates: [{
        ...base.candidates[0]!,
        market: canonicalMarket({ marketType: "OBSERVE_ONLY" })
      }]
    };

    expect(engine.evaluate(snapshot(), observeOnly)).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("OBSERVE_ONLY");
  });

  it("blocks candidates whose shortest quote lifetime is below the configured TTL reserve", () => {
    const engine = new OpportunityEngine();

    expect(engine.evaluate(snapshot(1_900), context({ minimumRemainingTtlMs: 101 }))).toEqual([]);
    expect(engine.blockedDiagnostics[0]?.code).toBe("OPPORTUNITY_TTL");
  });

  it("ranks deterministically by margin, profit, age, then canonical market ID", () => {
    const engine = new OpportunityEngine();
    const freshHighMargin = [
      { ...leftQuote, providerMarketId: "m-z", rawOdds: "2.4" },
      { ...rightQuote, providerMarketId: "m-z-im", rawOdds: "2.4" }
    ];
    const older = [
      {
        ...leftQuote,
        providerMarketId: "m-c",
        receivedMonotonicMs: 900,
        sourceTimestampMs: WALL_CLOCK_EPOCH_MS - 100
      },
      {
        ...rightQuote,
        providerMarketId: "m-c-im",
        receivedMonotonicMs: 900,
        sourceTimestampMs: WALL_CLOCK_EPOCH_MS - 100
      }
    ];
    const allQuotes = [...freshHighMargin, ...older, leftQuote, rightQuote];
    const baseCandidate = context().candidates[0]!;
    const candidateFor = (
      marketId: string,
      pair: readonly ProviderQuote[],
      legConstraint = constraint
    ) => ({
      ...baseCandidate,
      market: canonicalMarket({
        canonicalMarketId: marketId,
        providerMarketIds: pair.map((item) => item.providerMarketId)
      }),
      mapping: mapping({
        canonicalMarketId: marketId,
        sourceMarkets: {
          left: {
            provider: pair[0]!.provider,
            providerEventId: pair[0]!.providerEventId,
            providerMarketId: pair[0]!.providerMarketId
          },
          right: {
            provider: pair[1]!.provider,
            providerEventId: pair[1]!.providerEventId,
            providerMarketId: pair[1]!.providerMarketId
          }
        }
      }),
      legs: pair.map((item, index) => ({
        canonicalOutcomeId: index === 0 ? "OVER" : "UNDER",
        quoteKey: quoteKey(item),
        fee: { type: "NONE" } as const,
        constraint: legConstraint,
        fx
      }))
    });
    const evaluation = context({
      candidates: [
        candidateFor("market-c", older),
        candidateFor("market-b", [leftQuote, rightQuote]),
        candidateFor("market-z", freshHighMargin),
        candidateFor("market-a", [leftQuote, rightQuote])
      ]
    });

    const result = engine.evaluate(snapshot(1_000, allQuotes), evaluation);

    expect(result.map((item) => item.canonicalMarketId)).toEqual([
      "market-z",
      "market-a",
      "market-b",
      "market-c"
    ]);
  });
});
