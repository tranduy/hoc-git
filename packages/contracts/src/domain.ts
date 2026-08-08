export type Category = "FOOTBALL" | "LOL";

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

export type OddsFormat = "DECIMAL" | "HK" | "AMERICAN";

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

export interface ProviderEvent {
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
}

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
  readonly minStake: string;
  readonly maxStake: string;
  readonly payout: string;
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
