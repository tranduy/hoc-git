export type Category = "FOOTBALL" | "LOL";

export type SessionSource = "FABET_LOGIN" | "MANUAL_PROVIDER_SESSION";

export type SessionState =
  | "UNCONFIGURED"
  | "VALIDATING"
  | "ACTIVE"
  | "RENEWING"
  | "ACTION_REQUIRED"
  | "INVALID";

export type SessionHealthReason =
  | "UNREACHABLE"
  | "DOMAIN_APPROVAL_REQUIRED"
  | "UNAUTHORIZED"
  | "EXPIRED"
  | "SCHEMA_CHANGED"
  | "VAULT_UNAVAILABLE"
  | "RESET_FAILED";

export interface RedactedSessionStatus {
  readonly id: string;
  readonly provider: string;
  readonly category: Category | null;
  readonly source: SessionSource;
  readonly state: SessionState;
  readonly trustedHostname: string | null;
  readonly acquiredAtMs: number | null;
  readonly lastValidatedAtMs: number | null;
  readonly renewAfterMs: number | null;
  readonly secretConfigured: boolean;
  readonly reason: SessionHealthReason | null;
}

export interface SessionStatusList {
  readonly sessions: readonly RedactedSessionStatus[];
}

export type ProviderId = "FABET" | "CMD" | "SABA" | "SBOBET" | "APSPORT" | "BTI" | "IM";
export type ProviderCapability = "PROFILE" | "CATALOG" | "PREFLIGHT" | "EXECUTION";
export type ProfileState = "FRESH" | "STALE" | "UNAVAILABLE";
export type DataMode = "LIVE" | "FIXTURE";

export interface AccountStatus {
  readonly id: string;
  readonly alias: string;
  readonly provider: ProviderId;
  readonly category: Category | null;
  readonly sessionSource?: SessionSource | undefined;
  readonly sessionState: SessionState;
  readonly profileState: ProfileState;
  readonly redactedLabel: string | null;
  readonly currency: string | null;
  readonly balance: string | null;
  readonly balanceAsOfMs: number | null;
  readonly capabilities: readonly ProviderCapability[];
  readonly reason: SessionHealthReason | null;
}

export interface QuoteMovement {
  readonly direction: "UP" | "DOWN" | "UNCHANGED";
  readonly previousDecimal: string;
  readonly currentDecimal: string;
  readonly changedAtMs: number;
  readonly sampleCount: number;
  readonly range5m: string;
}

export interface PreflightRequest {
  readonly opportunityId: string;
  readonly accountAId: string;
  readonly accountBId: string;
  readonly maxOddsDriftBps: number;
}

export interface ProviderTicketPreflightRequest {
  readonly accountId: string;
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
  readonly selection: string;
  readonly line: string | null;
  readonly expectedDecimalOdds: string;
  readonly requestedStake: string;
}

export interface ProviderStakeLimitEvidence {
  readonly currency: string;
  readonly minStake: string;
  readonly maxStake: string;
  readonly stakeStep: string;
  readonly balance: string;
  readonly verifiedAsOfMs: number;
  readonly expiresAtMs: number;
}

export interface ProviderStakeConstraint extends ProviderStakeLimitEvidence {
  readonly feeType: "NONE" | "PROFIT" | "PAYOUT";
  readonly feeRate: string | null;
}

export interface ProviderTicketPreflight {
  readonly accountId: string;
  readonly provider: ProviderId;
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
  readonly selection: string;
  readonly line: string | null;
  readonly decimalOdds: string;
  readonly quoteStatus: QuoteStatus;
  readonly limitEvidence: ProviderStakeLimitEvidence | null;
  readonly constraint: ProviderStakeConstraint | null;
  readonly eligible: boolean;
  readonly reasons: readonly ("IDENTITY_MISMATCH" | "ODDS_CHANGED" | "MARKET_NOT_OPEN" |
    "BELOW_MIN" | "ABOVE_MAX" | "STAKE_STEP_MISMATCH" | "INSUFFICIENT_BALANCE" | "LIMIT_UNAVAILABLE" |
    "FINANCIAL_POLICY_UNAVAILABLE")[];
}

export interface PreflightLeg {
  readonly accountId: string;
  readonly provider: ProviderId;
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
  readonly selection: string;
  readonly line: string | null;
  readonly decimalOdds: string;
  readonly stake: string;
  readonly currency: string;
  readonly balance: string;
  readonly balanceAsOfMs: number;
  readonly quoteAsOfMs: number;
}

export interface ExecutionRequest {
  readonly ticket: PreflightTicket;
  readonly idempotencyKey: string;
  readonly mode: "DRY_RUN";
}

export type ExecutionLegResult = {
  readonly provider: ProviderId;
  readonly providerSelectionId: string;
} & (
  | { readonly status: "ACCEPTED"; readonly reason: null }
  | { readonly status: "REJECTED"; readonly reason: "ODDS_CHANGED" | "MARKET_SUSPENDED" |
    "LIMIT_CHANGED" | "INSUFFICIENT_BALANCE" | "PROVIDER_REJECTED" }
  | { readonly status: "UNKNOWN"; readonly reason: "TIMEOUT" | "ADAPTER_ERROR" |
    "ADAPTER_UNAVAILABLE" | "IDENTITY_MISMATCH" }
);

export interface TwoLegExecutionResult {
  readonly ticketId: string;
  readonly idempotencyKey: string;
  readonly mode: "DRY_RUN";
  readonly status: "BOTH_ACCEPTED" | "NONE_ACCEPTED" | "PARTIAL_FAILURE";
  readonly legs: readonly [ExecutionLegResult, ExecutionLegResult];
}

export interface PreflightTicket {
  readonly ticketId: string;
  readonly opportunityId: string;
  readonly canonicalEventId: string;
  readonly canonicalMarketId: string;
  readonly baseCurrency: string;
  readonly totalStakeBase: string;
  readonly worstCaseProfit: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly nonce: string;
  readonly signature: string;
  readonly legs: readonly [PreflightLeg, PreflightLeg];
}

export type MappingStatus = "VERIFIED" | "REVIEW_REQUIRED" | "REJECTED";

export type QuoteStatus = "OPEN" | "SUSPENDED" | "CLOSED";

export type QuoteIneligibilityReason =
  | "STALE"
  | "SUSPENDED"
  | "CLOSED"
  | "OUT_OF_ORDER"
  | "SEQUENCE_GAP"
  | "NEEDS_SNAPSHOT"
  | "SCHEMA_ERROR";

export type OddsFormat = "DECIMAL" | "HK" | "AMERICAN" | "MALAY";

export type MarketType =
  | "FT_1X2"
  | "FT_AH"
  | "FT_TOTAL"
  | "FH_1X2"
  | "FH_AH"
  | "FH_TOTAL"
  | "SERIES_WINNER"
  | "MAP_WINNER"
  | "MAP_TOTAL_KILLS"
  | "MAP_KILL_HANDICAP"
  | "MAP_DURATION"
  | "OBSERVE_ONLY";

export type Scope =
  | "FULL_TIME"
  | "FIRST_HALF"
  | "SERIES"
  | "MAP_1"
  | "MAP_2"
  | "MAP_3"
  | "MAP_4"
  | "MAP_5";

interface ProviderEventBase {
  readonly provider: string;
  readonly category: Category;
  readonly providerEventId: string;
  readonly competition: string;
  readonly seasonStage: string | null;
  readonly startAtUtcMs: number;
  readonly participantA: string;
  readonly participantB: string;
  readonly eventScope: string;
  readonly bestOf: number | null;
  readonly isLive: boolean;
  readonly rematchCandidate: boolean | null;
  readonly fixtureDiscriminator: string | null;
}

export interface ProviderFootballLiveState {
  readonly period: string | null;
  readonly scoreHome: number | null;
  readonly scoreAway: number | null;
  readonly clockMs: number | null;
}

export interface ProviderLolLiveState {
  readonly seriesScoreA: number | null;
  readonly seriesScoreB: number | null;
  readonly currentMap: number | null;
  readonly mapState: string | null;
}

export interface ProviderFootballEvent extends ProviderEventBase {
  readonly category: "FOOTBALL";
  readonly bestOf: null;
  readonly isVirtual: boolean | null;
  readonly sportVariant: string | null;
  readonly liveState: ProviderFootballLiveState | null;
}

export interface ProviderLolEvent extends ProviderEventBase {
  readonly category: "LOL";
  readonly bestOf: number | null;
  readonly gameVariant: string | null;
  readonly liveState: ProviderLolLiveState | null;
}

export type ProviderEvent = ProviderFootballEvent | ProviderLolEvent;

export interface ProviderMarket {
  readonly provider: string;
  readonly category: Category;
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly marketType: MarketType;
  readonly scope: Scope;
  readonly line: string | null;
  readonly settlementProfile: string;
  readonly status: QuoteStatus;
}

export interface ProviderQuote {
  readonly provider: string;
  readonly category: Category;
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
  readonly marketType: MarketType;
  readonly scope: Scope;
  readonly selection: string;
  readonly line: string | null;
  readonly rawOdds: string;
  readonly rawFormat: OddsFormat;
  readonly status: QuoteStatus;
  readonly isLive: boolean;
  readonly sourceTimestampMs: number | null;
  readonly receivedMonotonicMs: number;
  readonly sequence: number | null;
}

export interface MappingEvidence {
  readonly gate: string;
  readonly passed: boolean;
  readonly expected: string;
  readonly actual: string;
  readonly reason: string;
}

export interface CanonicalEvent {
  readonly canonicalEventId: string;
  readonly category: Category;
  readonly competition: string;
  readonly seasonStage: string | null;
  readonly startAtUtcMs: number;
  readonly participantA: string;
  readonly participantB: string;
  readonly providerEventIds: readonly string[];
  readonly isLive: boolean | null;
  readonly mappingStatus: MappingStatus;
  readonly mappingEvidence: readonly MappingEvidence[];
}

export interface CanonicalMarket {
  readonly canonicalMarketId: string;
  readonly canonicalEventId: string;
  readonly category: Category;
  readonly marketType: MarketType;
  readonly scope: Scope;
  readonly line: string | null;
  readonly settlementProfile: string;
  readonly providerMarketIds: readonly string[];
  readonly mappingStatus: MappingStatus;
  readonly mappingEvidence: readonly MappingEvidence[];
}

export interface StakeLeg {
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
  readonly selection: string;
  readonly rawOdds: string;
  readonly rawFormat: OddsFormat;
  readonly decimalOdds: string;
  readonly effectiveDecimal: string;
  readonly stake: string;
  readonly stakeCurrency: string;
  readonly baseCurrency: string;
  readonly stakeBase: string;
  readonly minStake: string;
  readonly maxStake: string;
  readonly payout: string;
  readonly feeType: "NONE" | "PROFIT" | "PAYOUT";
  readonly feeRate: string | null;
  readonly fxRate: string;
  readonly fxSpreadRate: string;
  readonly fxAsOfMs: number;
  readonly quoteAgeMs: number;
  readonly quoteStatus: QuoteStatus;
  readonly sourceTimestampMs: number | null;
  readonly receivedMonotonicMs: number;
  readonly sequence: number | null;
  readonly eligible: boolean;
  readonly ineligibleReasons: readonly QuoteIneligibilityReason[];
}

export interface Opportunity {
  readonly opportunityId: string;
  readonly canonicalEventId: string;
  readonly canonicalMarketId: string;
  readonly category: Category;
  readonly marketType: MarketType;
  readonly scope: Scope;
  readonly line: string | null;
  readonly settlementProfile: string;
  readonly legs: readonly StakeLeg[];
  readonly baseCurrency: string;
  readonly totalStakeBase: string;
  readonly inverseSum: string;
  readonly netMargin: string;
  readonly worstCaseProfit: string;
  readonly roi: string;
  readonly quoteAgeMs: number;
  readonly mappingEvidence: readonly MappingEvidence[];
  readonly executionConfidence: "HIGH" | "BLOCKED";
}

export type ProviderConnectionState =
  | "CONNECTING"
  | "LIVE"
  | "DEGRADED"
  | "DISCONNECTED"
  | "SCHEMA_ERROR";

export interface ProviderConnectionStatus {
  readonly adapterId: string;
  readonly provider: string;
  readonly category: Category;
  readonly status: ProviderConnectionState;
  readonly detail: string | null;
  readonly updatedAtMs: number;
}

export interface SnapshotCounts {
  readonly FOOTBALL: {
    readonly events: number;
    readonly markets: number;
  };
  readonly LOL: {
    readonly events: number;
    readonly markets: number;
  };
  readonly mappings: {
    readonly VERIFIED: number;
    readonly REVIEW_REQUIRED: number;
    readonly REJECTED: number;
  };
  readonly opportunities: number;
}

export interface BlockedDiagnostic {
  readonly code: string;
  readonly category: Category;
  readonly canonicalMarketId: string | null;
  readonly reason: string;
  readonly mappingEvidence: readonly MappingEvidence[];
}

export interface AppSnapshot {
  readonly revision: number;
  readonly generatedAtMs: number;
  readonly providerStatuses: readonly ProviderConnectionStatus[];
  readonly counts: SnapshotCounts;
  readonly events: readonly CanonicalEvent[];
  readonly markets: readonly CanonicalMarket[];
  readonly opportunities: readonly Opportunity[];
  readonly blockedDiagnostics: readonly BlockedDiagnostic[];
}

export type RealtimeMessage =
  | { readonly type: "SNAPSHOT"; readonly revision: number; readonly data: AppSnapshot }
  | { readonly type: "HEARTBEAT"; readonly revision: number; readonly serverTimeMs: number };
