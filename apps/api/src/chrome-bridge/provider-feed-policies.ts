import type { FeedProvenance, ProviderFeedPolicy } from "./provider-feed-types.js";

function policy(expectedEvidenceCadenceMs: number, maxBaselineAgeMs: number,
  softRecoveryAfterMs: number, hardRecoveryAfterMs: number,
  authoritativeProvenance: readonly FeedProvenance[]): ProviderFeedPolicy {
  return { expectedEvidenceCadenceMs, maxBaselineAgeMs, softRecoveryAfterMs, hardRecoveryAfterMs,
    recoveryCooldownMs: 30_000, authoritativeProvenance: new Set(authoritativeProvenance) };
}

export const providerFeedPolicies = new Map<string, ProviderFeedPolicy>([
  ["catalog-source:CMD:FOOTBALL", policy(3_000, 20_000, 12_000, 30_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:IM:FOOTBALL", policy(5_000, 25_000, 20_000, 45_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:SABA:FOOTBALL", policy(10_000, 60_000, 20_000, 45_000, ["WS"])],
  ["catalog-source:SBOBET:FOOTBALL", policy(10_000, 60_000, 15_000, 30_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:APSPORT:FOOTBALL", policy(5_000, 30_000, 15_000, 30_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:BTI:FOOTBALL", policy(5_000, 30_000, 15_000, 30_000, ["AUTHENTICATED_HTTP"])]
]);
