# Six-Provider Realtime Feed Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CMD, IM, SABA, SBOBET, APSPORT, and BTI publish continuously from provider-authoritative evidence, recover one failed source without disturbing the other five, and fail closed whenever current prices cannot be proven.

**Architecture:** Keep the Chrome bridge and provider adapters, but route decoded evidence through one `ProviderFeedController` per account. The controller separates tab reachability, provider transport, complete baselines, deltas, semantic changes, and recovery stages; provider-specific collectors supply atomic evidence and a bounded recovery actor escalates from same-tab repair to targeted tab replacement.

**Tech Stack:** TypeScript 5.9, Node.js, Fastify, Chrome MV3/CDP, React 19, Zod, Vitest, Playwright, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-23-six-provider-realtime-feed-recovery-design.md`

## Global Constraints

- Execute in an isolated worktree created through `superpowers:using-git-worktrees`; the active dirty runtime worktree must remain available for comparison and must not be reset or bulk-committed.
- Start from commit `bde8236`. Inspect the active worktree diff for every touched file and port only behavior covered by the current task's failing tests.
- A Chrome tab heartbeat, bridge sequence, restored disk catalog, retained socket replay, or identical viewport DOM capture must never make a feed `LIVE`.
- `LIVE` requires a complete current-epoch baseline plus provider-authoritative continuity inside both `expectedEvidenceCadenceMs` and `maxBaselineAgeMs`.
- Recovery is per provider, single-flight, bounded, and must never reset a healthy provider tab.
- Stale or invalidated catalogs may be displayed diagnostically but may not enter comparison, alerts, ranking, preflight, or ticket construction.
- Do not log cookies, credentials, signed URLs, Fabet launch tokens, authorization material, or raw secret-bearing bodies.
- All six providers must obtain a post-start authoritative baseline before the six-of-six gate can pass.
- Live price transitions must normally reach API and UI within three seconds and never exceed five seconds under an accepted fallback cadence.
- SABA must recover a new authoritative baseline within 60 seconds after a recoverable worker/tab fault.
- SBOBET must recreate KSPORT and commit current `live + today` baselines within 90 seconds when valid authentication/launch is available.
- Final acceptance requires a 30-minute six-provider soak plus API restart, extension-worker restart, source-tab close, and socket-close fault injection.

## File Structure

New focused units:

- `apps/api/src/chrome-bridge/provider-feed-types.ts`: internal evidence, policy, snapshot, and recovery request types.
- `apps/api/src/chrome-bridge/provider-feed-policies.ts`: exact cadence/baseline/recovery policy for six accounts.
- `apps/api/src/chrome-bridge/provider-feed-controller.ts`: one-account state machine and publication eligibility.
- `apps/api/src/chrome-bridge/provider-feed-registry.ts`: owns six controllers, lookup, sweeping, and subscriptions.
- `apps/chrome-extension/src/provider-work-scheduler.ts`: independent bounded lanes keyed by provider source.
- `apps/api/src/chrome-bridge/cmd-http-adapter.ts`: CMD provider-network baseline/delta decoding after a sanitized real response is characterized.
- `apps/api/src/routes/provider-feed-journal.ts`: bounded redacted feed/recovery journal.
- `scripts/six-provider-realtime-soak.mjs`: deterministic one-second live sampler and acceptance report.

Existing integration points:

- `apps/api/src/chrome-bridge/adapter.ts`: adapters annotate decoded catalog evidence.
- `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`: route envelopes and candidates into feed controllers; remove independent freshness truth.
- `apps/api/src/chrome-bridge/automatic-source-recovery.ts`: soft/hard targeted recovery actor.
- `apps/chrome-extension/src/network-observer.ts`: provider capture, source epochs, orphan recovery, and provider lanes.
- `apps/chrome-extension/src/local-bridge.ts`: atomic resync after queue coalescing/gaps.
- `packages/contracts/src/domain.ts` and `packages/contracts/src/schemas.ts`: public feed status and realtime messages.
- `apps/api/src/server.ts`, `apps/api/src/routes/health.ts`, and `apps/api/src/realtime/opportunity-ws.ts`: lifecycle, unified health, and feed-state streaming.
- `apps/web/src/pages/live-catalog-page.tsx` and comparison/watch components: fail-closed UI behavior.

---

### Task 1: Provider Feed State Machine

**Files:**

- Create: `apps/api/src/chrome-bridge/provider-feed-types.ts`
- Create: `apps/api/src/chrome-bridge/provider-feed-policies.ts`
- Create: `apps/api/src/chrome-bridge/provider-feed-controller.ts`
- Create: `apps/api/src/chrome-bridge/provider-feed-controller.test.ts`

**Interfaces:**

- Consumes: `ObservedProviderCatalog` from `apps/api/src/providers/cmd/cmd-observed-catalog.ts`.
- Produces:

```ts
export type ProviderFeedState =
  | "STARTING" | "SYNCING" | "LIVE" | "STALLED"
  | "SOFT_RECOVERY" | "HARD_RECOVERY" | "ACTION_REQUIRED";

export type FeedProvenance = "WS" | "AUTHENTICATED_HTTP" | "DOM_FALLBACK" | "RESTORED";

export type ProviderFeedEvidence =
  | { kind: "TAB_REACHABLE"; accountId: string; sourceId: string; sourceEpoch: string; atMs: number }
  | { kind: "TRANSPORT"; accountId: string; sourceId: string; sourceEpoch: string; atMs: number;
      provenance: Exclude<FeedProvenance, "DOM_FALLBACK" | "RESTORED">; providerSequence?: number }
  | { kind: "CATALOG"; accountId: string; sourceId: string; sourceEpoch: string; atMs: number;
      generation: string; mode: "BASELINE" | "DELTA"; provenance: FeedProvenance;
      providerTimestampMs: number | null; catalog: ObservedProviderCatalog }
  | { kind: "INVALIDATE"; accountId: string; sourceId: string; sourceEpoch: string; atMs: number;
      reason: "SOURCE_REPLACED" | "PROVIDER_STREAM_CLOSED" | "PROVIDER_STREAM_GAP" | "SCHEMA_CHANGED" };

export interface ProviderFeedPolicy {
  readonly expectedEvidenceCadenceMs: number;
  readonly maxBaselineAgeMs: number;
  readonly softRecoveryAfterMs: number;
  readonly hardRecoveryAfterMs: number;
  readonly recoveryCooldownMs: number;
  readonly authoritativeProvenance: ReadonlySet<FeedProvenance>;
}

export interface FeedDecision {
  readonly accepted: boolean;
  readonly publish: { catalog: ObservedProviderCatalog; snapshotState: "FRESH" | "STALE" } | null;
  readonly stateChanged: boolean;
}
```

- `ProviderFeedController.accept(evidence: ProviderFeedEvidence): FeedDecision`
- `ProviderFeedController.restore(catalog: ObservedProviderCatalog): FeedDecision`
- `ProviderFeedController.sweep(nowMs?: number): ProviderRecoveryRequest | null`
- `ProviderFeedController.read(): ObservedProviderCatalog`
- `ProviderFeedController.snapshot(): ProviderFeedSnapshot`

- [ ] **Step 1: Write failing tests for false liveness and restored state**

```ts
it("does not promote restored data or tab heartbeats to LIVE", () => {
  const controller = controllerFor("catalog-source:SABA:FOOTBALL", 1_000);
  controller.restore(catalog({ observedAtMs: 100 }));
  controller.accept({ kind: "TAB_REACHABLE", accountId: SABA, sourceId: "chrome:SABA:7",
    sourceEpoch: "worker-a:0", atMs: 1_000 });
  expect(controller.snapshot()).toMatchObject({ state: "SYNCING", lastCompleteBaselineAtMs: null });
  expect(() => controller.read()).toThrow("PROVIDER_FEED_NOT_LIVE");
});
```

- [ ] **Step 2: Run the new controller test and verify it fails because the files do not exist**

Run: `npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/provider-feed-controller.test.ts`

Expected: FAIL with an import/module-not-found error.

- [ ] **Step 3: Implement the types, exact six-account policies, and STARTING/SYNCING behavior**

Use explicit policy values in `provider-feed-policies.ts`; do not hide them in `chrome-catalog-data-plane.ts`. Initial values:

```ts
export const providerFeedPolicies = new Map<string, ProviderFeedPolicy>([
  ["catalog-source:CMD:FOOTBALL", policy(3_000, 20_000, 12_000, 30_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:IM:FOOTBALL", policy(5_000, 25_000, 20_000, 45_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:SABA:FOOTBALL", policy(10_000, 60_000, 20_000, 45_000, ["WS"])],
  ["catalog-source:SBOBET:FOOTBALL", policy(10_000, 60_000, 15_000, 30_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:APSPORT:FOOTBALL", policy(5_000, 30_000, 15_000, 30_000, ["WS", "AUTHENTICATED_HTTP"])],
  ["catalog-source:BTI:FOOTBALL", policy(5_000, 30_000, 15_000, 30_000, ["AUTHENTICATED_HTTP"])]
]);
```

`policy()` also sets `recoveryCooldownMs: 30_000`. DOM fallback is never authoritative continuity; it can produce display-only candidates.

- [ ] **Step 4: Add failing tests for current-epoch baseline, quiet-market transport, epoch replacement, gap invalidation, and recovery thresholds**

```ts
it("keeps a current baseline live on provider transport but not beyond max baseline age", () => {
  const controller = controllerFor(SABA, 1_000);
  expect(controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1")).publish?.snapshotState).toBe("FRESH");
  clock.set(9_000);
  controller.accept(wsTransport(9_000, "worker-a:0"));
  expect(controller.snapshot().state).toBe("LIVE");
  clock.set(61_001);
  expect(controller.sweep()).toMatchObject({ accountId: SABA, stage: "SOFT" });
  expect(controller.snapshot().state).toBe("SOFT_RECOVERY");
});

it("rejects late evidence from a retired source epoch", () => {
  controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
  controller.accept(invalidate(2_000, "worker-a:0", "SOURCE_REPLACED"));
  expect(controller.accept(wsDelta(2_100, "worker-a:0"))).toMatchObject({ accepted: false });
});
```

- [ ] **Step 5: Implement the complete controller transition table and publication rules**

Keep transitions in one private method. `restore()` stores display-only data with provenance `RESTORED`; `read()` succeeds only in `LIVE`; `sweep()` produces at most one stage transition per cooldown window. A new authoritative baseline for the active epoch clears recovery and becomes `LIVE`.

- [ ] **Step 6: Run controller tests, API typecheck, and commit**

Run:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/provider-feed-controller.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
git add apps/api/src/chrome-bridge/provider-feed-*.ts
git commit -m "feat(feed): add authoritative provider state machine"
```

Expected: all new tests PASS; API typecheck PASS.

---

### Task 2: Feed Registry and Chrome Data-Plane Integration

**Files:**

- Create: `apps/api/src/chrome-bridge/provider-feed-registry.ts`
- Create: `apps/api/src/chrome-bridge/provider-feed-registry.test.ts`
- Modify: `apps/api/src/chrome-bridge/adapter.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.test.ts`
- Modify: `apps/api/src/catalog/catalog-coverage-guard.ts`
- Modify: `apps/api/src/catalog/catalog-coverage-guard.test.ts`

**Interfaces:**

- Consumes: `ProviderFeedController`, `ProviderFeedEvidence`, and the six policies from Task 1.
- Produces:

```ts
export class ProviderFeedRegistry {
  accept(evidence: ProviderFeedEvidence): FeedDecision;
  restore(catalog: ObservedProviderCatalog): FeedDecision;
  read(accountId: string): ObservedProviderCatalog;
  snapshot(accountId: string): ProviderFeedSnapshot;
  list(): readonly ProviderFeedSnapshot[];
  sweep(): readonly ProviderRecoveryRequest[];
  subscribe(listener: (snapshot: ProviderFeedSnapshot) => void): () => void;
}
```

`DecodedCatalogUpdate` adds `evidenceMode`, `generation`, `provenance`, and `providerTimestampMs` to catalog updates; transport and invalidation variants stay discriminated.

- [ ] **Step 1: Write a failing registry test proving six controllers exist and restored data is stale**

```ts
expect(registry.list().map((item) => item.accountId)).toEqual([
  APSPORT, BTI, CMD, IM, SABA, SBOBET
]);
registry.restore(catalogFor(SBOBET));
expect(registry.snapshot(SBOBET).state).toBe("SYNCING");
```

- [ ] **Step 2: Implement the registry and run its test**

Run: `npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/provider-feed-registry.test.ts`

Expected: PASS.

- [ ] **Step 3: Replace data-plane liveness maps with feed evidence and write the regression test first**

Delete status decisions based on `#lastTransportAtMs`, `#lastDecodedAtMs`, and top-level `catalog.observedAtMs`. Keep source pinning/body assembly/router responsibilities.

```ts
it("does not report SABA active when only TAB_STATE heartbeats follow a stale catalog", async () => {
  plane.restore(sabaCatalog({ observedAtMs: 100 }));
  plane.ingest(tabHeartbeat({ observedAtMs: 10_000, sequence: 1 }));
  await expect(plane.read(SABA)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  expect((await plane.overlayStatuses([activeSession(SABA)]))[0]).toMatchObject({
    sessionState: "ACTION_REQUIRED", reason: "PROVIDER_VALIDATION_FAILED"
  });
});
```

- [ ] **Step 4: Convert adapter output into explicit evidence**

Mapping:

```ts
const evidenceMode = update.authoritativeBaseline === true ? "BASELINE" : "DELTA";
const provenance = envelope.transport === "WS_FRAME" ? "WS"
  : envelope.transport === "HTTP_RESPONSE" ? "AUTHENTICATED_HTTP" : "DOM_FALLBACK";
```

Only decoded provider `transportAlive` becomes `TRANSPORT`. Generic envelopes call `TAB_REACHABLE` and return without renewing feed evidence. Source/epoch replacement sends `INVALIDATE` before router reset. Use adapter-provided generation; fall back to `${sourceEpoch}:${sequence}` only for a complete one-envelope baseline.

- [ ] **Step 5: Strengthen coverage acceptance around complete generations**

Change `CatalogCoverageGuard.accept` to receive `{ generation, authoritativeBaseline, providerEventIds }`. A smaller non-authoritative candidate is rejected. A complete authoritative generation resets coverage exactly once and may remove old events. Remove comments/tests claiming a three-read quorum that the class does not implement.

- [ ] **Step 6: Run the focused data-plane suite and commit**

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/provider-feed-registry.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts src/catalog/catalog-coverage-guard.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
git add apps/api/src/chrome-bridge/provider-feed-registry* apps/api/src/chrome-bridge/adapter.ts apps/api/src/chrome-bridge/chrome-catalog-data-plane* apps/api/src/catalog/catalog-coverage-guard*
git commit -m "fix(feed): make catalog freshness provider-authoritative"
```

Expected: no test allows `ACTIVE` while `read()` rejects the same source as stale.

---

### Task 3: Bounded Soft-to-Hard Recovery

**Files:**

- Modify: `apps/api/src/chrome-bridge/automatic-source-recovery.ts`
- Modify: `apps/api/src/chrome-bridge/automatic-source-recovery.test.ts`
- Modify: `apps/api/src/chrome-bridge/provider-source-refresh.ts`
- Modify: `apps/api/src/chrome-bridge/provider-source-refresh.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**

- Consumes: `ProviderFeedRegistry.snapshot()`, `ProviderFeedRegistry.subscribe()`, and existing `requestLobbySnapshot`, `restoreLobby`, `ensureLobby`, Fabet launch refresh/access functions.
- Produces:

```ts
export interface RecoveryResult {
  readonly accountId: string;
  readonly stage: "SOFT" | "HARD";
  readonly outcome: "RECOVERED" | "DELIVERED" | "NO_SOURCE" | "ACTION_REQUIRED";
  readonly reason: string | null;
}

recover(request: ProviderRecoveryRequest): Promise<RecoveryResult>;
```

- [ ] **Step 1: Replace the current no-fallback recovery test with failing escalation tests**

```ts
it("creates a missing KSPORT source instead of ending at snapshot-undelivered", async () => {
  requestLobbySnapshot.mockReturnValue(0);
  await recovery.recover({ accountId: SBOBET, stage: "SOFT", attempt: 1, requestedAtMs: 1_000 });
  expect(refreshFabetLaunches).toHaveBeenCalledOnce();
  expect(ensureLobby).toHaveBeenCalledExactlyOnceWith("KSPORT", "https://sbobet.provider.test/fresh");
});

it("replaces only SABA after delivered soft recovery fails to produce a newer baseline", async () => {
  requestLobbySnapshot.mockReturnValue(1);
  waitForFreshBaseline.mockRejectedValue(new Error("RECOVERY_BASELINE_TIMEOUT"));
  await recovery.recover({ accountId: SABA, stage: "SOFT", attempt: 1, requestedAtMs: 1_000 });
  expect(ensureLobby).toHaveBeenCalledOnceWith("SABA", expect.any(String));
  expect(ensureLobby).not.toHaveBeenCalledWith("KSPORT", expect.any(String));
});
```

- [ ] **Step 2: Run recovery tests and verify the current implementation fails**

Run: `npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/automatic-source-recovery.test.ts`

Expected: FAIL because current recovery has no hard fallback.

- [ ] **Step 3: Implement account-specific soft actions and baseline confirmation**

Use `waitForFreshBaseline(accountId, afterMs, timeoutMs)` injected from the registry. Delivery is not success. CMD hard recovery calls `restoreLobby("CMD")`; Fabet-backed hard recovery refreshes launches and calls `ensureLobby` with only the affected provider URL.

- [ ] **Step 4: Implement structured errors and maintenance suppression**

Preserve exact reasons: `AUTH_EGRESS_UNAVAILABLE`, `LAUNCH_EXPIRED`, `LAUNCH_CONSUMED`, `PORTAL_VALIDATION_FAILED`, `SOURCE_MISSING`, `BASELINE_TIMEOUT`, `PROVIDER_SCHEMA_CHANGED`. Add `isRecoverySuppressed(accountId)` to avoid racing explicit reset/maintenance.

- [ ] **Step 5: Wire a one-second registry sweep in `server.ts`**

```ts
const feedSweep = setInterval(() => {
  for (const request of providerFeeds.sweep()) void automaticSourceRecovery.recover(request);
}, 1_000);
feedSweep.unref();
app.addHook("onClose", async () => clearInterval(feedSweep));
```

Recovery completion is observed through the controller accepting newer evidence, not through the recovery actor mutating state directly.

- [ ] **Step 6: Run focused tests, typecheck, and commit**

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/automatic-source-recovery.test.ts src/chrome-bridge/provider-source-refresh.test.ts src/chrome-bridge/provider-feed-controller.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
git add apps/api/src/chrome-bridge/automatic-source-recovery* apps/api/src/chrome-bridge/provider-source-refresh* apps/api/src/server.ts
git commit -m "fix(recovery): escalate stalled feeds without global resets"
```

---

### Task 4: Bridge Resync, Source Epochs, and Independent Work Lanes

**Files:**

- Create: `apps/chrome-extension/src/provider-work-scheduler.ts`
- Create: `apps/chrome-extension/src/provider-work-scheduler.test.ts`
- Modify: `apps/chrome-extension/src/local-bridge.ts`
- Modify: `apps/chrome-extension/src/local-bridge.test.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/chrome-extension/src/network-observer.test.ts`
- Modify: `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- Modify: `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`
- Modify: `apps/chrome-extension/src/bridge-wakeup.ts`
- Modify: `apps/chrome-extension/src/bridge-wakeup.test.ts`
- Modify: `apps/chrome-extension/src/background.ts`

**Interfaces:**

- Consumes: source IDs in the form `chrome:<lobby>:<tabId>`.
- Produces:

```ts
export class ProviderWorkScheduler {
  run<T>(sourceId: string, operation: () => Promise<T>): Promise<T>;
  isBusy(sourceId: string): boolean;
  clear(sourceId: string): void;
}
```

`LocalBridge` adds `onSourceResync(sourceId: string): void | Promise<void>`. `NetworkObserver.beginSourceEpoch(sourceId)` increments its source generation, clears retained incomplete bodies/frames for that source, and returns the new public epoch.

- [ ] **Step 1: Write failing queue-pressure and independent-lane tests**

```ts
it("drops one source atomically and requests a new epoch when queue coalescing creates a gap", async () => {
  await bridge.enqueue(largeQuote("chrome:SABA:7", 1));
  await bridge.enqueue(largeQuote("chrome:SABA:7", 2));
  await bridge.enqueue(largeQuote("chrome:BTI:8", 1));
  expect(onSourceResync).toHaveBeenCalledExactlyOnceWith("chrome:SABA:7");
  expect(bridge.queuedSources()).toContain("chrome:BTI:8");
});

it("does not let a blocked TSPORT operation delay BTI", async () => {
  const blocked = scheduler.run("chrome:TSPORT:1", () => neverSettles);
  await expect(scheduler.run("chrome:BTI:2", async () => "done")).resolves.toBe("done");
  void blocked;
});
```

- [ ] **Step 2: Implement per-source scheduler and atomic bridge resync**

On the first forced quote drop for a source: remove every unsent envelope for that source, mark it resyncing, close/reconnect the loopback socket after ACK/REJECT handling, call `onSourceResync`, and refuse new deltas for that source until its snapshot begins under a new epoch. Do not remove other providers' queues.

- [ ] **Step 3: Replace global `#periodicDomWorkTail` usage with keyed lanes**

CMD, IM, SABA, KSPORT, TSPORT, and BTI use their own source lane. Keep provider-specific single-flight maps where they prevent duplicate signed/baseline requests. Remove the test that intentionally accepts cross-provider blocking and replace it with isolation tests.

- [ ] **Step 4: Make the durable wakeup run collection immediately**

Extend `BridgeWakeup` with injected `pollNow`. The alarm/restart path must reconcile tabs, reconnect the bridge, reattach CDP, then invoke one immediate poll. Add a test that a worker wakeup cannot leave a reattached IM/BTI source waiting for an in-memory interval.

- [ ] **Step 5: Run extension tests, typecheck, and commit**

```powershell
npm.cmd test --workspace @tool-chenh/chrome-extension -- src/provider-work-scheduler.test.ts src/local-bridge.test.ts src/network-observer.test.ts src/cmd-snapshot-poller.test.ts src/bridge-wakeup.test.ts
npm.cmd run typecheck --workspace @tool-chenh/chrome-extension
git add apps/chrome-extension/src/provider-work-scheduler* apps/chrome-extension/src/local-bridge* apps/chrome-extension/src/network-observer* apps/chrome-extension/src/cmd-snapshot-poller* apps/chrome-extension/src/bridge-wakeup* apps/chrome-extension/src/background.ts
git commit -m "fix(extension): isolate feeds and resync bridge gaps atomically"
```

---

### Task 5: CMD and IM Authoritative Realtime Paths

**Files:**

- Create: `apps/api/src/chrome-bridge/cmd-http-adapter.ts`
- Create: `apps/api/src/chrome-bridge/cmd-http-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/cmd-dom-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/cmd-dom-adapter.test.ts`
- Modify: `apps/chrome-extension/src/cmd-dom-snapshot.ts`
- Modify: `apps/chrome-extension/src/cmd-dom-snapshot.test.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/chrome-extension/src/network-observer.test.ts`
- Modify: `apps/api/src/chrome-bridge/im-http-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- Modify: `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- Modify: `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`

**Interfaces:**

- CMD HTTP adapter emits `AUTHENTICATED_HTTP` baseline/delta evidence keyed by provider event/market/selection IDs.
- CMD DOM adapter emits `DOM_FALLBACK` evidence with per-record observation age and a complete sweep generation.
- IM adapter emits an atomic two-part baseline and ordered deltas, preserving deltas newer than an in-flight baseline.

- [ ] **Step 1: Capture and sanitize one real CMD baseline and one real odds-change response**

Enable capture for CMD only in the isolated execution stack. Record only hostname/path class, response structure, public provider IDs, statuses, lines, and odds. Strip query strings, headers, cookies, tokens, account data, and unrelated fields through the existing redactor before saving the two minimal fixtures in the test file. Verify with:

```powershell
rg -n -i "cookie|authorization|token|password|session|launch|query" apps/api/src/chrome-bridge/cmd-http-adapter.test.ts
```

Expected: no secret-bearing fixture fields or values.

- [ ] **Step 2: Write the failing CMD network transition test**

```ts
it("maps a DataOdds change to the same provider selection without waiting for DOM scroll", () => {
  const baseline = adapter.decode(cmdBaselineEnvelope).at(-1)!;
  const changed = adapter.decode(cmdOddsChangeEnvelope).at(-1)!;
  expect(baseline).toMatchObject({ evidenceMode: "BASELINE", provenance: "AUTHENTICATED_HTTP" });
  expect(price(changed.value, "event-25250586", "market-1", "home")).toBe("1.93");
});
```

- [ ] **Step 3: Implement strict CMD HTTP fingerprint/decoder and route it before DOM fallback**

Fingerprint only verified CMD hostnames and the characterized `DataOdds.ashx`/sport-item paths. Reject unknown schema instead of guessing. Merge network prices by exact provider IDs; DOM may add identity labels or visible verification but cannot overwrite a newer network quote.

- [ ] **Step 4: Make the CMD DOM fallback sweep-atomic and per-quote stale**

Add `class` and `aria-disabled` to the mutation observer. Replace 15-second record eviction with sweep generations: retain a row until a complete sweep omits it, and mark unvisited quotes ineligible once their own age exceeds the policy. Identical DOM only updates `tabReachableAtMs`.

- [ ] **Step 5: Write failing IM race/cancellation tests**

```ts
it("reapplies a newer delta after a two-part baseline commits", () => {
  adapter.decode(imBaselinePart("g2", "IM_MARKET_1", 1_000));
  adapter.decode(imDelta({ atMs: 1_100, odds: "2.04" }));
  const committed = adapter.decode(imBaselinePart("g2", "IM_MARKET_2", 1_000)).at(-1)!;
  expect(selectionOdds(committed.value)).toBe("2.04");
});
```

Add an extension test where Market 1 hangs, its AbortController fires at the configured deadline, and generation `g3` starts without overlapping the late `g2` response.

- [ ] **Step 6: Implement IM delta buffering, cancellation, and per-source cadence**

Keep natural `GetSEDelta` realtime. Fetch signed Market 1/2 concurrently only if the page signer test proves independent requests; otherwise keep signing sequential but body fetches bounded. Store buffered deltas by provider sequence/timestamp and apply only those newer than the baseline. Full GetSE reconciliation remains at 15 seconds initially and must not be delayed by another provider lane.

- [ ] **Step 7: Run CMD/IM suites, typecheck, and commit**

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/cmd-http-adapter.test.ts src/chrome-bridge/cmd-dom-adapter.test.ts src/chrome-bridge/im-http-adapter.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- src/cmd-dom-snapshot.test.ts src/cmd-snapshot-poller.test.ts src/network-observer.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
npm.cmd run typecheck --workspace @tool-chenh/chrome-extension
git add apps/api/src/chrome-bridge/cmd-http-adapter* apps/api/src/chrome-bridge/cmd-dom-adapter* apps/api/src/chrome-bridge/im-http-adapter* apps/chrome-extension/src/cmd-dom-snapshot* apps/chrome-extension/src/cmd-snapshot-poller* apps/chrome-extension/src/network-observer*
git commit -m "fix(feed): make CMD and IM updates authoritative and ordered"
```

---

### Task 6: SABA and SBOBET Stream Recovery

**Files:**

- Modify: `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`
- Modify: `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/chrome-extension/src/network-observer.test.ts`
- Modify: `apps/chrome-extension/src/saba-snapshot-recovery.test.ts`
- Modify: `apps/chrome-extension/src/source-tab-recovery.ts`
- Modify: `apps/chrome-extension/src/source-tab-recovery.test.ts`

**Interfaces:**

- SABA `LIVE` baseline proof: current epoch, Socket.IO OPEN, reset/done generation committed.
- SBOBET `LIVE` baseline proof: recognized KSPORT source, current epoch, both `live` and `today` partitions committed.
- Orphan detection calls `requestFreshSocketBaseline(source, predicate)` once per source epoch and escalates through Task 3 on timeout.

- [ ] **Step 1: Write the failing SABA worker-restart regression**

Simulate `Network.webSocketFrameReceived` for SABA with an unknown CDP request ID after observer state is recreated. Assert one controlled reconnect is requested, the orphan payload is not treated as a delta, retained replay remains stale, and the adapter publishes only after a new reset/done generation.

```ts
expect(reconnects).toEqual([{ sourceId: "chrome:SABA:7", socket: "socket.io" }]);
expect(published).toEqual([]);
await emitNewResetDone("worker-b:1");
expect(published.at(-1)).toMatchObject({ authoritativeBaseline: true, provenance: "WS" });
```

- [ ] **Step 2: Implement rate-limited SABA orphan reconnect and baseline fencing**

Permit one reconnect per source epoch. Detect `A003`, repeated reconnect, or missing reset/done before the soft deadline and invalidate with a structured reason. Persisted/replayed frames may prime the decoder but do not set authoritative evidence time until validated by current traffic.

- [ ] **Step 3: Fix SABA DOM fallback tests and expiry**

Replace the outdated replay-only expectation with replay-plus-bounded-DOM behavior. Add a safety capture below the feed policy deadline, include class/status mutations, require a complete coverage generation, and retire hidden retained partitions by source epoch/max age.

- [ ] **Step 4: Write the failing missing-KSPORT and two-part baseline tests**

```ts
it("does not publish SBOBET until live and today belong to one current epoch", () => {
  expect(adapter.decode(ksportPart("live", "worker-a:0", "g1"))).toEqual([]);
  expect(adapter.decode(ksportPart("today", "worker-b:0", "g1"))).toEqual([]);
  expect(adapter.decode(ksportPart("today", "worker-a:0", "g1"))).toHaveLength(1);
});
```

Source-tab recovery test: no KSPORT tab plus a fresh launch must create one KSPORT target, attach observation before navigation, and leave all non-KSPORT tab IDs unchanged.

- [ ] **Step 5: Implement KSPORT epoch/partition fencing and targeted creation**

Retain same-tab football discovery and fresh `getEvent` as soft recovery. On missing source or timeout, use the Task 3 hard path. Reject closed streams, retired epochs, late generations, and mixed-partition generations.

- [ ] **Step 6: Run SABA/SBOBET suites, typecheck, and commit**

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/saba-ws-adapter.test.ts src/chrome-bridge/saba-ws-realtime-regression.test.ts src/chrome-bridge/ksport-ws-adapter.test.ts src/chrome-bridge/automatic-source-recovery.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- src/network-observer.test.ts src/saba-snapshot-recovery.test.ts src/source-tab-recovery.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
npm.cmd run typecheck --workspace @tool-chenh/chrome-extension
git add apps/api/src/chrome-bridge/saba-ws-* apps/api/src/chrome-bridge/ksport-ws-* apps/chrome-extension/src/network-observer* apps/chrome-extension/src/saba-snapshot-recovery.test.ts apps/chrome-extension/src/source-tab-recovery*
git commit -m "fix(feed): recover SABA and SBOBET authoritative streams"
```

---

### Task 7: APSPORT Authority and BTI Detail Stability

**Files:**

- Modify: `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts`
- Modify: `apps/api/src/chrome-bridge/bti-http-adapter.ts`
- Modify: `apps/api/src/chrome-bridge/bti-http-adapter.test.ts`
- Modify: `apps/chrome-extension/src/network-observer.ts`
- Modify: `apps/chrome-extension/src/network-observer.test.ts`
- Modify: `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- Modify: `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`

**Interfaces:**

- APSPORT authoritative evidence is an attributed WS delta or atomic authenticated HTTP `live/today/early` generation.
- BTI native `/live` is primary; generated list baselines reconcile; details are per-event overlays with explicit replacement/expiry.

- [ ] **Step 1: Write failing APSPORT false-freshness and orphan tests**

```ts
it("does not renew APSPORT authority from identical DOM snapshots", () => {
  plane.ingest(tsportHttpBaseline("g1", 1_000));
  plane.ingest(tsportDomSnapshot({ atMs: 20_000, samePrices: true }));
  expect(plane.feedSnapshot(APSPORT).lastAuthoritativeEvidenceAtMs).toBe(1_000);
});
```

Add an unknown-request-ID TSPORT WS frame test that schedules one atomic HTTP refresh instead of silently returning.

- [ ] **Step 2: Schedule bounded atomic TSPORT fallback until WS attribution returns**

Add TSPORT to the explicit full-refresh scheduler. Fetch `live/today/early` under one generation and publish only when all three arrive. Stop fallback polling only after a newly observed attributed WS stream supplies valid provider evidence. DOM remains diagnostic/visible overlay.

- [ ] **Step 3: Fence APSPORT provenance and expire stale partitions**

Track source epoch, generation, partition, and observation time per row. HTTP/WS wins over DOM regardless of envelope arrival order. A complete baseline removes omitted old rows; no old sequence may inherit the catalog's newest timestamp.

- [ ] **Step 4: Write failing BTI list/detail continuity tests**

```ts
it("does not clear valid details when a newer live list baseline commits", () => {
  adapter.decode(btiCompleteBaseline("g1"));
  adapter.decode(btiDetail("event-1", "2.11", 2_000));
  const next = adapter.decode(btiCompleteBaseline("g2", 3_000)).at(-1)!;
  expect(price(next.value, "event-1", "detail-away")).toBe("2.11");
});

it("accepts newer native live while preserving prematch and rejecting rollback", () => {
  const next = adapter.decode(nativeLive({ atMs: 4_000, odds: "1.97" })).at(-1)!;
  adapter.decode(nativeLive({ atMs: 3_500, odds: "1.88" }));
  expect(price(next.value, "live-home")).toBe("1.97");
  expect(event(next.value, "prematch-1")).toBeDefined();
});
```

- [ ] **Step 5: Split BTI live-list and detail schedules**

Do not await the rotating detail batch before the next native/list refresh. Use a bounded detail pool, prioritize selected/watched event IDs, then round-robin remaining events. Retain details until replacement/tombstone or a stale transition based on the measured full-sweep interval; do not use a fixed ten-second TTL shorter than a complete sweep.

- [ ] **Step 6: Publish coherent BTI generations and bound body assembly**

Coalesce list plus available detail updates before one semantic publication. Add TTL and byte/count caps to `NetworkBodyAssembler.#pending`; incomplete chunks expire without invalidating another provider.

- [ ] **Step 7: Run APSPORT/BTI suites, typecheck, and commit**

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/tsport-ws-adapter.test.ts src/chrome-bridge/bti-http-adapter.test.ts src/chrome-bridge/network-body-assembler.test.ts src/chrome-bridge/chrome-catalog-data-plane.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- src/network-observer.test.ts src/cmd-snapshot-poller.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api
npm.cmd run typecheck --workspace @tool-chenh/chrome-extension
git add apps/api/src/chrome-bridge/tsport-ws-* apps/api/src/chrome-bridge/bti-http-* apps/api/src/chrome-bridge/network-body-assembler* apps/chrome-extension/src/network-observer* apps/chrome-extension/src/cmd-snapshot-poller*
git commit -m "fix(feed): stabilize APSPORT and BTI realtime catalogs"
```

---

### Task 8: Unified Public Status, Realtime State, and Fail-Closed UI

**Files:**

- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Modify: `packages/contracts/src/schemas.test.ts`
- Modify: `apps/api/src/routes/catalog-sources.ts`
- Modify: `apps/api/src/routes/catalog-sources.test.ts`
- Modify: `apps/api/src/catalog/catalog-source-registry.ts`
- Modify: `apps/api/src/catalog/catalog-source-registry.test.ts`
- Modify: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/health.test.ts`
- Modify: `apps/api/src/catalog/catalog-revision-store.ts`
- Modify: `apps/api/src/catalog/catalog-revision-store.test.ts`
- Modify: `apps/api/src/realtime/opportunity-ws.ts`
- Create: `apps/api/src/realtime/opportunity-ws.test.ts`
- Modify: `apps/web/src/api/catalog-sources.ts`
- Modify: `apps/web/src/api/catalog-sources.test.ts`
- Modify: `apps/web/src/catalog/catalog-revision-coordinator.ts`
- Modify: `apps/web/src/catalog/catalog-revision-coordinator.test.ts`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/catalog/comparison.ts`
- Modify: `apps/web/src/catalog/comparison.test.ts`
- Modify: `apps/web/src/components/ranked-ticket-table.tsx`
- Modify: `apps/web/src/components/ranked-ticket-table.test.tsx`

**Interfaces:**

Public status:

```ts
export interface ProviderFeedStatus {
  readonly state: ProviderFeedState;
  readonly reason: string | null;
  readonly sourceId: string | null;
  readonly sourceEpoch: string | null;
  readonly tabReachableAtMs: number | null;
  readonly providerTransportAtMs: number | null;
  readonly lastAuthoritativeEvidenceAtMs: number | null;
  readonly lastCompleteBaselineAtMs: number | null;
  readonly lastSemanticChangeAtMs: number | null;
  readonly recoveryStage: "NONE" | "SOFT" | "HARD";
  readonly recoveryAttempt: number;
}
```

`CatalogSourceStatus` gains required `feed: ProviderFeedStatus`. Realtime adds `FEED_STATUS_BASELINE` and `FEED_STATUS`; catalog semantic revisions remain separate.

Task 8 moves the public `ProviderFeedState` definition into `packages/contracts/src/domain.ts`; API feed types import and re-export that contract type so there is only one definition.

- [ ] **Step 1: Write failing strict-schema tests for feed status and realtime messages**

Assert required fields, safe timestamps, bounded IDs/reasons, six valid states, and rejection of secret-shaped extras. Add a strict `FEED_STATUS` message example and a baseline containing all six account IDs.

- [ ] **Step 2: Implement contracts and run contract tests**

Run: `npm.cmd test --workspace @tool-chenh/contracts -- src/schemas.test.ts`

Expected: PASS with no widening of unknown fields.

- [ ] **Step 3: Make catalog source and health routes consume the same registry snapshots**

`/api/health` reports the six football feeds, not the legacy SABA/IM football/LOL runtime set. Overall status is `ok` only when all six feed states are `LIVE`; `ACTION_REQUIRED` and `STALLED` are listed with their exact reasons.

- [ ] **Step 4: Stream feed-state transitions independently of semantic catalog revisions**

Add a monotonic feed-status sequence and baseline. A `LIVE -> STALLED` transition must reach the browser even when price/identity semantics did not change. Do not force a catalog refetch for a tab-heartbeat-only diagnostic change.

- [ ] **Step 5: Write failing UI tests for immediate stale removal**

```tsx
feedRealtime.emit({ type: "FEED_STATUS", sequence: 9, accountId: SABA,
  feed: stalledFeed("PROVIDER_STREAM_GAP") });
expect(screen.queryByText("SABA vs CMD")).not.toBeInTheDocument();
expect(screen.getByText(/SABA.*STALLED/i)).toBeInTheDocument();
expect(preflight).not.toHaveBeenCalled();
```

Cover comparison, ranked ticket, alert/watch, and selected match behavior. The stale catalog may remain in diagnostics but not executable collections.

- [ ] **Step 6: Implement UI feed-status coordination and fail-closed filtering**

Store feed status separately from catalog semantics. A freshness/state update reruns eligibility immediately; a semantic revision fetches the catalog. Remove any path that infers freshness only from the last UI fetch time.

- [ ] **Step 7: Run contracts/API/web tests, typecheck, and commit**

```powershell
npm.cmd test --workspace @tool-chenh/contracts -- src/schemas.test.ts
npm.cmd test --workspace @tool-chenh/api -- src/routes/catalog-sources.test.ts src/routes/health.test.ts src/catalog/catalog-revision-store.test.ts src/realtime/opportunity-ws.test.ts
npm.cmd test --workspace @tool-chenh/web -- src/api/catalog-sources.test.ts src/catalog/catalog-revision-coordinator.test.ts src/pages/live-catalog-page.test.tsx src/catalog/comparison.test.ts src/components/ranked-ticket-table.test.tsx
npm.cmd run typecheck
git add packages/contracts/src apps/api/src/routes/catalog-sources* apps/api/src/routes/health* apps/api/src/catalog/catalog-revision-store* apps/api/src/realtime/opportunity-ws* apps/web/src/api/catalog-sources* apps/web/src/catalog/catalog-revision-coordinator* apps/web/src/pages/live-catalog-page* apps/web/src/catalog/comparison* apps/web/src/components/ranked-ticket-table*
git commit -m "fix(status): unify six-provider health and stale suppression"
```

---

### Task 9: Redacted Feed Journal and Runtime Fingerprints

**Files:**

- Create: `apps/api/src/routes/provider-feed-journal.ts`
- Create: `apps/api/src/routes/provider-feed-journal.test.ts`
- Modify: `packages/contracts/src/chrome-bridge.ts`
- Modify: `packages/contracts/src/chrome-bridge.test.ts`
- Modify: `apps/chrome-extension/scripts/build.mjs`
- Modify: `apps/chrome-extension/src/local-bridge.ts`
- Modify: `apps/chrome-extension/src/local-bridge.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-route.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-route.test.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-registry.ts`
- Modify: `apps/api/src/chrome-bridge/chrome-bridge-registry.test.ts`
- Modify: `apps/api/src/routes/catalog-telemetry.ts`
- Modify: `apps/api/src/routes/catalog-telemetry.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**

- HELLO includes bounded `extensionBuildId` and `observerSessionId`; source diagnostics expose them.
- Journal entries are strict, redacted metadata only:

```ts
interface ProviderFeedJournalEntry {
  atMs: number;
  accountId: string;
  sourceId: string | null;
  sourceEpoch: string | null;
  kind: "BASELINE_ACCEPTED" | "DELTA_ACCEPTED" | "EVIDENCE_REJECTED"
    | "STATE_CHANGED" | "RECOVERY_STARTED" | "RECOVERY_FINISHED";
  generation: string | null;
  partition: string | null;
  reason: string | null;
  eventCount: number | null;
  quoteCount: number | null;
  latencyMs: number | null;
}
```

- [ ] **Step 1: Write failing journal redaction/bounds tests**

Reject entries containing unknown keys, URLs, headers, bodies, tokens, cookies, or strings beyond limits. Verify rotation/size bounds and that journal write failure increments an error counter without breaking feed ingestion.

- [ ] **Step 2: Implement the bounded JSONL journal and adapter-ingest telemetry**

Record controller decisions, not HTTP catalog reads. Keep existing catalog telemetry for read performance but stop using it as feed liveness. Derive source-to-API latency from provider timestamps only when the provider supplies one.

- [ ] **Step 3: Add build fingerprint handshake tests and implementation**

Inject a deterministic build ID during extension build, send it in HELLO, store it on the bridge connection, and expose it through source diagnostics. A mismatch is diagnostic, not a reason to leak installation details or restart all tabs.

- [ ] **Step 4: Run journal/bridge tests, build, and commit**

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/routes/provider-feed-journal.test.ts src/routes/catalog-telemetry.test.ts src/chrome-bridge/chrome-bridge-route.test.ts src/chrome-bridge/chrome-bridge-registry.test.ts
npm.cmd test --workspace @tool-chenh/chrome-extension -- src/local-bridge.test.ts
npm.cmd test --workspace @tool-chenh/contracts -- src/chrome-bridge.test.ts
npm.cmd run build --workspace @tool-chenh/chrome-extension
npm.cmd run typecheck
git add apps/api/src/routes/provider-feed-journal* apps/api/src/routes/catalog-telemetry* apps/api/src/chrome-bridge/chrome-bridge-route* apps/api/src/chrome-bridge/chrome-bridge-registry* apps/api/src/server.ts apps/chrome-extension/scripts/build.mjs apps/chrome-extension/src/local-bridge* packages/contracts/src/chrome-bridge*
git commit -m "feat(observability): trace feed authority and runtime builds"
```

---

### Task 10: Cross-Layer Fault Tests and Live Soak Harness

**Files:**

- Create: `tests/integration/six-provider-feed-lifecycle.test.ts`
- Create: `scripts/six-provider-realtime-soak.mjs`
- Create: `scripts/six-provider-realtime-soak.test.mjs`
- Modify: `package.json`
- Modify: `run.md`

**Interfaces:**

- `npm run test:six-provider-feed` runs the deterministic integration suite.
- `npm run soak:six-provider -- --base-url http://127.0.0.1:4310 --duration-minutes 30` writes a redacted JSON summary and exits nonzero when a gate fails.
- Sampler records per provider: feed state, source/epoch, authoritative age, baseline age, catalog revision, event/quote counts, semantic changes, sequence gaps, recovery stage/outcome, and API latency. It never stores URLs or bodies.

- [ ] **Step 1: Write the failing lifecycle integration test**

Drive fake envelopes through bridge route, registry, adapter, feed controller, revision store, realtime serialization, and UI coordinator for all six account IDs. Cover:

```ts
for (const accountId of SIX_ACCOUNTS) {
  await scenario.obtainBaseline(accountId);
  await scenario.injectGap(accountId);
  expect(scenario.feed(accountId).state).not.toBe("LIVE");
  expect(scenario.executableAccounts()).not.toContain(accountId);
  await scenario.recover(accountId);
  expect(scenario.feed(accountId).state).toBe("LIVE");
  expect(scenario.untouchedSourceIds(accountId)).toEqual(originalOtherFiveSourceIds);
}
```

- [ ] **Step 2: Implement only the minimal test harness adapters needed to exercise production boundaries**

Do not replace production controllers with mocks. Fake only Chrome sockets, time, provider bodies, and browser fetches. Assert realtime messages using the public Zod schema.

- [ ] **Step 3: Write sampler parser/gate tests before the live script**

Test one passing 30-minute summary and failures for: no post-start baseline, `ACTIVE + STALE`, authoritative age over policy, catalog collapse, source reset of another provider, SABA recovery over 60 seconds, SBOBET recovery over 90 seconds with valid auth, and stale executable tickets.

- [ ] **Step 4: Implement the one-second live sampler and fault markers**

The script consumes `/api/catalog/sources`, `/api/chrome-bridge/sources`, `/api/catalog/metrics`, `/api/health`, catalog account endpoints, and `/api/realtime`. Fault injection is explicit via existing maintenance/extension controls and is never executed against an unspecified tab or process. If direct provider transitions are quiet, accept authenticated response/version continuity; never synthesize a price change.

- [ ] **Step 5: Add package scripts and correct the canonical startup path**

```json
{
  "test:six-provider-feed": "vitest run tests/integration/six-provider-feed-lifecycle.test.ts",
  "soak:six-provider": "node scripts/six-provider-realtime-soak.mjs"
}
```

Update `run.md` to identify the canonical `fix/auto-source-recovery` source, require matching API/extension build IDs, and remove instructions that start the five-commit-old worktree.

- [ ] **Step 6: Run automated verification and commit**

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration
npm.cmd run test:six-provider-feed
npm.cmd run build
git add tests/integration/six-provider-feed-lifecycle.test.ts scripts/six-provider-realtime-soak* package.json run.md
git commit -m "test(feed): gate six-provider realtime recovery end to end"
```

Expected: all commands PASS. Record exact counts in the implementation handoff; do not summarize a partial suite as full verification.

---

### Task 11: Controlled Deployment and Six-of-Six Acceptance

**Files:**

- Modify only if evidence finds a defect: the owning source/test pair from Tasks 1-10.
- Create: `docs/realtime-six-provider-acceptance-2026-08-23.md`
- Create: `docs/realtime-six-provider-acceptance-2026-08-23.json`

**Interfaces:**

- Consumes: built API/web/extension artifacts from the exact tested commit and the soak harness from Task 10.
- Produces: one redacted acceptance report with commands, build IDs, provider gates, fault results, and unresolved external blockers.

- [ ] **Step 1: Start the isolated stack from the exact tested commit and verify fingerprints**

Build, load the matching extension bundle, start API/web, then assert the API-reported build and extension build IDs match the commit under test. Do not stop the user's active stack until the isolated ports and paths are verified.

- [ ] **Step 2: Run the normal 30-minute soak**

Run:

```powershell
npm.cmd run soak:six-provider -- --base-url http://127.0.0.1:<isolated-api-port> --duration-minutes 30 --output docs/realtime-six-provider-acceptance-2026-08-23.json
```

Require six post-start authoritative baselines, zero contradictory health states, no stale executable data, and bounded cadence for every provider.

- [ ] **Step 3: Verify direct AH and TOTAL transitions**

For each provider, bind at least one exact event/market/selection ID to a current direct provider response or visible probe. When a real price/status transition occurs, record provider timestamp/receive time, controller acceptance, catalog revision, realtime message, and UI application. Require normal propagation within three seconds and maximum five seconds.

- [ ] **Step 4: Run fault injection one provider at a time**

Inject API restart, extension-worker restart, one source-tab close, and one source socket close. Verify the affected source becomes non-live immediately, disappears from executable UI data, recovers within its bound, and preserves all other source/tab IDs. For SBOBET, mark auth valid before applying the 90-second recreation gate.

- [ ] **Step 5: Write the acceptance report and fix only evidence-backed failures**

The Markdown report lists all six providers with baseline evidence, cadence, price-transition samples, fault outcome, recovery duration, and final state. If any gate fails, leave six-of-six status as FAIL, add a failing automated regression at the owning task boundary, implement the minimal correction, rerun its focused suite, then repeat the affected soak/fault scenario.

- [ ] **Step 6: Run final verification, commit the report, and integrate canonical branch**

```powershell
npm.cmd run verify
npm.cmd run test:six-provider-feed
git add docs/realtime-six-provider-acceptance-2026-08-23.md docs/realtime-six-provider-acceptance-2026-08-23.json
git commit -m "docs: record six-provider realtime acceptance"
```

After all six gates pass, integrate the validated commits into `fix/auto-source-recovery` while preserving unrelated dirty changes in `arbitrage-foundation`. Rebuild from that canonical branch, reload the matching extension, rerun a short smoke check, and verify `run.md` starts those exact artifacts.

Do not claim completion when an external provider/auth service is unavailable. Report that provider as externally blocked with truthful `ACTION_REQUIRED`; the system correctness gate may pass, but the six-of-six realtime gate remains failed until a live authoritative baseline and transition verification succeed.
