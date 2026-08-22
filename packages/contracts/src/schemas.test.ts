import { describe, expect, it } from "vitest";
import {
  AccountStatusSchema,
  AppSnapshotSchema,
  CatalogSourceStatusSchema,
  CanonicalMarketSchema,
  ExecutionRequestSchema,
  MarketTypeSchema,
  OpportunitySchema,
  OddsFormatSchema,
  PreflightRequestSchema,
  PreflightTicketSchema,
  ProviderStakeConstraintSchema,
  ProviderTicketPreflightSchema,
  ProviderTicketPreflightRequestSchema,
  ProviderConnectionStatusSchema,
  ProviderEventSchema,
  ProviderMarketSchema,
  ProviderQuoteSchema,
  QuoteMovementSchema,
  RedactedSessionStatusSchema,
  RealtimeMessageSchema,
  SessionStatusListSchema,
  SessionHealthReasonSchema,
  SessionSourceSchema,
  ScopeSchema,
  StakeLegSchema,
  TicketRealtimeCheckRequestSchema,
  TicketRealtimeCheckResponseSchema,
  TwoLegExecutionResultSchema
} from "./schemas.js";

describe("TicketRealtimeCheck schemas", () => {
  const displayed = { provider: "SABA", accountId: "saba", providerEventId: "event-a",
    providerMarketId: "market-a", providerSelectionId: "selection-a", selection: "HOME", line: "-0.25",
    rawOdds: "0.91", rawFormat: "MALAY", decimalOdds: "1.91", quoteStatus: "OPEN",
    providerObservedAtMs: 1_000, receivedMonotonicMs: 10, sequence: 8, requestedStake: "100000" } as const;
  const request = { eventLabel: "Alpha vs Beta", participantA: "Alpha", participantB: "Beta",
    marketType: "FT_AH", scope: "FULL_TIME", capturedAtMs: 1_100,
    legs: [displayed, { ...displayed, provider: "CMD", accountId: "cmd", providerEventId: "event-b",
      providerMarketId: "market-b", providerSelectionId: "selection-b", selection: "AWAY" }] } as const;

  it("requires explicit participants in the exact displayed ticket identity", () => {
    expect(TicketRealtimeCheckRequestSchema.safeParse(request).success).toBe(true);
    const { participantA: _participantA, ...missingParticipant } = request;
    expect(TicketRealtimeCheckRequestSchema.safeParse(missingParticipant).success).toBe(false);
  });

  it("preserves direct read method and the four fail-closed verification outcomes", () => {
    const direct = { accountId: "saba", provider: "SABA", providerEventId: "event-a",
      providerMarketId: "market-a", providerSelectionId: "selection-a", selection: "HOME", line: "-0.25",
      rawOdds: "0.91", rawFormat: "MALAY", decimalOdds: "1.91", quoteStatus: "OPEN",
      providerObservedAtMs: 1_120, receivedMonotonicMs: 11, sequence: null,
      limitEvidence: null, constraint: null, eligible: false, reasons: ["LIMIT_UNAVAILABLE"] };
    const leg = { status: "MATCH", verificationStatus: "MATCH", directMethod: "DOM",
      displayed, direct, error: null, startedAtMs: 1_101, completedAtMs: 1_121, elapsedMs: 20 };
    const response = { checkId: "check-1", eventLabel: request.eventLabel,
      participantA: request.participantA, participantB: request.participantB,
      marketType: request.marketType, scope: request.scope, capturedAtMs: request.capturedAtMs,
      completedAtMs: 1_121, persisted: true,
      legs: [leg, { ...leg, status: "ODDS_CHANGED", verificationStatus: "MISMATCH",
        directMethod: "IN_PAGE_FETCH", displayed: request.legs[1], direct: { ...direct, accountId: "cmd",
          provider: "CMD", providerEventId: "event-b", providerMarketId: "market-b",
          providerSelectionId: "selection-b", selection: "AWAY" } }] };
    expect(TicketRealtimeCheckResponseSchema.safeParse(response).success).toBe(true);
    for (const status of ["MATCH", "MISMATCH", "NOT_FOUND", "AMBIGUOUS"] as const) {
      expect(TicketRealtimeCheckResponseSchema.safeParse({ ...response,
        legs: [{ ...leg, verificationStatus: status }, response.legs[1]] }).success).toBe(true);
    }
  });
});

describe("SessionSourceSchema", () => {
  it("keeps TK88 Chrome distinct from Fabet and manual provider sessions", () => {
    expect(SessionSourceSchema.parse("TK88_CHROME")).toBe("TK88_CHROME");
    expect(RedactedSessionStatusSchema.parse({
      id: "tk88", provider: "TK88", category: null, source: "TK88_CHROME", state: "ACTION_REQUIRED",
      trustedHostname: "tk88.example", acquiredAtMs: 100, lastValidatedAtMs: null,
      renewAfterMs: null, nextRetryAtMs: null, secretConfigured: true, reason: "SCHEMA_CHANGED"
    }).source).toBe("TK88_CHROME");
  });
});

describe("expanded exact two-way Football market taxonomy", () => {
  it.each([
    ["SH_AH", "SECOND_HALF"], ["SH_TOTAL", "SECOND_HALF"],
    ["CORNER_FT_AH", "FULL_TIME"], ["CORNER_FT_TOTAL", "FULL_TIME"],
    ["CORNER_FH_AH", "FIRST_HALF"], ["CORNER_FH_TOTAL", "FIRST_HALF"],
    ["CARD_FT_AH", "FULL_TIME"], ["CARD_FT_TOTAL", "FULL_TIME"],
    ["CARD_FH_AH", "FIRST_HALF"], ["CARD_FH_TOTAL", "FIRST_HALF"]
  ] as const)("accepts %s only as a distinct Football market in %s", (marketType, scope) => {
    expect(MarketTypeSchema.parse(marketType)).toBe(marketType);
    expect(ScopeSchema.parse(scope)).toBe(scope);
    expect(ProviderMarketSchema.safeParse({ provider: "SBOBET", category: "FOOTBALL",
      providerEventId: "event", providerMarketId: "market", marketType, scope, line: "0.5",
      settlementProfile: `verified-${marketType}`, status: "OPEN" }).success).toBe(true);
  });

  it("rejects a goal, corner or card market placed in a different period", () => {
    const base = { provider: "SBOBET", category: "FOOTBALL", providerEventId: "event",
      providerMarketId: "market", line: "0.5", settlementProfile: "verified", status: "OPEN" };
    expect(ProviderMarketSchema.safeParse({ ...base, marketType: "SH_TOTAL", scope: "FULL_TIME" }).success).toBe(false);
    expect(ProviderMarketSchema.safeParse({ ...base, marketType: "CORNER_FH_TOTAL", scope: "FULL_TIME" }).success).toBe(false);
    expect(ProviderMarketSchema.safeParse({ ...base, marketType: "CARD_FT_AH", scope: "FIRST_HALF" }).success).toBe(false);
  });
});

describe("CatalogSourceStatusSchema", () => {
  it("accepts one redacted logical source whose id matches its exact provider and category", () => {
    expect(CatalogSourceStatusSchema.parse({
      id: "catalog-source:SABA:FOOTBALL",
      alias: "C-Sports · SABA",
      provider: "SABA",
      category: "FOOTBALL",
      sessionState: "ACTIVE",
      sessionSource: "FABET_LOGIN",
      acquiredAtMs: 200,
      reason: null
    })).toMatchObject({ provider: "SABA", category: "FOOTBALL" });
  });

  it("rejects mismatched identity and any secret-shaped extra field", () => {
    const valid = {
      id: "catalog-source:SABA:FOOTBALL",
      alias: "C-Sports · SABA",
      provider: "SABA" as const,
      category: "FOOTBALL" as const,
      sessionState: "ACTIVE" as const,
      sessionSource: "FABET_LOGIN" as const,
      acquiredAtMs: 200,
      reason: null
    };
    expect(CatalogSourceStatusSchema.safeParse({ ...valid, category: "LOL" }).success).toBe(false);
    expect(CatalogSourceStatusSchema.safeParse({ ...valid, token: "must-not-pass" }).success).toBe(false);
  });
});

describe("live account and preflight schemas", () => {
  it("binds a short-lived provider constraint to one exact ticket", () => {
    const request = { accountId: "account-1", providerEventId: "event-1", providerMarketId: "market-1",
      providerSelectionId: "selection-1", selection: "HOME", line: "-0.5",
      expectedDecimalOdds: "2.2", requestedStake: "100000" };
    const constraint = { currency: "VND", minStake: "50000", maxStake: "200000", stakeStep: "1000",
      balance: "300000", feeType: "NONE" as const, feeRate: null, verifiedAsOfMs: 1000, expiresAtMs: 3500 };
    const limitEvidence = { currency: constraint.currency, minStake: constraint.minStake, maxStake: constraint.maxStake,
      stakeStep: constraint.stakeStep, balance: constraint.balance, verifiedAsOfMs: constraint.verifiedAsOfMs,
      expiresAtMs: constraint.expiresAtMs };
    expect(ProviderTicketPreflightRequestSchema.safeParse(request).success).toBe(true);
    expect(ProviderStakeConstraintSchema.safeParse(constraint).success).toBe(true);
    const direct = ProviderTicketPreflightSchema.safeParse({ accountId: request.accountId, provider: "SABA",
      providerEventId: request.providerEventId, providerMarketId: request.providerMarketId,
      providerSelectionId: request.providerSelectionId, selection: request.selection, line: request.line,
      rawOdds: "-0.83", rawFormat: "MALAY", decimalOdds: "2.2", quoteStatus: "OPEN",
      providerObservedAtMs: 1_100, receivedMonotonicMs: 75, sequence: 18,
      limitEvidence, constraint, eligible: true, reasons: [] });
    expect(direct.success).toBe(true);
    if (direct.success) expect(direct.data).toMatchObject({ rawOdds: "-0.83", rawFormat: "MALAY",
      providerObservedAtMs: 1_100, receivedMonotonicMs: 75, sequence: 18 });
  });

  it("rejects long-lived or internally inconsistent provider preflight evidence", () => {
    const constraint = { currency: "VND", minStake: "50000", maxStake: "200000", stakeStep: "1000",
      balance: "300000", feeType: "NONE" as const, feeRate: null, verifiedAsOfMs: 1000, expiresAtMs: 5000 };
    const limitEvidence = { currency: constraint.currency, minStake: constraint.minStake, maxStake: constraint.maxStake,
      stakeStep: constraint.stakeStep, balance: constraint.balance, verifiedAsOfMs: constraint.verifiedAsOfMs,
      expiresAtMs: 3000 };
    expect(ProviderStakeConstraintSchema.safeParse(constraint).success).toBe(false);
    expect(ProviderTicketPreflightSchema.safeParse({ accountId: "a", provider: "SABA", providerEventId: "e",
      providerMarketId: "m", providerSelectionId: "s", selection: "HOME", line: "-0.5",
      decimalOdds: "2.2", quoteStatus: "OPEN", limitEvidence,
      constraint: { ...constraint, expiresAtMs: 3000 },
      eligible: true, reasons: ["ODDS_CHANGED"] }).success).toBe(false);
    expect(ProviderTicketPreflightSchema.safeParse({ accountId: "a", provider: "SABA", providerEventId: "e",
      providerMarketId: "m", providerSelectionId: "s", selection: "HOME", line: "-0.5",
      decimalOdds: "2.2", quoteStatus: "OPEN", limitEvidence,
      constraint: { ...constraint, minStake: "60000", expiresAtMs: 3000 }, eligible: true, reasons: [] }).success).toBe(false);
  });

  it("allows a blocked exact quote to report unavailable limits without inventing a constraint", () => {
    expect(ProviderTicketPreflightSchema.safeParse({ accountId: "a", provider: "BTI", providerEventId: "e",
      providerMarketId: "m", providerSelectionId: "s", selection: "HOME", line: "-0.5",
      rawOdds: "1.2", rawFormat: "HK", decimalOdds: "2.2", quoteStatus: "OPEN",
      providerObservedAtMs: 1_100, receivedMonotonicMs: 75, sequence: null,
      limitEvidence: null, constraint: null,
      eligible: false, reasons: ["LIMIT_UNAVAILABLE"] }).success).toBe(true);
  });

  it("allows a blocked exact quote to report missing financial policy without inventing fee-free terms", () => {
    expect(ProviderTicketPreflightSchema.safeParse({ accountId: "a", provider: "SABA", providerEventId: "e",
      providerMarketId: "m", providerSelectionId: "s", selection: "HOME", line: "-0.5",
      rawOdds: "2.2", rawFormat: "DECIMAL", decimalOdds: "2.2", quoteStatus: "OPEN",
      providerObservedAtMs: 1_100, receivedMonotonicMs: 75, sequence: 1,
      limitEvidence: { currency: "VND", minStake: "30000",
        maxStake: "54945000", stakeStep: "1000", balance: "29610", verifiedAsOfMs: 1000, expiresAtMs: 3500 },
      constraint: null,
      eligible: false, reasons: ["FINANCIAL_POLICY_UNAVAILABLE"] }).success).toBe(true);
  });
  it("accepts Malay odds format for providers that publish signed Asian prices", () => {
    expect(OddsFormatSchema.parse("MALAY")).toBe("MALAY");
  });
  const account = () => ({
    id: "account-a",
    alias: "Main CMD",
    provider: "CMD",
    category: "FOOTBALL" as const,
    sessionState: "ACTIVE",
    profileState: "FRESH",
    redactedLabel: "03******90",
    currency: "VND",
    balance: "100000",
    balanceAsOfMs: 1_000,
    capabilities: ["PROFILE", "CATALOG", "PREFLIGHT"],
    reason: null
  });

  it("accepts a fully redacted fresh account", () => {
    expect(AccountStatusSchema.safeParse(account()).success).toBe(true);
  });

  it.each(["token", "cookie", "authorization", "launchUrl", "password"])(
    "rejects account secret field %s",
    (field) => expect(AccountStatusSchema.safeParse({ ...account(), [field]: "secret-canary" }).success).toBe(false)
  );

  it("rejects unknown providers, exponent balances, and missing fresh timestamps", () => {
    expect(AccountStatusSchema.safeParse({ ...account(), provider: "UNKNOWN" }).success).toBe(false);
    expect(AccountStatusSchema.safeParse({ ...account(), balance: "1e5" }).success).toBe(false);
    expect(AccountStatusSchema.safeParse({ ...account(), balanceAsOfMs: null }).success).toBe(false);
  });

  it("requires two distinct accounts for preflight", () => {
    expect(PreflightRequestSchema.safeParse({
      opportunityId: "opp-1", accountAId: "same", accountBId: "same", maxOddsDriftBps: 25
    }).success).toBe(false);
  });

  it("accepts bounded quote movement", () => {
    expect(QuoteMovementSchema.safeParse({
      direction: "UP", previousDecimal: "1.9", currentDecimal: "2.01",
      changedAtMs: 2_000, sampleCount: 4, range5m: "0.11"
    }).success).toBe(true);
  });

  it("rejects preflight tickets lasting longer than three seconds", () => {
    const leg = {
      accountId: "account-a", provider: "CMD", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1",
      selection: "HOME", line: "-0.5", decimalOdds: "2.1", stake: "50000", currency: "VND",
      balance: "100000", balanceAsOfMs: 2_000, quoteAsOfMs: 2_000
    };
    expect(PreflightTicketSchema.safeParse({
      ticketId: "ticket-1", opportunityId: "opp-1", canonicalEventId: "event-c",
      canonicalMarketId: "market-c", baseCurrency: "VND", totalStakeBase: "100000",
      worstCaseProfit: "2000", issuedAtMs: 2_000, expiresAtMs: 5_001,
      nonce: "nonce-value-123456", signature: "signature-value-123456",
      legs: [leg, { ...leg, accountId: "account-b", provider: "SABA" }]
    }).success).toBe(false);
  });

  it("accepts only an explicit dry-run execution request and strict two-leg result", () => {
    const leg = {
      accountId: "account-a", provider: "CMD", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1",
      selection: "HOME", line: "-0.5", decimalOdds: "2.1", stake: "50000", currency: "VND",
      balance: "100000", balanceAsOfMs: 2_000, quoteAsOfMs: 2_000
    };
    const ticket = {
      ticketId: "ticket-1", opportunityId: "opp-1", canonicalEventId: "event-c",
      canonicalMarketId: "market-c", baseCurrency: "VND", totalStakeBase: "100000",
      worstCaseProfit: "2000", issuedAtMs: 2_000, expiresAtMs: 5_000,
      nonce: "nonce-value-123456", signature: "signature-value-123456",
      legs: [leg, { ...leg, accountId: "account-b", provider: "SABA" }]
    };
    expect(ExecutionRequestSchema.safeParse({ ticket, idempotencyKey: "request-key-123456", mode: "DRY_RUN" }).success)
      .toBe(true);
    expect(ExecutionRequestSchema.safeParse({ ticket, idempotencyKey: "request-key-123456", mode: "LIVE" }).success)
      .toBe(false);
    expect(TwoLegExecutionResultSchema.safeParse({ ticketId: "ticket-1", idempotencyKey: "request-key-123456",
      mode: "DRY_RUN", status: "BOTH_ACCEPTED", legs: [
        { provider: "CMD", providerSelectionId: "selection-1", status: "ACCEPTED", reason: null },
        { provider: "SABA", providerSelectionId: "selection-2", status: "ACCEPTED", reason: null }
      ] }).success).toBe(true);
    expect(TwoLegExecutionResultSchema.safeParse({ ticketId: "ticket-1", idempotencyKey: "request-key-123456",
      mode: "DRY_RUN", status: "BOTH_ACCEPTED", legs: [
        { provider: "CMD", providerSelectionId: "selection-1", status: "ACCEPTED", reason: null },
        { provider: "SABA", providerSelectionId: "selection-2", status: "REJECTED", reason: "ODDS_CHANGED" }
      ] }).success).toBe(false);
  });
});

describe("RedactedSessionStatusSchema", () => {
  const completeStatus = () => ({
    id: "session-1",
    provider: "SABA",
    category: "FOOTBALL" as const,
    source: "MANUAL_PROVIDER_SESSION",
    state: "ACTIVE",
    trustedHostname: "sports.example.test",
    acquiredAtMs: 1_000,
    lastValidatedAtMs: 2_000,
    renewAfterMs: 86_401_000,
    nextRetryAtMs: null,
    secretConfigured: true,
    reason: null
  });

  it("accepts a redacted session status and list", () => {
    expect(RedactedSessionStatusSchema.safeParse(completeStatus()).success).toBe(true);
    expect(SessionStatusListSchema.safeParse({ sessions: [completeStatus()] }).success).toBe(true);
  });

  it.each(["token", "cookie", "authorization", "launchUrl", "password"])(
    "rejects secret-shaped field %s",
    (key) => expect(RedactedSessionStatusSchema.safeParse({
      ...completeStatus(),
      [key]: "secret-canary"
    }).success).toBe(false)
  );

  it("rejects a renewal time before acquisition", () => {
    expect(RedactedSessionStatusSchema.safeParse({
      ...completeStatus(),
      renewAfterMs: 999
    }).success).toBe(false);
  });

  it.each([
    "AUTH_EGRESS_UNAVAILABLE",
    "INTERACTIVE_AUTH_REQUIRED",
    "AUTH_BACKOFF",
    "PROVIDER_VALIDATION_FAILED"
  ] as const)("accepts automatic recovery reason %s", (reason) => {
    expect(SessionHealthReasonSchema.parse(reason)).toBe(reason);
    expect(RedactedSessionStatusSchema.parse({
      ...completeStatus(),
      state: "ACTION_REQUIRED",
      reason,
      nextRetryAtMs: 3_000
    }).nextRetryAtMs).toBe(3_000);
  });

  it("requires an explicit nullable retry timestamp", () => {
    const { nextRetryAtMs: _missing, ...withoutRetry } = completeStatus();
    expect(RedactedSessionStatusSchema.safeParse(withoutRetry).success).toBe(false);
  });
});

describe("ProviderEventSchema", () => {
  it("rejects an event that omits rematch and category-specific lifecycle evidence", () => {
    expect(ProviderEventSchema.safeParse({
      provider: "SABA",
      category: "FOOTBALL",
      providerEventId: "event-1",
      competition: "Premier League",
      seasonStage: "2026/27",
      startAtUtcMs: 1,
      participantA: "A",
      participantB: "B",
      eventScope: "REGULATION",
      bestOf: null,
      isLive: false
    }).success).toBe(false);
  });
});

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
  stakeCurrency: "USD",
  baseCurrency: "USD",
  stakeBase: "100.00",
  minStake: "10.00",
  maxStake: "1000.00",
  payout: "220.00",
  feeType: "PROFIT",
  feeRate: "0.01",
  fxRate: "1",
  fxSpreadRate: "0",
  fxAsOfMs: 1000,
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
  baseCurrency: "USD",
  totalStakeBase: "100.00",
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

  it("accepts strict catalog revision baseline and update envelopes", () => {
    expect(RealtimeMessageSchema.safeParse({
      type: "CATALOG_REVISION_BASELINE", sequence: 4,
      entries: [{ accountId: "catalog-source:SABA:FOOTBALL", revision: "SABA-100-FRESH",
        observedAtMs: 100, snapshotState: "FRESH" }]
    }).success).toBe(true);
    expect(RealtimeMessageSchema.safeParse({
      type: "CATALOG_REVISION", sequence: 5,
      accountId: "catalog-source:SABA:FOOTBALL", revision: "SABA-101-STALE",
      observedAtMs: 101, snapshotState: "STALE"
    }).success).toBe(true);
  });

  it("rejects unsafe catalog revision envelope fields", () => {
    expect(RealtimeMessageSchema.safeParse({
      type: "CATALOG_REVISION", sequence: -1,
      accountId: "catalog-source:SABA:FOOTBALL", revision: "",
      observedAtMs: -1, snapshotState: "FRESH", secret: "must-not-pass"
    }).success).toBe(false);
    expect(RealtimeMessageSchema.safeParse({
      type: "CATALOG_REVISION_BASELINE", sequence: 1,
      entries: [{ accountId: "", revision: "valid", observedAtMs: 1,
        snapshotState: "UNKNOWN" }]
    }).success).toBe(false);
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
