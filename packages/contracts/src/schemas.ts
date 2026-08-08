import { z } from "zod";
import type {
  AppSnapshot,
  BlockedDiagnostic,
  CanonicalEvent,
  CanonicalMarket,
  Category,
  MappingEvidence,
  MappingStatus,
  MarketType,
  OddsFormat,
  Opportunity,
  ProviderConnectionState,
  ProviderConnectionStatus,
  ProviderEvent,
  ProviderMarket,
  ProviderQuote,
  QuoteStatus,
  Scope,
  SnapshotCounts,
  StakeLeg
} from "./domain.js";

export const CategorySchema = z.enum(["FOOTBALL", "LOL"]) satisfies z.ZodType<Category>;

export const MappingStatusSchema = z.enum([
  "VERIFIED",
  "REVIEW_REQUIRED",
  "REJECTED"
]) satisfies z.ZodType<MappingStatus>;

export const QuoteStatusSchema = z.enum(["OPEN", "SUSPENDED", "CLOSED"]) satisfies z.ZodType<QuoteStatus>;

export const OddsFormatSchema = z.enum(["DECIMAL", "HK", "AMERICAN"]) satisfies z.ZodType<OddsFormat>;

export const MarketTypeSchema = z.enum([
  "FT_1X2",
  "FT_AH",
  "FT_TOTAL",
  "FH_1X2",
  "FH_AH",
  "FH_TOTAL",
  "SERIES_WINNER",
  "MAP_WINNER",
  "MAP_TOTAL_KILLS",
  "MAP_KILL_HANDICAP",
  "MAP_DURATION",
  "OBSERVE_ONLY"
]) satisfies z.ZodType<MarketType>;

export const ScopeSchema = z.enum([
  "FULL_TIME",
  "FIRST_HALF",
  "SERIES",
  "MAP_1",
  "MAP_2",
  "MAP_3",
  "MAP_4",
  "MAP_5"
]) satisfies z.ZodType<Scope>;

export const ProviderEventSchema = z.strictObject({
  provider: z.string(),
  category: CategorySchema,
  providerEventId: z.string(),
  competition: z.string(),
  seasonStage: z.string().nullable(),
  startAtUtcMs: z.number(),
  participantA: z.string(),
  participantB: z.string(),
  eventScope: z.string(),
  bestOf: z.number().nullable(),
  isLive: z.boolean()
}) satisfies z.ZodType<ProviderEvent>;

export const ProviderMarketSchema = z.strictObject({
  provider: z.string(),
  category: CategorySchema,
  providerEventId: z.string(),
  providerMarketId: z.string(),
  marketType: MarketTypeSchema,
  scope: ScopeSchema,
  line: z.string().nullable(),
  settlementProfile: z.string(),
  status: QuoteStatusSchema
}) satisfies z.ZodType<ProviderMarket>;

export const ProviderQuoteSchema = z.strictObject({
  provider: z.string(),
  category: CategorySchema,
  providerEventId: z.string(),
  providerMarketId: z.string(),
  providerSelectionId: z.string(),
  marketType: MarketTypeSchema,
  scope: ScopeSchema,
  selection: z.string(),
  line: z.string().nullable(),
  rawOdds: z.string(),
  rawFormat: OddsFormatSchema,
  status: QuoteStatusSchema,
  isLive: z.boolean(),
  sourceTimestampMs: z.number().nullable(),
  receivedMonotonicMs: z.number(),
  sequence: z.number().nullable()
}) satisfies z.ZodType<ProviderQuote>;

export const MappingEvidenceSchema = z.strictObject({
  gate: z.string(),
  passed: z.boolean(),
  expected: z.string(),
  actual: z.string(),
  reason: z.string()
}) satisfies z.ZodType<MappingEvidence>;

export const CanonicalEventSchema = z.strictObject({
  canonicalEventId: z.string(),
  category: CategorySchema,
  competition: z.string(),
  seasonStage: z.string().nullable(),
  startAtUtcMs: z.number(),
  participantA: z.string(),
  participantB: z.string(),
  providerEventIds: z.array(z.string()),
  mappingStatus: MappingStatusSchema,
  mappingEvidence: z.array(MappingEvidenceSchema)
}) satisfies z.ZodType<CanonicalEvent>;

export const CanonicalMarketSchema = z.strictObject({
  canonicalMarketId: z.string(),
  canonicalEventId: z.string(),
  category: CategorySchema,
  marketType: MarketTypeSchema,
  scope: ScopeSchema,
  line: z.string().nullable(),
  settlementProfile: z.string(),
  providerMarketIds: z.array(z.string()),
  mappingStatus: MappingStatusSchema,
  mappingEvidence: z.array(MappingEvidenceSchema)
}) satisfies z.ZodType<CanonicalMarket>;

export const StakeLegSchema = z.strictObject({
  provider: z.string(),
  providerEventId: z.string(),
  providerMarketId: z.string(),
  providerSelectionId: z.string(),
  selection: z.string(),
  rawOdds: z.string(),
  rawFormat: OddsFormatSchema,
  decimalOdds: z.string(),
  effectiveDecimal: z.string(),
  stake: z.string(),
  minStake: z.string(),
  maxStake: z.string(),
  payout: z.string(),
  quoteAgeMs: z.number()
}) satisfies z.ZodType<StakeLeg>;

export const OpportunitySchema = z.strictObject({
  opportunityId: z.string(),
  canonicalEventId: z.string(),
  canonicalMarketId: z.string(),
  category: CategorySchema,
  marketType: MarketTypeSchema,
  scope: ScopeSchema,
  line: z.string().nullable(),
  settlementProfile: z.string(),
  legs: z.array(StakeLegSchema),
  inverseSum: z.string(),
  netMargin: z.string(),
  worstCaseProfit: z.string(),
  roi: z.string(),
  quoteAgeMs: z.number(),
  mappingEvidence: z.array(MappingEvidenceSchema),
  executionConfidence: z.enum(["HIGH", "BLOCKED"])
}) satisfies z.ZodType<Opportunity>;

export const ProviderConnectionStateSchema = z.enum([
  "CONNECTING",
  "LIVE",
  "DEGRADED",
  "DISCONNECTED",
  "SCHEMA_ERROR"
]) satisfies z.ZodType<ProviderConnectionState>;

export const ProviderConnectionStatusSchema = z.strictObject({
  provider: z.string(),
  category: CategorySchema,
  status: ProviderConnectionStateSchema,
  detail: z.string().nullable(),
  updatedAtMs: z.number()
}) satisfies z.ZodType<ProviderConnectionStatus>;

export const SnapshotCountsSchema = z.strictObject({
  FOOTBALL: z.strictObject({ events: z.number(), markets: z.number() }),
  LOL: z.strictObject({ events: z.number(), markets: z.number() }),
  mappings: z.strictObject({
    VERIFIED: z.number(),
    REVIEW_REQUIRED: z.number(),
    REJECTED: z.number()
  }),
  opportunities: z.number()
}) satisfies z.ZodType<SnapshotCounts>;

export const BlockedDiagnosticSchema = z.strictObject({
  code: z.string(),
  category: CategorySchema,
  canonicalMarketId: z.string().nullable(),
  reason: z.string(),
  mappingEvidence: z.array(MappingEvidenceSchema)
}) satisfies z.ZodType<BlockedDiagnostic>;

export const AppSnapshotSchema = z.strictObject({
  revision: z.number(),
  generatedAtMs: z.number(),
  providerStatuses: z.array(ProviderConnectionStatusSchema),
  counts: SnapshotCountsSchema,
  events: z.array(CanonicalEventSchema),
  markets: z.array(CanonicalMarketSchema),
  opportunities: z.array(OpportunitySchema),
  blockedDiagnostics: z.array(BlockedDiagnosticSchema)
}) satisfies z.ZodType<AppSnapshot>;
