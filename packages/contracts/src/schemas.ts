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
  RealtimeMessage,
  QuoteIneligibilityReason,
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

export const QuoteIneligibilityReasonSchema = z.enum([
  "STALE",
  "SUSPENDED",
  "CLOSED",
  "OUT_OF_ORDER",
  "SEQUENCE_GAP",
  "NEEDS_SNAPSHOT",
  "SCHEMA_ERROR"
]) satisfies z.ZodType<QuoteIneligibilityReason>;

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

export const DecimalStringSchema = z
  .string()
  .regex(/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/, "must be a plain decimal string");

const footballMarketTypes = new Set<MarketType>(["FT_1X2", "FT_AH", "FT_TOTAL", "FH_1X2", "FH_AH", "FH_TOTAL"]);
const lolMarketTypes = new Set<MarketType>([
  "SERIES_WINNER",
  "MAP_WINNER",
  "MAP_TOTAL_KILLS",
  "MAP_KILL_HANDICAP",
  "MAP_DURATION"
]);
const footballScopes = new Set<Scope>(["FULL_TIME", "FIRST_HALF"]);
const lolScopes = new Set<Scope>(["SERIES", "MAP_1", "MAP_2", "MAP_3", "MAP_4", "MAP_5"]);

function validateCategoryCompatibility(
  value: { category: Category; marketType: MarketType; scope: Scope },
  context: z.RefinementCtx
): void {
  const compatibleMarketTypes = value.category === "FOOTBALL" ? footballMarketTypes : lolMarketTypes;
  const compatibleScopes = value.category === "FOOTBALL" ? footballScopes : lolScopes;

  if (value.marketType !== "OBSERVE_ONLY" && !compatibleMarketTypes.has(value.marketType)) {
    context.addIssue({
      code: "custom",
      path: ["marketType"],
      message: "market type is incompatible with category"
    });
  }

  if (!compatibleScopes.has(value.scope)) {
    context.addIssue({
      code: "custom",
      path: ["scope"],
      message: "scope is incompatible with category"
    });
  }
}

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
  line: DecimalStringSchema.nullable(),
  settlementProfile: z.string(),
  status: QuoteStatusSchema
}).superRefine(validateCategoryCompatibility) satisfies z.ZodType<ProviderMarket>;

export const ProviderQuoteSchema = z.strictObject({
  provider: z.string(),
  category: CategorySchema,
  providerEventId: z.string(),
  providerMarketId: z.string(),
  providerSelectionId: z.string(),
  marketType: MarketTypeSchema,
  scope: ScopeSchema,
  selection: z.string(),
  line: DecimalStringSchema.nullable(),
  rawOdds: DecimalStringSchema,
  rawFormat: OddsFormatSchema,
  status: QuoteStatusSchema,
  isLive: z.boolean(),
  sourceTimestampMs: z.number().nullable(),
  receivedMonotonicMs: z.number(),
  sequence: z.number().nullable()
}).superRefine(validateCategoryCompatibility) satisfies z.ZodType<ProviderQuote>;

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
  line: DecimalStringSchema.nullable(),
  settlementProfile: z.string(),
  providerMarketIds: z.array(z.string()),
  mappingStatus: MappingStatusSchema,
  mappingEvidence: z.array(MappingEvidenceSchema)
}).superRefine(validateCategoryCompatibility) satisfies z.ZodType<CanonicalMarket>;

export const StakeLegSchema = z.strictObject({
  provider: z.string(),
  providerEventId: z.string(),
  providerMarketId: z.string(),
  providerSelectionId: z.string(),
  selection: z.string(),
  rawOdds: DecimalStringSchema,
  rawFormat: OddsFormatSchema,
  decimalOdds: DecimalStringSchema,
  effectiveDecimal: DecimalStringSchema,
  stake: DecimalStringSchema,
  minStake: DecimalStringSchema,
  maxStake: DecimalStringSchema,
  payout: DecimalStringSchema,
  quoteAgeMs: z.number(),
  quoteStatus: QuoteStatusSchema,
  sourceTimestampMs: z.number().nullable(),
  receivedMonotonicMs: z.number(),
  sequence: z.number().nullable(),
  eligible: z.boolean(),
  ineligibleReasons: z.array(QuoteIneligibilityReasonSchema)
}).superRefine((leg, context) => {
  if (leg.eligible) {
    if (leg.quoteStatus !== "OPEN") {
      context.addIssue({
        code: "custom",
        path: ["quoteStatus"],
        message: "eligible legs must have an open quote"
      });
    }

    if (leg.ineligibleReasons.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["ineligibleReasons"],
        message: "eligible legs cannot have ineligibility reasons"
      });
    }
  } else if (leg.ineligibleReasons.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["ineligibleReasons"],
      message: "ineligible legs must provide at least one reason"
    });
  }
}) satisfies z.ZodType<StakeLeg>;

export const OpportunitySchema = z.strictObject({
  opportunityId: z.string(),
  canonicalEventId: z.string(),
  canonicalMarketId: z.string(),
  category: CategorySchema,
  marketType: MarketTypeSchema,
  scope: ScopeSchema,
  line: DecimalStringSchema.nullable(),
  settlementProfile: z.string(),
  legs: z.array(StakeLegSchema),
  inverseSum: DecimalStringSchema,
  netMargin: DecimalStringSchema,
  worstCaseProfit: DecimalStringSchema,
  roi: DecimalStringSchema,
  quoteAgeMs: z.number(),
  mappingEvidence: z.array(MappingEvidenceSchema),
  executionConfidence: z.enum(["HIGH", "BLOCKED"])
}).superRefine(validateCategoryCompatibility) satisfies z.ZodType<Opportunity>;

export const ProviderConnectionStateSchema = z.enum([
  "CONNECTING",
  "LIVE",
  "DEGRADED",
  "DISCONNECTED",
  "SCHEMA_ERROR"
]) satisfies z.ZodType<ProviderConnectionState>;

export const ProviderConnectionStatusSchema = z.strictObject({
  adapterId: z.string().trim().min(1),
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
}).superRefine((snapshot, context) => {
  const statusIdentities = new Set<string>();
  snapshot.providerStatuses.forEach((status, statusIndex) => {
    const identity = `${status.adapterId}\u0000${status.category}`;
    if (statusIdentities.has(identity)) {
      context.addIssue({
        code: "custom",
        path: ["providerStatuses", statusIndex, "adapterId"],
        message: "adapter/category status identities must be unique"
      });
    }
    statusIdentities.add(identity);
  });

  const marketsById = new Map(snapshot.markets.map((market) => [market.canonicalMarketId, market]));

  snapshot.opportunities.forEach((opportunity, opportunityIndex) => {
    const market = marketsById.get(opportunity.canonicalMarketId);
    if (market?.mappingStatus !== "VERIFIED") {
      context.addIssue({
        code: "custom",
        path: ["opportunities", opportunityIndex, "canonicalMarketId"],
        message: "opportunity must reference a verified market in the snapshot"
      });
    }

    if (opportunity.executionConfidence !== "HIGH") {
      context.addIssue({
        code: "custom",
        path: ["opportunities", opportunityIndex, "executionConfidence"],
        message: "published opportunities must have HIGH execution confidence"
      });
    }

    opportunity.legs.forEach((leg, legIndex) => {
      if (leg.quoteStatus !== "OPEN" || !leg.eligible) {
        context.addIssue({
          code: "custom",
          path: ["opportunities", opportunityIndex, "legs", legIndex],
          message: "published opportunity legs must be open and eligible"
        });
      }
    });
  });
}) satisfies z.ZodType<AppSnapshot>;

export const RealtimeMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("SNAPSHOT"),
    revision: z.number(),
    data: AppSnapshotSchema
  }).superRefine((message, context) => {
    if (message.revision !== message.data.revision) {
      context.addIssue({
        code: "custom",
        path: ["revision"],
        message: "snapshot envelope revision must match data revision"
      });
    }
  }),
  z.strictObject({
    type: z.literal("HEARTBEAT"),
    revision: z.number(),
    serverTimeMs: z.number()
  })
]) satisfies z.ZodType<RealtimeMessage>;
