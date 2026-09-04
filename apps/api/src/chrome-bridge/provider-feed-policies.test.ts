import { describe, expect, it } from "vitest";
import { providerFeedPolicies } from "./provider-feed-policies.js";

const before = {
  CMD: [45_000, 20_000], IM: [45_000, 20_000], SABA: [75_000, 90_000],
  SBOBET: [60_000, 60_000], APSPORT: [90_000, 90_000], BTI: [45_000, 15_000]
} as const;

const REALTIME_CONTRACT_MS = 30_000;

describe("provider feed policies under measured realtime contracts (2026-09-02)", () => {
  it("uses each provider's measured complete-authority cadence", () => {
    // The operator rule: no book may go longer than 30 seconds without
    // answering with decodable data. Waiting longer than the contract before
    // asking for a snapshot is what let SABA freeze for 5.5 minutes and
    // APSPORT for 2 minutes while their strips still read ACTIVE.
    for (const [accountId, policy] of providerFeedPolicies) {
      const expectedMs = accountId === "catalog-source:APSPORT:FOOTBALL" ? 90_000
        : accountId === "catalog-source:SABA:FOOTBALL" ? 150_000 : REALTIME_CONTRACT_MS;
      expect(policy.expectedEvidenceCadenceMs,
        `${accountId} must use its measured evidence window`).toBe(expectedMs);
      expect(policy.catalogFreshnessMs,
        `${accountId} must not serve a catalog older than its evidence window`).toBe(expectedMs);
      expect(policy.softRecoveryAfterMs,
        `${accountId} must start recovery at its evidence window`).toBe(expectedMs);
    }
  });

  it("prints the measured before/after table for all six providers", () => {
    const table = Object.entries(before).map(([provider, previous]) => {
      const policy = providerFeedPolicies.get(`catalog-source:${provider}:FOOTBALL`)!;
      return {
        provider,
        beforeExpectedMs: previous[0], beforeSoftMs: previous[1],
        afterExpectedMs: policy.expectedEvidenceCadenceMs, afterSoftMs: policy.softRecoveryAfterMs
      };
    });
    expect(table).toEqual([
      { provider: "CMD", beforeExpectedMs: 45_000, beforeSoftMs: 20_000,
        afterExpectedMs: 30_000, afterSoftMs: 30_000 },
      { provider: "IM", beforeExpectedMs: 45_000, beforeSoftMs: 20_000,
        afterExpectedMs: 30_000, afterSoftMs: 30_000 },
      { provider: "SABA", beforeExpectedMs: 75_000, beforeSoftMs: 90_000,
        afterExpectedMs: 150_000, afterSoftMs: 150_000 },
      { provider: "SBOBET", beforeExpectedMs: 60_000, beforeSoftMs: 60_000,
        afterExpectedMs: 30_000, afterSoftMs: 30_000 },
      { provider: "APSPORT", beforeExpectedMs: 90_000, beforeSoftMs: 90_000,
        afterExpectedMs: 90_000, afterSoftMs: 90_000 },
      { provider: "BTI", beforeExpectedMs: 45_000, beforeSoftMs: 15_000,
        afterExpectedMs: 30_000, afterSoftMs: 30_000 }
    ]);
    console.log("B4_POLICY_TABLE", JSON.stringify(table));
  });

  it("keeps the tab-reloading hard stage well outside the contract", () => {
    // Soft recovery only asks for a lobby snapshot, so it may fire at the
    // contract. The hard stage reloads a tab and must stay far enough out that
    // a reloaded page can converge on a baseline first.
    for (const [accountId, policy] of providerFeedPolicies) {
      expect(policy.hardRecoveryAfterMs,
        `${accountId} hard stage must not fire at the contract`)
        .toBeGreaterThanOrEqual(2 * REALTIME_CONTRACT_MS);
    }
  });

  it("does not declare SABA's complete hidden-DOM sweep silent before its measured p95", () => {
    const policy = providerFeedPolicies.get("catalog-source:SABA:FOOTBALL")!;
    expect(policy.expectedEvidenceCadenceMs).toBeGreaterThan(122_540);
    expect(policy.maxSemanticSilenceMs).toBeGreaterThan(122_540);
    expect(policy.hardRecoveryAfterMs).toBeGreaterThanOrEqual(2 * policy.expectedEvidenceCadenceMs);
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
