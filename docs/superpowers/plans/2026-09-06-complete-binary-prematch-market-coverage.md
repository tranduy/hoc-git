# Complete Binary Prematch Market Coverage Implementation Plan

**Goal:** Hydrate every prematch market from all six football providers and compare every exactly equivalent, no-draw, no-push two-outcome market without silently dropping unknown provider markets.

**Architecture:** Introduce a canonical binary-market registry and a lossless provider observation boundary. Keep the existing three-second main feed for prices, add bounded authoritative prematch detail partitions, then allow only registry-proven identities through the exact matcher.

**Tech Stack:** TypeScript, Zod, Chrome MV3, Fastify, React, Vitest.

## Global constraints

- Read-only collection only; never click an odds selection or submit a wager.
- Preserve the user's existing dirty worktree and make no unrelated rewrites.
- Add a failing regression test before each production change.
- Any Chrome extension source change increments the manifest patch version.
- Half-unit Asian lines are comparison-eligible; integer and quarter lines are retained but cannot rank because they can push or partially push.
- Every raw market must end in one of three measured states: normalized, explicitly excluded with a stable reason, or retained as an unmapped native signature.

### Task 1: Canonical no-push registry and lossless observation contract

**Files:**
- Create: `packages/contracts/src/football-binary-market.ts`
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/adapters/src/football-market-policy.ts`
- Test: corresponding contract and adapter tests

- [ ] Add RED tests for statistic/period/domain/settlement identity and half-unit-only eligibility.
- [ ] Add an unmapped native market observation schema with bounded strings and stable exclusion reasons.
- [ ] Implement the registry for goal, corner, and card AH/total families already present in the contract.
- [ ] Make integer and quarter lines observable but comparison-ineligible.
- [ ] Run focused contract/adapter tests GREEN.

### Task 2: Exact matcher and UI fail-closed behavior

**Files:**
- Modify: `packages/core/src/mapping/market-mapper.ts`
- Modify: `apps/web/src/catalog/comparison.ts`
- Modify: `apps/web/src/watch/ranked-tickets.ts`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Test: corresponding core/web tests

- [ ] Add RED tests rejecting cross-statistic, cross-period, cross-line, reversed-orientation, cross-settlement, stale-generation, integer-line, and quarter-line pairs.
- [ ] Route matching and ranking through the canonical registry.
- [ ] Display separate event/market counts and English statistic-aware ticket labels.
- [ ] Add provider family/period/unmapped coverage counters.
- [ ] Run focused core/web tests GREEN.

### Task 3: APSPORT complete prematch detail catalog

**Files:**
- Modify: `apps/chrome-extension/src/apsport-catalog-refresh.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- Modify: `apps/api/src/providers/apsport/apsport-browser-manager.ts`
- Test: corresponding extension/API tests

- [ ] Capture sanitized fixtures containing all AP detail groups, including card/corner and unknown groups.
- [x] Add RED tests proving pagination/detail traversal and unknown-group retention.
- [x] Replace the supported-group discovery filter with lossless observation followed by registry mapping.
- [x] Make completed per-event detail authoritative; keep the hidden-detail sweep prematch-only while preserving valid live/inactive transitions.
- [x] Verify single-flight requests, minimum delay, backoff, cancellation, and no live detail sweep.

APSPORT live acceptance passed on 2026-09-07 at 15:56:28 UTC+7: 481/481 current prematch events, 38,678 native rows accounted for, 10,133 normalized markets and 20,266 quotes, with no missing identities and a fresh catalog. See [APSPORT report](../reports/2026-09-07-apsport-hidden-market-coverage.md). The captured-fixture checkbox remains open: live card groups were absent; card and unknown-group behavior is covered by synthetic tests, not misrepresented as live capture. This does not mark the other providers or the all-provider verification task complete.

### Task 4: SABA complete prematch pseudo-event/detail catalog

**Files:**
- Modify: `packages/adapters/src/saba/saba-football-normalizer.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- Modify: `apps/api/src/providers/saba/saba-football-push-browser-manager.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Test: corresponding adapter/API/extension tests

- [ ] Add fixtures for prematch base, corner, booking/card, and unsupported derivative events.
- [ ] Add RED tests for base-fixture linkage, full traversal, and unknown bet-type retention.
- [ ] Hydrate all prematch pseudo-events and map proven `1/3/7/8` families.
- [ ] Preserve unmatched native signatures and authoritative deletion.

### Task 5: BTI complete prematch detail catalog

**Files:**
- Modify: `apps/api/src/providers/bti/bti-direct-catalog.ts`
- Modify: `apps/api/src/providers/bti/bti-browser-manager.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Test: corresponding API/extension tests

- [ ] Add fixtures for all observed detail codes and localized market labels.
- [ ] Add RED tests proving traversal is not restricted to main AH/OU codes.
- [ ] Retain all native market observations, map proven corner/card groups, and partition by event.
- [ ] Verify bounded prematch refresh and authoritative market removal.

### Task 6: SBOBET and CMD complete prematch detail catalogs

**Files:**
- Modify: `apps/api/src/providers/sbobet/sbobet-direct-catalog.ts`
- Modify: `apps/api/src/chrome-bridge/sbobet-socketio-adapter.ts`
- Modify: `packages/adapters/src/cmd/cmd-normalizer.ts`
- Modify: `apps/api/src/providers/cmd/cmd-hidden-market-probe.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Test: corresponding tests

- [ ] Add RED tests for SBOBET corner/card pseudo-events surviving socket/direct merge.
- [ ] Replace blanket pseudo-event exclusion with exact virtual/derivative rejection.
- [ ] Add CMD tests for complete prematch hidden-control traversal and pseudo-event linkage.
- [ ] Retain unknown native signatures and prove authoritative deletion for both providers.

### Task 7: IM market-family discovery and complete prematch catalog

**Files:**
- Modify: `apps/api/src/providers/im/im-football-catalog-source.ts`
- Modify: `apps/api/src/providers/im/im-browser-manager.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Test: corresponding API/extension tests

- [ ] Add fixtures covering all observed `bti/gp/si` combinations and any category/detail endpoints.
- [ ] Add RED tests proving unsupported combinations are retained as signatures instead of disappearing.
- [ ] Map only structurally proven two-outcome families and keep the rest observable.
- [ ] Verify token/session recovery does not discard the last authoritative complete detail partition.

### Task 8: Full verification and live coverage audit

**Files:**
- Modify: `apps/chrome-extension/public/manifest.json`
- Create: `docs/superpowers/reports/2026-09-06-complete-binary-prematch-market-coverage.md`

- [ ] Run all package tests, typechecks, lint, and builds.
- [ ] Build the extension and record its version and artifact hash.
- [ ] Restart the local stack so build identity matches the new source.
- [ ] Reload the extension and collect fresh catalogs from all six providers.
- [ ] Report prematch event/market counts by provider, family, and period plus every unmapped signature.
- [ ] Verify sampled exact pairs against current provider detail prices and confirm stale/changed markets are removed.
- [ ] Do not claim completion unless all six sources pass the lossless accounting invariant.
