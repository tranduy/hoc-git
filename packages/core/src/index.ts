export { Decimal, toDecimal } from "./odds/convert.js";
export type { DecimalValue } from "./odds/convert.js";
export { convertStake, effectiveDecimal } from "./odds/effective.js";
export type { FeeModel, FxModel } from "./odds/effective.js";
export { CanonicalIdentityError, buildFootballEventKey, buildLolEventKey } from "./identity/canonical-key.js";
export type { FootballIdentity, LolIdentity } from "./identity/canonical-key.js";
export {
  AliasRegistryError,
  normalizeName,
  resolveAlias,
  resolveAliasForCategory
} from "./identity/normalize-name.js";
export type {
  AliasRegistry,
  AliasResolution,
  AliasResolutionSource,
  VersionedAliasRegistry,
  VersionedAliasResolution
} from "./identity/normalize-name.js";
export { mapEvents } from "./mapping/event-mapper.js";
export type {
  EventMappingResult,
  EventSource,
  FootballEventScope,
  FootballLiveState,
  LolEventScope,
  LolLiveState,
  MappingPolicy,
  NormalizedEvent,
  NormalizedFootballEvent,
  NormalizedLolEvent,
  ParticipantOrientation
} from "./mapping/event-mapper.js";
export { mapMarkets } from "./mapping/market-mapper.js";
export type {
  MarketMappingResult,
  NormalizedMarket,
  NormalizedSelection,
  SelectionMapping
} from "./mapping/market-mapper.js";
export {
  ArbitrageCalculationError,
  calculateArbitrage
} from "./arbitrage/calculate.js";
export type { ArbitrageResult } from "./arbitrage/calculate.js";
export {
  optimizeStakes,
  StakeOptimizationValidationError,
  StakeSearchSpaceError
} from "./arbitrage/optimize-stakes.js";
export type {
  OptimizeStakesInput,
  StakeConstraint,
  StakePlan
} from "./arbitrage/optimize-stakes.js";
