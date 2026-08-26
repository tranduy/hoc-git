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
// APSPORT's authoritative floor is not its ~2.3 frame/s socket but its adapter's
// AUTHORITATIVE_BASELINE_REFRESH_MS = 20 s baseline reissue, because a delta is
// rejected once the baseline expires. The old 30 s cap was 1.5x that reissue, so
// ordinary jitter expired the baseline, which rejected deltas, which aged the
// authority, which reloaded the tab and restarted the DOM proof sweep before it
// could finish — the measured 5-event catalog. Policy is 3 x 20 s evidence and
// 2 x that baseline, matching the CMD/IM/BTI convention.
const APSPORT_BASELINE_REISSUE_MS = 20_000;
const APSPORT_EXPECTED_EVIDENCE_CADENCE_MS = 3 * APSPORT_BASELINE_REISSUE_MS;
const APSPORT_MAX_BASELINE_AGE_MS = 2 * APSPORT_EXPECTED_EVIDENCE_CADENCE_MS;
// Soft recovery only asks for a fresh lobby snapshot, which is how the DOM proof
// sweep is refreshed, so it stays frequent. Hard recovery reloads the provider
// tab and destroys the in-flight stream, so it must not fire while a healthy
// baseline is merely late.
const APSPORT_SOFT_RECOVERY_AFTER_MS = 20_000;
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
  // the 60 s baseline lease so an attempt can actually converge.
  ["catalog-source:SBOBET:FOOTBALL", policy(10_000, 60_000, 15_000, 90_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:APSPORT:FOOTBALL", policy(APSPORT_EXPECTED_EVIDENCE_CADENCE_MS, APSPORT_MAX_BASELINE_AGE_MS,
    APSPORT_SOFT_RECOVERY_AFTER_MS, APSPORT_HARD_RECOVERY_AFTER_MS, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:BTI:FOOTBALL", policy(BTI_EXPECTED_EVIDENCE_CADENCE_MS, BTI_MAX_BASELINE_AGE_MS,
    15_000, 30_000, ["AUTHENTICATED_HTTP"])]
]);
