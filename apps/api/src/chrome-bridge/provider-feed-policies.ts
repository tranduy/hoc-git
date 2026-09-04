import type { FeedProvenance, ProviderFeedPolicy } from "./provider-feed-types.js";

function policy(expectedEvidenceCadenceMs: number, maxBaselineAgeMs: number,
  softRecoveryAfterMs: number, hardRecoveryAfterMs: number,
  authoritativeProvenance: readonly FeedProvenance[]): ProviderFeedPolicy {
  return { expectedEvidenceCadenceMs, catalogFreshnessMs: expectedEvidenceCadenceMs,
    maxBaselineAgeMs, softRecoveryAfterMs, hardRecoveryAfterMs,
    recoveryCooldownMs: 30_000, maxSemanticSilenceMs: SEMANTIC_SILENCE_LIMIT_MS,
    authoritativeProvenance: new Set(authoritativeProvenance) };
}

// Twice the contract, and only ever applied to a book that has fixtures in play.
// Measured 2026-09-01 while four books were healthy: CMD 4s, BTI 3s, IM 12s,
// SBOBET 15s since their last semantic change. APSPORT sat at 208s and SABA at
// 3,616s, both reporting LIVE. The gap between 15 and 208 is wide enough that
// this bound separates a book that has gone quiet from one that is simply
// between price moves.
const SEMANTIC_SILENCE_LIMIT_MS = 60_000;

/**
 * The operator contract, set 2026-08-31: realtime transports normally answer
 * within 30 seconds and start soft recovery when that window lapses. APSPORT's
 * authoritative roster is the measured exception below: its one-minute HTTP
 * generation needs an additional 30-second completion grace.
 *
 * Measured cadences on live tabs are all far inside it (CMD/SABA/BTI 2-5 s,
 * SBOBET sub-second once socket receipts fold into the HTTP baseline, IM 15 s
 * discovery, APSPORT ~6 s socket frames), so a lapse is a fault rather than a
 * quiet spell. Baseline leases stay provider-specific: a book that bootstraps
 * once per socket must not be forced to reconnect just to renew a lease, and
 * the hard stage - which reloads a tab - keeps its own slower windows.
 */
const REALTIME_CONTRACT_MS = 30_000;

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
// SABA currently falls back to a complete hidden-DOM sweep when Chrome attaches
// after its Socket.IO creation event. Measured live after full hidden-market
// expansion, the complete authoritative cadence reached p95=122.54 s. A 30 s
// lease made the UI discard a valid 190+ event catalog for most of every sweep
// and then escalated into restoration that cancelled the next sweep. Keep a
// bounded 27.46 s margin above the measured p95; transport recovery still runs
// independently inside the extension every 20 s.
const SABA_EXPECTED_EVIDENCE_CADENCE_MS = 150_000;
const SABA_MAX_BASELINE_AGE_MS = 3_600_000;
const SABA_SOFT_RECOVERY_AFTER_MS = SABA_EXPECTED_EVIDENCE_CADENCE_MS;
const SABA_HARD_RECOVERY_AFTER_MS = 2 * SABA_EXPECTED_EVIDENCE_CADENCE_MS;
// APSPORT renews its authenticated API generation once per minute. A measured
// roster request can take about eight seconds before the replacement baseline
// lands, so the accepted evidence/freshness budget includes a 30-second grace.
// Valid duplicate `eu` events prove transport liveness without publishing a
// semantic catalog revision, while changed events remain normal WS deltas.
//
// The complete refresh does not finish with the roster: it walks every event
// detail sequentially and deliberately waits 500 ms between requests. With the
// 212-event production roster observed on 2026-09-02, delay alone is 106 s;
// request latency plus the next 25 s scheduler tick can exceed the former 120 s
// lease even while socket evidence remains fresh. Four roster intervals bound
// that healthy sweep without weakening the independent 90 s evidence check.
const APSPORT_API_REFRESH_INTERVAL_MS = 60_000;
const APSPORT_ROSTER_GRACE_MS = 30_000;
const APSPORT_EXPECTED_EVIDENCE_CADENCE_MS =
  APSPORT_API_REFRESH_INTERVAL_MS + APSPORT_ROSTER_GRACE_MS;
const APSPORT_MAX_BASELINE_AGE_MS = 4 * APSPORT_API_REFRESH_INTERVAL_MS;
// Entering SOFT_RECOVERY makes the catalog unavailable to the UI, so it must
// not happen before the same evidence-cadence deadline used by read(). Hard
// recovery still waits for the complete baseline lease.
const APSPORT_SOFT_RECOVERY_AFTER_MS = APSPORT_EXPECTED_EVIDENCE_CADENCE_MS;
const APSPORT_HARD_RECOVERY_AFTER_MS = APSPORT_MAX_BASELINE_AGE_MS;

export const providerFeedPolicies = new Map<string, ProviderFeedPolicy>([
  ["catalog-source:CMD:FOOTBALL", policy(REALTIME_CONTRACT_MS, CMD_MAX_BASELINE_AGE_MS,
    REALTIME_CONTRACT_MS, 60_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:IM:FOOTBALL", policy(REALTIME_CONTRACT_MS, IM_MAX_BASELINE_AGE_MS,
    REALTIME_CONTRACT_MS, 60_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:SABA:FOOTBALL", {
    ...policy(SABA_EXPECTED_EVIDENCE_CADENCE_MS, SABA_MAX_BASELINE_AGE_MS,
    // Measured 2026-08-26: removing DOM_FALLBACK here is correct per spec 4 but
    // regressed SABA from 90 quote changes/60s to 0, because its socket adapter
    // currently decodes only 16 of 745 frames. DOM stays authoritative until
    // that decoder covers the feed; the fault is in the adapter, not the policy.
      SABA_SOFT_RECOVERY_AFTER_MS, SABA_HARD_RECOVERY_AFTER_MS, ["WS", "DOM_FALLBACK"]),
    // DOM fallback quote changes arrive with the same complete sweep. Applying
    // the generic 60 s semantic timer to this lane would still demote it halfway
    // through a normal healthy generation even after the evidence lease above.
    maxSemanticSilenceMs: SABA_EXPECTED_EVIDENCE_CADENCE_MS
  }],
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
  // Measured 2026-08-31 after socket receipts began folding into the HTTP
  // baseline: catalog age holds at 0-1 s with 300-900 quote changes per minute,
  // so the old 60 s evidence expectation was covering for a broken lane rather
  // than a slow provider. The hard stage still reloads no sooner than 1.5x the
  // baseline lease so a reload can actually converge.
  ["catalog-source:SBOBET:FOOTBALL", policy(REALTIME_CONTRACT_MS, 120_000,
    REALTIME_CONTRACT_MS, 180_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:APSPORT:FOOTBALL", {
    ...policy(APSPORT_EXPECTED_EVIDENCE_CADENCE_MS, APSPORT_MAX_BASELINE_AGE_MS,
      APSPORT_SOFT_RECOVERY_AFTER_MS, APSPORT_HARD_RECOVERY_AFTER_MS,
      ["WS", "AUTHENTICATED_HTTP"]),
    // A complete roster is itself the semantic renewal for AP. Do not demote
    // it at the generic 60 s quiet-price threshold while that 60-180 s roster
    // operation is still healthy; the independent 90 s evidence bound still
    // catches a source that has stopped yielding decodable provider data.
    maxSemanticSilenceMs: APSPORT_MAX_BASELINE_AGE_MS
  }],
  ["catalog-source:BTI:FOOTBALL", policy(REALTIME_CONTRACT_MS, BTI_MAX_BASELINE_AGE_MS,
    REALTIME_CONTRACT_MS, 60_000, ["AUTHENTICATED_HTTP"])]
]);
