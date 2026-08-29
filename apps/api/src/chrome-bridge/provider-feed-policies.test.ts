import { describe, expect, it } from "vitest";
import { providerFeedPolicies } from "./provider-feed-policies.js";

const before = {
  CMD: [20_000, 20_000], IM: [20_000, 25_000], SABA: [10_000, 60_000],
  SBOBET: [10_000, 60_000], APSPORT: [5_000, 30_000], BTI: [10_000, 30_000]
} as const;

const effectiveCadenceMs = { CMD: 15_000, IM: 15_000, BTI: 15_000 } as const;

describe("provider feed policies measured 2026-08-25", () => {
  it("uses three effective cadence intervals, two evidence windows, and a three-minute baseline cap", () => {
    for (const [provider, cadenceMs] of Object.entries(effectiveCadenceMs)) {
      const policy = providerFeedPolicies.get(`catalog-source:${provider}:FOOTBALL`)!;
      expect(policy.expectedEvidenceCadenceMs).toBeGreaterThanOrEqual(3 * cadenceMs);
      expect(policy.maxBaselineAgeMs).toBeGreaterThanOrEqual(2 * policy.expectedEvidenceCadenceMs);
      expect(policy.maxBaselineAgeMs).toBeLessThanOrEqual(180_000);
    }
  });

  it("prints the measured before/after table for all six providers", () => {
    const table = Object.entries(before).map(([provider, previous]) => {
      const policy = providerFeedPolicies.get(`catalog-source:${provider}:FOOTBALL`)!;
      return {
        provider,
        beforeExpectedMs: previous[0], beforeBaselineMs: previous[1],
        afterExpectedMs: policy.expectedEvidenceCadenceMs, afterBaselineMs: policy.maxBaselineAgeMs
      };
    });
    expect(table).toEqual([
      { provider: "CMD", beforeExpectedMs: 20_000, beforeBaselineMs: 20_000,
        afterExpectedMs: 45_000, afterBaselineMs: 90_000 },
      { provider: "IM", beforeExpectedMs: 20_000, beforeBaselineMs: 25_000,
        afterExpectedMs: 45_000, afterBaselineMs: 90_000 },
      { provider: "SABA", beforeExpectedMs: 10_000, beforeBaselineMs: 60_000,
        afterExpectedMs: 75_000, afterBaselineMs: 3_600_000 },
      { provider: "SBOBET", beforeExpectedMs: 10_000, beforeBaselineMs: 60_000,
        afterExpectedMs: 60_000, afterBaselineMs: 120_000 },
      { provider: "APSPORT", beforeExpectedMs: 5_000, beforeBaselineMs: 30_000,
        afterExpectedMs: 90_000, afterBaselineMs: 120_000 },
      { provider: "BTI", beforeExpectedMs: 10_000, beforeBaselineMs: 30_000,
        afterExpectedMs: 45_000, afterBaselineMs: 90_000 }
    ]);
    console.log("B4_POLICY_TABLE", JSON.stringify(table));
  });

  it("keeps APSPORT available while the next one-minute roster is in flight", () => {
    const policy = providerFeedPolicies.get("catalog-source:APSPORT:FOOTBALL")!;
    expect(policy.expectedEvidenceCadenceMs).toBe(90_000);
    expect(policy.catalogFreshnessMs).toBe(90_000);
    expect(policy.softRecoveryAfterMs).toBe(90_000);
    expect(policy.hardRecoveryAfterMs).toBe(120_000);
  });

  it("never lets a tab-reloading hard stage fire while a baseline is still valid", () => {
    // Only the WebSocket providers reload their tab on the hard stage (see
    // WEBSOCKET_PROVIDERS in automatic-source-recovery). That reload destroys
    // the in-flight stream and restarts an unfinished DOM proof sweep, which is
    // how APSPORT stayed stuck at five events. CMD/IM/BTI hard stages do not
    // touch the tab, so a tighter hard window is safe for them.
    for (const provider of ["SABA", "SBOBET", "APSPORT"]) {
      const policy = providerFeedPolicies.get(`catalog-source:${provider}:FOOTBALL`)!;
      expect(policy.hardRecoveryAfterMs).toBeGreaterThan(policy.expectedEvidenceCadenceMs);
    }
    // A reload must also get at least the baseline lease to converge, or the
    // next reload lands before the reloaded page has produced a baseline and
    // the source can never settle. SABA is exempt: its lease is a one-hour
    // bootstrap window, not a convergence budget.
    for (const provider of ["SBOBET", "APSPORT"]) {
      const policy = providerFeedPolicies.get(`catalog-source:${provider}:FOOTBALL`)!;
      expect(policy.hardRecoveryAfterMs).toBeGreaterThanOrEqual(policy.maxBaselineAgeMs);
    }
  });

  it("never lets DOM fallback hold a feed live on its own", () => {
    // Spec section 4 ranks DOM below the provider's own transport: it is a
    // display fallback, not evidence. Treating it as authoritative kept SABA
    // reporting LIVE while its socket was dead, so recovery never ran and 95
    // of 100 events arrived from the page with no kickoff and a live label the
    // page applies to its whole live-betting section.
    // SABA is the one documented exception while its socket adapter decodes
    // only a fraction of the feed; removing it there measurably regressed the
    // book to zero quote changes. Every other provider must stay on transport.
    for (const [accountId, policy] of providerFeedPolicies) {
      if (accountId === "catalog-source:SABA:FOOTBALL") continue;
      expect(policy.authoritativeProvenance.has("DOM_FALLBACK"),
        `${accountId} must not treat DOM_FALLBACK as authoritative`).toBe(false);
    }
  });

  it("keeps each public catalog fresh through its accepted evidence cadence", () => {
    for (const policy of providerFeedPolicies.values()) {
      expect((policy as typeof policy & { catalogFreshnessMs?: number }).catalogFreshnessMs)
        .toBeGreaterThanOrEqual(policy.expectedEvidenceCadenceMs);
    }
  });
});
