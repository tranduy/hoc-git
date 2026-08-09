import { z } from "zod";
import type {
  AccountStatus,
  AppSnapshot,
  BlockedDiagnostic,
  CanonicalEvent,
  CanonicalMarket,
  Category,
  DataMode,
  MappingEvidence,
  MappingStatus,
  MarketType,
  OddsFormat,
  Opportunity,
  PreflightLeg,
  PreflightRequest,
  PreflightTicket,
  ProfileState,
  ProviderCapability,
  ProviderConnectionState,
  ProviderConnectionStatus,
  ProviderEvent,
  ProviderId,
  ProviderMarket,
  ProviderQuote,
  RedactedSessionStatus,
  RealtimeMessage,
  QuoteIneligibilityReason,
  QuoteMovement,
  QuoteStatus,
  Scope,
  SnapshotCounts,
  SessionHealthReason,
  SessionSource,
  SessionState,
  SessionStatusList,
  StakeLeg
} from "./domain.js";

export const SessionSourceSchema = z.enum([
  "FABET_LOGIN",
  "MANUAL_PROVIDER_SESSION"
]) satisfies z.ZodType<SessionSource>;

export const SessionStateSchema = z.enum([
  "UNCONFIGURED",
  "VALIDATING",
  "ACTIVE",
  "RENEWING",
  "ACTION_REQUIRED",
  "INVALID"
]) satisfies z.ZodType<SessionState>;

export const SessionHealthReasonSchema = z.enum([
  "UNREACHABLE",
  "DOMAIN_APPROVAL_REQUIRED",
  "UNAUTHORIZED",
  "EXPIRED",
  "SCHEMA_CHANGED",
  "VAULT_UNAVAILABLE",
  "RESET_FAILED"
]) satisfies z.ZodType<SessionHealthReason>;

export const RedactedSessionStatusSchema = z.strictObject({
  id: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  source: SessionSourceSchema,
  state: SessionStateSchema,
  trustedHostname: z.string().trim().min(1).nullable(),
  acquiredAtMs: z.number().finite().nonnegative().nullable(),
  lastValidatedAtMs: z.number().finite().nonnegative().nullable(),
  renewAfterMs: z.number().finite().nonnegative().nullable(),
  secretConfigured: z.boolean(),
  reason: SessionHealthReasonSchema.nullable()
}).superRefine((status, context) => {
  if (
    status.acquiredAtMs !== null &&
    status.renewAfterMs !== null &&
    status.renewAfterMs < status.acquiredAtMs
  ) {
    context.addIssue({
      code: "custom",
      path: ["renewAfterMs"],
      message: "renewal time cannot precede acquisition"
    });
  }
}) satisfies z.ZodType<RedactedSessionStatus>;

export const SessionStatusListSchema = z.strictObject({
  sessions: z.array(RedactedSessionStatusSchema)
}) satisfies z.ZodType<SessionStatusList>;

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

const NonnegativeDecimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "must be a nonnegative plain decimal string");

export const ProviderIdSchema = z.enum([
  "FABET", "CMD", "SABA", "SBOBET", "APSPORT", "BTI", "IM"
]) satisfies z.ZodType<ProviderId>;

export const ProviderCapabilitySchema = z.enum([
  "PROFILE", "CATALOG", "PREFLIGHT", "EXECUTION"
]) satisfies z.ZodType<ProviderCapability>;

export const ProfileStateSchema = z.enum([
  "FRESH", "STALE", "UNAVAILABLE"
]) satisfies z.ZodType<ProfileState>;

export const DataModeSchema = z.enum(["LIVE", "FIXTURE"]) satisfies z.ZodType<DataMode>;

export const AccountStatusSchema = z.strictObject({
  id: z.string().trim().min(1).max(128),
  alias: z.string().trim().min(1).max(80),
  provider: ProviderIdSchema,
  sessionState: SessionStateSchema,
  profileState: ProfileStateSchema,
  redactedLabel: z.string().trim().min(1).max(128).nullable(),
  currency: z.string().regex(/^[A-Z]{3,8}$/u).nullable(),
  balance: NonnegativeDecimalStringSchema.nullable(),
  balanceAsOfMs: z.number().finite().nonnegative().nullable(),
  capabilities: z.array(ProviderCapabilitySchema).max(4),
  reason: SessionHealthReasonSchema.nullable()
}).superRefine((account, context) => {
  const hasCompleteProfile = account.redactedLabel !== null && account.currency !== null &&
    account.balance !== null && account.balanceAsOfMs !== null;
  if (account.profileState === "FRESH" && !hasCompleteProfile) {
    context.addIssue({ code: "custom", path: ["profileState"], message: "fresh profile requires complete balance evidence" });
  }
  if (account.profileState === "UNAVAILABLE" && (
    account.currency !== null || account.balance !== null || account.balanceAsOfMs !== null
  )) {
    context.addIssue({ code: "custom", path: ["profileState"], message: "unavailable profile cannot expose balance evidence" });
  }
  if (new Set(account.capabilities).size !== account.capabilities.length) {
    context.addIssue({ code: "custom", path: ["capabilities"], message: "capabilities must be unique" });
  }
}) satisfies z.ZodType<AccountStatus>;

export const QuoteMovementSchema = z.strictObject({
  direction: z.enum(["UP", "DOWN", "UNCHANGED"]),
  previousDecimal: NonnegativeDecimalStringSchema,
  currentDecimal: NonnegativeDecimalStringSchema,
  changedAtMs: z.number().finite().nonnegative(),
  sampleCount: z.number().int().min(1).max(120),
  range5m: NonnegativeDecimalStringSchema
}) satisfies z.ZodType<QuoteMovement>;

export const PreflightRequestSchema = z.strictObject({
  opportunityId: z.string().trim().min(1).max(256),
  accountAId: z.string().trim().min(1).max(128),
  accountBId: z.string().trim().min(1).max(128),
  maxOddsDriftBps: z.number().int().min(0).max(10_000)
}).superRefine((request, context) => {
  if (request.accountAId === request.accountBId) {
    context.addIssue({ code: "custom", path: ["accountBId"], message: "preflight accounts must be distinct" });
  }
}) satisfies z.ZodType<PreflightRequest>;

export const PreflightLegSchema = z.strictObject({
  accountId: z.string().trim().min(1).max(128),
  provider: ProviderIdSchema,
  providerEventId: z.string().trim().min(1),
  providerMarketId: z.string().trim().min(1),
  providerSelectionId: z.string().trim().min(1),
  selection: z.string().trim().min(1),
  decimalOdds: NonnegativeDecimalStringSchema,
  stake: NonnegativeDecimalStringSchema,
  currency: z.string().regex(/^[A-Z]{3,8}$/u),
  balance: NonnegativeDecimalStringSchema,
  balanceAsOfMs: z.number().finite().nonnegative(),
  quoteAsOfMs: z.number().finite().nonnegative()
}) satisfies z.ZodType<PreflightLeg>;

export const PreflightTicketSchema = z.strictObject({
  ticketId: z.string().trim().min(1).max(256),
  opportunityId: z.string().trim().min(1).max(256),
  canonicalEventId: z.string().trim().min(1),
  canonicalMarketId: z.string().trim().min(1),
  baseCurrency: z.string().regex(/^[A-Z]{3,8}$/u),
  totalStakeBase: NonnegativeDecimalStringSchema,
  worstCaseProfit: DecimalStringSchema,
  issuedAtMs: z.number().finite().nonnegative(),
  expiresAtMs: z.number().finite().nonnegative(),
  nonce: z.string().min(16).max(256),
  signature: z.string().min(16).max(512),
  legs: z.tuple([PreflightLegSchema, PreflightLegSchema])
}).superRefine((ticket, context) => {
  const lifetimeMs = ticket.expiresAtMs - ticket.issuedAtMs;
  if (lifetimeMs <= 0 || lifetimeMs > 3_000) {
    context.addIssue({ code: "custom", path: ["expiresAtMs"], message: "preflight lifetime must be within three seconds" });
  }
  if (ticket.legs[0].accountId === ticket.legs[1].accountId) {
    context.addIssue({ code: "custom", path: ["legs", 1, "accountId"], message: "ticket accounts must be distinct" });
  }
}) satisfies z.ZodType<PreflightTicket>;

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

const ProviderEventBaseSchema = z.strictObject({
  provider: z.string(),
  providerEventId: z.string(),
  competition: z.string(),
  seasonStage: z.string().nullable(),
  startAtUtcMs: z.number(),
  participantA: z.string(),
  participantB: z.string(),
  eventScope: z.string(),
  isLive: z.boolean(),
  rematchCandidate: z.boolean().nullable(),
  fixtureDiscriminator: z.string().nullable()
});

export const ProviderEventSchema = z.discriminatedUnion("category", [
  ProviderEventBaseSchema.extend({
    category: z.literal("FOOTBALL"),
    bestOf: z.null(),
    isVirtual: z.boolean().nullable(),
    sportVariant: z.string().nullable(),
    liveState: z.strictObject({
      period: z.string().nullable(),
      scoreHome: z.number().nullable(),
      scoreAway: z.number().nullable(),
      clockMs: z.number().nullable()
    }).nullable()
  }),
  ProviderEventBaseSchema.extend({
    category: z.literal("LOL"),
    bestOf: z.number().nullable(),
    gameVariant: z.string().nullable(),
    liveState: z.strictObject({
      seriesScoreA: z.number().nullable(),
      seriesScoreB: z.number().nullable(),
      currentMap: z.number().nullable(),
      mapState: z.string().nullable()
    }).nullable()
  })
]) satisfies z.ZodType<ProviderEvent>;

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
  isLive: z.boolean().nullable(),
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
  stakeCurrency: z.string().trim().min(1),
  baseCurrency: z.string().trim().min(1),
  stakeBase: DecimalStringSchema,
  minStake: DecimalStringSchema,
  maxStake: DecimalStringSchema,
  payout: DecimalStringSchema,
  feeType: z.enum(["NONE", "PROFIT", "PAYOUT"]),
  feeRate: DecimalStringSchema.nullable(),
  fxRate: DecimalStringSchema,
  fxSpreadRate: DecimalStringSchema,
  fxAsOfMs: z.number().int().nonnegative(),
  quoteAgeMs: z.number(),
  quoteStatus: QuoteStatusSchema,
  sourceTimestampMs: z.number().nullable(),
  receivedMonotonicMs: z.number(),
  sequence: z.number().nullable(),
  eligible: z.boolean(),
  ineligibleReasons: z.array(QuoteIneligibilityReasonSchema)
}).superRefine((leg, context) => {
  if ((leg.feeType === "NONE") !== (leg.feeRate === null)) {
    context.addIssue({
      code: "custom",
      path: ["feeRate"],
      message: "NONE fees require a null rate and charged fees require a rate"
    });
  }
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
  baseCurrency: z.string().trim().min(1),
  totalStakeBase: DecimalStringSchema,
  inverseSum: DecimalStringSchema,
  netMargin: DecimalStringSchema,
  worstCaseProfit: DecimalStringSchema,
  roi: DecimalStringSchema,
  quoteAgeMs: z.number(),
  mappingEvidence: z.array(MappingEvidenceSchema),
  executionConfidence: z.enum(["HIGH", "BLOCKED"])
}).superRefine(validateCategoryCompatibility).superRefine((opportunity, context) => {
  if (opportunity.legs.some((leg) => leg.baseCurrency !== opportunity.baseCurrency)) {
    context.addIssue({
      code: "custom",
      path: ["legs"],
      message: "every leg must use the opportunity base currency"
    });
  }
}) satisfies z.ZodType<Opportunity>;

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
