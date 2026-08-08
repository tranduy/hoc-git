export { Decimal, toDecimal } from "./odds/convert.js";
export type { DecimalValue } from "./odds/convert.js";
export { convertStake, effectiveDecimal } from "./odds/effective.js";
export type { FeeModel, FxModel } from "./odds/effective.js";
export { CanonicalIdentityError, buildFootballEventKey, buildLolEventKey } from "./identity/canonical-key.js";
export type { FootballIdentity, LolIdentity } from "./identity/canonical-key.js";
export { normalizeName, resolveAlias } from "./identity/normalize-name.js";
export type { AliasRegistry, AliasResolution, AliasResolutionSource } from "./identity/normalize-name.js";
