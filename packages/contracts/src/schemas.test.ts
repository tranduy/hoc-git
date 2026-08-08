import { describe, expect, it } from "vitest";
import {
  AppSnapshotSchema,
  CanonicalMarketSchema,
  OpportunitySchema,
  ProviderConnectionStatusSchema,
  ProviderMarketSchema,
  ProviderQuoteSchema,
  RealtimeMessageSchema,
  StakeLegSchema
} from "./schemas.js";

const completeQuote = () => ({
  provider: "SABA",
  category: "LOL",
  providerEventId: "event-1",
  providerMarketId: "market-1",
  providerSelectionId: "selection-1",
  marketType: "MAP_WINNER",
  scope: "MAP_3",
  selection: "navi",
  line: null,
  rawOdds: "1.26",
  rawFormat: "HK",
  status: "OPEN",
  isLive: true,
  sourceTimestampMs: 1000,
  receivedMonotonicMs: 1100,
  sequence: 7
});

const completeMarket = () => ({
  provider: "SABA",
  category: "FOOTBALL",
  providerEventId: "event-1",
  providerMarketId: "market-1",
  marketType: "FT_1X2",
  scope: "FULL_TIME",
  line: null,
  settlementProfile: "regular-time",
  status: "OPEN"
});

const completeStakeLeg = () => ({
  provider: "SABA",
  providerEventId: "event-1",
  providerMarketId: "market-1",
  providerSelectionId: "selection-1",
  selection: "home",
  rawOdds: "1.26",
  rawFormat: "HK",
  decimalOdds: "2.26",
  effectiveDecimal: "2.20",
  stake: "100.00",
  minStake: "10.00",
  maxStake: "1000.00",
  payout: "220.00",
  quoteAgeMs: 10,
  quoteStatus: "OPEN",
  sourceTimestampMs: 1000,
  receivedMonotonicMs: 1100,
  sequence: 7,
  eligible: true,
  ineligibleReasons: []
});

const completeOpportunity = () => ({
  opportunityId: "opportunity-1",
  canonicalEventId: "canonical-event-1",
  canonicalMarketId: "canonical-market-1",
  category: "FOOTBALL",
  marketType: "FT_1X2",
  scope: "FULL_TIME",
  line: null,
  settlementProfile: "regular-time",
  legs: [completeStakeLeg()],
  inverseSum: "0.95",
  netMargin: "0.0526315789",
  worstCaseProfit: "5.00",
  roi: "0.05",
  quoteAgeMs: 10,
  mappingEvidence: [],
  executionConfidence: "HIGH"
});

const completeSnapshot = () => ({
  revision: 1,
  generatedAtMs: 2000,
  providerStatuses: [],
  counts: {
    FOOTBALL: { events: 1, markets: 1 },
    LOL: { events: 0, markets: 0 },
    mappings: { VERIFIED: 1, REVIEW_REQUIRED: 0, REJECTED: 0 },
    opportunities: 1
  },
  events: [],
  markets: [{
    canonicalMarketId: "canonical-market-1",
    canonicalEventId: "canonical-event-1",
    category: "FOOTBALL",
    marketType: "FT_1X2",
    scope: "FULL_TIME",
    line: null,
    settlementProfile: "regular-time",
    providerMarketIds: ["market-1"],
    mappingStatus: "VERIFIED",
    mappingEvidence: []
  }],
  opportunities: [completeOpportunity()],
  blockedDiagnostics: []
});

describe("ProviderQuoteSchema", () => {
  it("accepts a complete quote", () => {
    expect(ProviderQuoteSchema.safeParse(completeQuote()).success).toBe(true);
  });

  it("rejects an unknown category", () => {
    expect(ProviderQuoteSchema.safeParse({ ...completeQuote(), category: "TENNIS" }).success).toBe(false);
  });

  it.each([
    ["FOOTBALL", "MAP_WINNER", "FULL_TIME"],
    ["FOOTBALL", "FT_1X2", "MAP_1"],
    ["LOL", "FT_1X2", "SERIES"],
    ["LOL", "MAP_WINNER", "FULL_TIME"]
  ] as const)("rejects incompatible %s market %s at scope %s", (category, marketType, scope) => {
    expect(ProviderQuoteSchema.safeParse({ ...completeQuote(), category, marketType, scope }).success).toBe(false);
  });

  it.each(["NaN", "Infinity", "1e3", " 1.26", "1.26 ", "not-a-number"])(
    "rejects non-plain decimal odds %s",
    (rawOdds) => {
      expect(ProviderQuoteSchema.safeParse({ ...completeQuote(), rawOdds }).success).toBe(false);
    }
  );

  it("rejects unknown critical fields", () => {
    expect(ProviderQuoteSchema.safeParse({ ...completeQuote(), decimalOdds: "2.26" }).success).toBe(false);
  });
});

describe("ProviderMarketSchema", () => {
  it("rejects incompatible Football market types", () => {
    expect(ProviderMarketSchema.safeParse({ ...completeMarket(), marketType: "MAP_WINNER" }).success).toBe(false);
  });

  it("rejects unknown ingress fields", () => {
    expect(ProviderMarketSchema.safeParse({ ...completeMarket(), providerSelectionId: "selection-1" }).success).toBe(false);
  });
});

describe("ProviderConnectionStatusSchema", () => {
  const completeStatus = () => ({
    adapterId: "saba-football",
    provider: "SABA",
    category: "FOOTBALL",
    status: "LIVE",
    detail: null,
    updatedAtMs: 1
  });

  it("requires a nonblank adapter identity", () => {
    expect(ProviderConnectionStatusSchema.safeParse(completeStatus()).success).toBe(true);
    expect(ProviderConnectionStatusSchema.safeParse({
      ...completeStatus(),
      adapterId: "   "
    }).success).toBe(false);
    const { adapterId: _adapterId, ...missing } = completeStatus();
    expect(ProviderConnectionStatusSchema.safeParse(missing).success).toBe(false);
  });
});

describe("read-model category compatibility", () => {
  it("rejects a Football canonical market with a LoL market type", () => {
    expect(CanonicalMarketSchema.safeParse({
      canonicalMarketId: "canonical-market-1",
      canonicalEventId: "canonical-event-1",
      category: "FOOTBALL",
      marketType: "MAP_WINNER",
      scope: "FULL_TIME",
      line: null,
      settlementProfile: "regular-time",
      providerMarketIds: ["market-1"],
      mappingStatus: "VERIFIED",
      mappingEvidence: []
    }).success).toBe(false);
  });

  it("rejects a LoL opportunity with a Football scope", () => {
    expect(OpportunitySchema.safeParse({
      ...completeOpportunity(),
      category: "LOL",
      marketType: "MAP_WINNER",
      scope: "FULL_TIME"
    }).success).toBe(false);
  });
});

describe("StakeLegSchema", () => {
  it("rejects an eligible leg with ineligibility reasons", () => {
    expect(StakeLegSchema.safeParse({ ...completeStakeLeg(), ineligibleReasons: ["STALE"] }).success).toBe(false);
  });

  it("rejects an eligible leg whose quote is suspended", () => {
    expect(StakeLegSchema.safeParse({ ...completeStakeLeg(), quoteStatus: "SUSPENDED" }).success).toBe(false);
  });

  it("rejects an ineligible leg without a reason", () => {
    expect(StakeLegSchema.safeParse({ ...completeStakeLeg(), eligible: false }).success).toBe(false);
  });

  it("accepts an ineligible leg with a planned reason", () => {
    expect(StakeLegSchema.safeParse({ ...completeStakeLeg(), eligible: false, ineligibleReasons: ["STALE"] }).success).toBe(true);
  });

  it("rejects an unrecognized ineligibility reason", () => {
    expect(StakeLegSchema.safeParse({ ...completeStakeLeg(), eligible: false, ineligibleReasons: ["NOT_READY"] }).success).toBe(false);
  });
});

describe("AppSnapshotSchema", () => {
  it("rejects duplicate adapter/category status identities", () => {
    const status = {
      adapterId: "saba-football",
      provider: "SABA",
      category: "FOOTBALL",
      status: "LIVE",
      detail: null,
      updatedAtMs: 1
    } as const;
    expect(AppSnapshotSchema.safeParse({
      ...completeSnapshot(),
      providerStatuses: [status, { ...status, status: "SCHEMA_ERROR" }]
    }).success).toBe(false);
  });

  it("accepts a HIGH opportunity for a verified market with eligible open legs", () => {
    expect(AppSnapshotSchema.safeParse(completeSnapshot()).success).toBe(true);
  });

  it("rejects an opportunity whose canonical market is not verified", () => {
    const snapshot = completeSnapshot();
    expect(AppSnapshotSchema.safeParse({
      ...snapshot,
      markets: [{ ...snapshot.markets[0]!, mappingStatus: "REVIEW_REQUIRED" }]
    }).success).toBe(false);
  });

  it("rejects BLOCKED opportunities from the live snapshot", () => {
    const snapshot = completeSnapshot();
    expect(AppSnapshotSchema.safeParse({
      ...snapshot,
      opportunities: [{ ...snapshot.opportunities[0]!, executionConfidence: "BLOCKED" }]
    }).success).toBe(false);
  });

  it.each([
    ["SUSPENDED", true, []],
    ["OPEN", false, ["STALE"]]
  ] as const)("rejects a %s or ineligible opportunity leg", (quoteStatus, eligible, ineligibleReasons) => {
    const snapshot = completeSnapshot();
    const opportunity = snapshot.opportunities[0]!;
    expect(AppSnapshotSchema.safeParse({
      ...snapshot,
      opportunities: [{
        ...opportunity,
        legs: [{ ...opportunity.legs[0]!, quoteStatus, eligible, ineligibleReasons: [...ineligibleReasons] }]
      }]
    }).success).toBe(false);
  });

  it("rejects non-decimal stake values", () => {
    const snapshot = completeSnapshot();
    const opportunity = snapshot.opportunities[0]!;
    expect(AppSnapshotSchema.safeParse({
      ...snapshot,
      opportunities: [{ ...opportunity, legs: [{ ...opportunity.legs[0]!, stake: "1e3" }] }]
    }).success).toBe(false);
  });

  it("rejects an opportunity leg with contradictory eligibility provenance", () => {
    const snapshot = completeSnapshot();
    const opportunity = snapshot.opportunities[0]!;
    expect(AppSnapshotSchema.safeParse({
      ...snapshot,
      opportunities: [{
        ...opportunity,
        legs: [{ ...opportunity.legs[0]!, ineligibleReasons: ["STALE"] }]
      }]
    }).success).toBe(false);
  });

  it("rejects unknown snapshot fields", () => {
    expect(AppSnapshotSchema.safeParse({ ...completeSnapshot(), executionReady: true }).success).toBe(false);
  });
});

describe("RealtimeMessageSchema", () => {
  it("accepts strict snapshot and heartbeat envelopes", () => {
    expect(RealtimeMessageSchema.safeParse({
      type: "SNAPSHOT", revision: 1, data: completeSnapshot()
    }).success).toBe(true);
    expect(RealtimeMessageSchema.safeParse({
      type: "HEARTBEAT", revision: 1, serverTimeMs: 2
    }).success).toBe(true);
  });

  it("rejects malformed, mismatched, and unknown realtime data", () => {
    expect(RealtimeMessageSchema.safeParse({
      type: "SNAPSHOT", revision: 1, data: { revision: "wrong" }
    }).success).toBe(false);
    expect(RealtimeMessageSchema.safeParse({
      type: "SNAPSHOT", revision: 2, data: completeSnapshot()
    }).success).toBe(false);
    expect(RealtimeMessageSchema.safeParse({
      type: "HEARTBEAT", revision: 1, serverTimeMs: 2, extra: true
    }).success).toBe(false);
  });
});
