import type { FeedProvenance, ProviderFeedPolicy } from "./provider-feed-types.js";

function policy(expectedEvidenceCadenceMs: number, maxBaselineAgeMs: number,
  softRecoveryAfterMs: number, hardRecoveryAfterMs: number,
  authoritativeProvenance: readonly FeedProvenance[]): ProviderFeedPolicy {
  return { expectedEvidenceCadenceMs, catalogFreshnessMs: expectedEvidenceCadenceMs,
    maxBaselineAgeMs, softRecoveryAfterMs, hardRecoveryAfterMs,
    recoveryCooldownMs: 30_000, authoritativeProvenance: new Set(authoritativeProvenance) };
}

// Measured 2026-08-25: CMD's effective catalog cadence is the extension's 15 s refresh, used instead of
// the page's 60 s DataOdds gap because extension refreshes are the runtime evidence source; policy is 3 × 15 s.
const CMD_EXPECTED_EVIDENCE_CADENCE_MS = 45_000;
// Measured 2026-08-25: CMD baseline age is 2 × its effective 45 s evidence cadence policy.
const CMD_MAX_BASELINE_AGE_MS = 90_000;
// Measured 2026-08-25: IM's effective catalog cadence is the extension's 15 s refresh because the page does
// not naturally poll after bootstrap; policy is 3 × 15 s.
const IM_EXPECTED_EVIDENCE_CADENCE_MS = 45_000;
// Measured 2026-08-25: IM baseline age is 2 × its effective 45 s evidence cadence policy.
const IM_MAX_BASELINE_AGE_MS = 90_000;
// Measured 2026-08-25: BTI's effective football-catalog polling cadence is 15 s; the isolated 30 s gap is
// jitter rather than the scheduling cadence, so the 15 s poll interval is the policy base; policy is 3 × 15 s.
const BTI_EXPECTED_EVIDENCE_CADENCE_MS = 45_000;
// Measured 2026-08-25: BTI baseline age is 2 × its effective 45 s evidence cadence policy.
const BTI_MAX_BASELINE_AGE_MS = 90_000;
// Measured SABA evidence p95 reaches 69.6 s. Its Socket.IO feed sends one complete
// bootstrap baseline followed by continuous deltas, so the baseline lease must
// cover the 30-minute soak while evidence recovery remains bounded above p95.
const SABA_EXPECTED_EVIDENCE_CADENCE_MS = 75_000;
const SABA_MAX_BASELINE_AGE_MS = 3_600_000;
const SABA_SOFT_RECOVERY_AFTER_MS = 90_000;
const SABA_HARD_RECOVERY_AFTER_MS = 180_000;
// APSPORT renews its authenticated API generation once per minute. A measured
// roster request can take about eight seconds before the replacement baseline
// lands, so the accepted evidence/freshness budget includes a 30-second grace.
// Valid duplicate `eu` events prove transport liveness without publishing a
// semantic catalog revision, while changed events remain normal WS deltas. The
// baseline lease still covers two periodic API generations.
const APSPORT_API_REFRESH_INTERVAL_MS = 60_000;
const APSPORT_ROSTER_GRACE_MS = 30_000;
const APSPORT_EXPECTED_EVIDENCE_CADENCE_MS =
  APSPORT_API_REFRESH_INTERVAL_MS + APSPORT_ROSTER_GRACE_MS;
const APSPORT_MAX_BASELINE_AGE_MS = 2 * APSPORT_API_REFRESH_INTERVAL_MS;
// Entering SOFT_RECOVERY makes the catalog unavailable to the UI, so it must
// not happen before the same evidence-cadence deadline used by read(). Hard
// recovery still waits for the complete baseline lease.
const APSPORT_SOFT_RECOVERY_AFTER_MS = APSPORT_EXPECTED_EVIDENCE_CADENCE_MS;
const APSPORT_HARD_RECOVERY_AFTER_MS = APSPORT_MAX_BASELINE_AGE_MS;

export const providerFeedPolicies = new Map<string, ProviderFeedPolicy>([
  ["catalog-source:CMD:FOOTBALL", policy(CMD_EXPECTED_EVIDENCE_CADENCE_MS, CMD_MAX_BASELINE_AGE_MS,
    20_000, 30_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:IM:FOOTBALL", policy(IM_EXPECTED_EVIDENCE_CADENCE_MS, IM_MAX_BASELINE_AGE_MS,
    20_000, 45_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:SABA:FOOTBALL", policy(SABA_EXPECTED_EVIDENCE_CADENCE_MS, SABA_MAX_BASELINE_AGE_MS,
    // Measured 2026-08-26: removing DOM_FALLBACK here is correct per spec 4 but
    // regressed SABA from 90 quote changes/60s to 0, because its socket adapter
    // currently decodes only 16 of 745 frames. DOM stays authoritative until
    // that decoder covers the feed; the fault is in the adapter, not the policy.
    SABA_SOFT_RECOVERY_AFTER_MS, SABA_HARD_RECOVERY_AFTER_MS, ["WS", "DOM_FALLBACK"])],
  // SBOBET's hard stage reloads the tab, and its STOMP/SockJS page must reload,
  // re-authenticate and re-subscribe before any baseline can land. A 30 s hard
  // window fired again before that finished, which is why sourceGeneration
  // climbed past 26 without one accepted baseline. Reload no sooner than 1.5x
  // the baseline lease so an attempt can actually converge.
  //
  // Measured 2026-08-30 on a live tab: this deployment's sportsbook socket
  // sends no SockJS heartbeats at all, and real odds traffic pauses for up to
  // ~50 s (observed evidence cadence p50 201 ms, p95 51 s) while quote changes
  // keep flowing in bursts (292/60 s). A 10 s evidence expectation therefore
  // dropped a healthy feed out of LIVE on every natural pause and the catalog
  // showed "no data" most of the time. Expect evidence once a minute, lease
  // the baseline for two, and reload only after three.
  ["catalog-source:SBOBET:FOOTBALL", policy(60_000, 120_000, 60_000, 180_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:APSPORT:FOOTBALL", policy(APSPORT_EXPECTED_EVIDENCE_CADENCE_MS, APSPORT_MAX_BASELINE_AGE_MS,
    APSPORT_SOFT_RECOVERY_AFTER_MS, APSPORT_HARD_RECOVERY_AFTER_MS, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:BTI:FOOTBALL", policy(BTI_EXPECTED_EVIDENCE_CADENCE_MS, BTI_MAX_BASELINE_AGE_MS,
    15_000, 30_000, ["AUTHENTICATED_HTTP"])]
]);
