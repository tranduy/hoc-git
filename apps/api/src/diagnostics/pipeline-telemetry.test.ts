import type { CatalogSourceStatus, ChromeBridgeEnvelope, ProviderQuote } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import type { StoredCatalogRevision } from "../catalog/catalog-revision-store.js";
import type { ChromeBridgeSourceSnapshot } from "../chrome-bridge/chrome-bridge-registry.js";
import type { AuthoritySlotSnapshot } from "../chrome-bridge/provider-authority-types.js";
import type { ProviderFeedSnapshot } from "../chrome-bridge/provider-feed-types.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { PipelineTelemetry, PIPELINE_TELEMETRY_LIMITS, type PipelineTelemetryReaders } from "./pipeline-telemetry.js";

const accountId = "catalog-source:CMD:FOOTBALL" as const;

function envelope(sequence: number, observedAtMs: number): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:7", sourceEpoch: "worker-a:0",
    tabId: 7, sequence, observedAtMs, receivedMonotonicMs: observedAtMs,
    transport: "HTTP_RESPONSE", request: { hostname: "provider.example", pathnameClass: "/odds",
      resourceType: "XHR" }, payload: { encoding: "UTF8", body: "{}" }
  };
}

function quote(rawOdds: string, status: ProviderQuote["status"] = "OPEN", suffix = "home"): ProviderQuote {
  return {
    provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", providerMarketId: "market-1",
    providerSelectionId: suffix, marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME",
    line: "0.5", rawOdds, rawFormat: "MALAY", status, isLive: false, sourceTimestampMs: null,
    receivedMonotonicMs: 1, sequence: 1
  };
}

function catalog(observedAtMs: number, quotes: readonly ProviderQuote[]): ObservedProviderCatalog {
  return {
    dataMode: "LIVE", accountId, provider: "CMD", category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs, rejectedMarketCount: 0,
    events: [], markets: [], quotes
  };
}

function readers(revision: StoredCatalogRevision, feed: ProviderFeedSnapshot): PipelineTelemetryReaders {
  const sources: readonly ChromeBridgeSourceSnapshot[] = [{
    lobby: "CMD", sourceId: "chrome:CMD:7", tabId: 7, state: "LIVE", lastSequence: 2,
    lastAcceptedAtMs: 119_000, reason: null, authorityDisposition: "ACTIVE"
  }];
  const authorities: readonly AuthoritySlotSnapshot[] = [{
    accountId, active: { accountId, sourceId: "chrome:CMD:7", sourceEpoch: "worker-a:0",
      connectionGeneration: 1 }, candidate: null,
    activeLaneToken: { accountId, nonce: 1, phase: "ACTIVE" }, candidateLaneToken: null, candidateToken: null
  }];
  const statuses: readonly CatalogSourceStatus[] = [{
    id: accountId, alias: "CMD", provider: "CMD", category: "FOOTBALL", sessionState: "ACTIVE",
    acquiredAtMs: 119_000, reason: null
  }];
  return {
    listSources: () => sources, listAuthorities: () => authorities, listFeeds: () => [feed],
    listCatalogStatuses: async () => statuses, catalogRevision: (id) => id === accountId ? revision : undefined
  };
}

describe("PipelineTelemetry", () => {
  it.each([
    { accountId: "catalog-source:CMD:FOOTBALL", lobby: "CMD", transport: "HTTP_RESPONSE" },
    { accountId: "catalog-source:IM:FOOTBALL", lobby: "IM", transport: "HTTP_RESPONSE" },
    { accountId: "catalog-source:SABA:FOOTBALL", lobby: "SABA", transport: "WS_FRAME" },
    { accountId: "catalog-source:SBOBET:FOOTBALL", lobby: "KSPORT", transport: "WS_FRAME" },
    { accountId: "catalog-source:APSPORT:FOOTBALL", lobby: "TSPORT", transport: "WS_FRAME" },
    { accountId: "catalog-source:BTI:FOOTBALL", lobby: "BTI", transport: "HTTP_RESPONSE" }
  ] as const)("requires $transport rather than TAB_STATE at HOP3 for $accountId",
    async ({ accountId: providerAccountId, lobby, transport }) => {
      const telemetry = new PipelineTelemetry({ now: () => 120_000 });
      const sourceId = `chrome:${lobby}:7`;
      const makeEnvelope = (sequence: number, envelopeTransport: ChromeBridgeEnvelope["transport"]):
        ChromeBridgeEnvelope => ({
        version: 1, kind: "NETWORK", lobby, sourceId, sourceEpoch: "worker-transport:0", tabId: 7,
        sequence, observedAtMs: 110_000, receivedMonotonicMs: 110_000, transport: envelopeTransport,
        request: { hostname: "provider.example", pathnameClass: "/odds",
          resourceType: envelopeTransport === "WS_FRAME" ? "WebSocket" : "Tab" },
        payload: { encoding: "UTF8", body: "{}" }
      });
      const diagnosticReaders: PipelineTelemetryReaders = {
        listSources: () => [{ lobby, sourceId, tabId: 7, state: "LIVE", lastSequence: 2,
          lastAcceptedAtMs: 110_000, reason: null, authorityDisposition: "CANDIDATE" }],
        listAuthorities: () => [], listFeeds: () => [], listCatalogStatuses: async () => [],
        catalogRevision: () => undefined
      };

      telemetry.recordEnvelope(makeEnvelope(1, "TAB_STATE"), "worker-transport:0");
      const tabOnly = await telemetry.diagnostic(diagnosticReaders, providerAccountId);
      expect(tabOnly?.hops.find((hop) => hop.hop === "HOP3_ENVELOPE")?.ok).toBe(false);

      telemetry.recordEnvelope(makeEnvelope(2, transport), "worker-transport:0");
      const withRequiredTransport = await telemetry.diagnostic(diagnosticReaders, providerAccountId);
      expect(withRequiredTransport?.hops.find((hop) => hop.hop === "HOP3_ENVELOPE")?.ok).toBe(true);
    });

  it("reports exactly eight hops and the earliest failing hop", async () => {
    const telemetry = new PipelineTelemetry({ now: () => 120_000 });
    telemetry.recordEnvelope(envelope(1, 100_000), "worker-a:0");
    const feed: ProviderFeedSnapshot = {
      accountId, state: "STALLED", reason: "BASELINE_EXPIRED", sourceId: "chrome:CMD:7",
      sourceEpoch: "worker-a:0", tabReachableAtMs: 100_000, providerTransportAtMs: 100_000,
      lastAuthoritativeEvidenceAtMs: 100_000, lastCompleteBaselineAtMs: 100_000, lastDeltaAtMs: null,
      lastSemanticChangeAtMs: null, activeGeneration: "cmd:1", recoveryStage: "SOFT", recoveryAttempt: 2
    };
    telemetry.recordFeed(feed);
    const storedCatalog = catalog(100_000, [quote("0.83")]);
    const revision: StoredCatalogRevision = { accountId, catalog: storedCatalog, revision: "rev-1",
      observedAtMs: 100_000, snapshotState: "FRESH", sequence: 1, freshUntilMs: 130_000 };

    const result = await telemetry.diagnostic(readers(revision, feed), accountId);

    expect(result?.hops).toHaveLength(8);
    expect(result?.hops.map((hop) => hop.hop)).toEqual([
      "HOP1_TAB", "HOP2_ATTACH", "HOP3_ENVELOPE", "HOP4_ADAPTER", "HOP5_AUTHORITY", "HOP6_FEED",
      "HOP7_CATALOG", "HOP8_SEMANTIC"
    ]);
    expect(result?.firstFailingHop).toBe("HOP4_ADAPTER");
  });

  it("exposes bounded WS attach counters from TAB_STATE diagnostics", async () => {
    const telemetry = new PipelineTelemetry({ now: () => 120_000 });
    telemetry.recordEnvelope({ ...envelope(1, 100_000), transport: "TAB_STATE",
      request: { hostname: "provider.invalid", pathnameClass: "/__fieldline_heartbeat__",
        resourceType: "Tab" },
      payload: { encoding: "UTF8", body: JSON.stringify({ kind: "WS_ATTACH", sourceGeneration: 3,
        webSocketCreated: 7, webSockets: 2, ksportTargets: 1, attachedTargets: 1 }) } }, "worker-a:0");
    const feed: ProviderFeedSnapshot = {
      accountId, state: "STARTING", reason: "BASELINE_REQUIRED", sourceId: "chrome:CMD:7",
      sourceEpoch: "worker-a:0", tabReachableAtMs: 100_000, providerTransportAtMs: null,
      lastAuthoritativeEvidenceAtMs: null, lastCompleteBaselineAtMs: null, lastDeltaAtMs: null,
      lastSemanticChangeAtMs: null, activeGeneration: null, recoveryStage: "NONE", recoveryAttempt: 0
    };
    const revision: StoredCatalogRevision = { accountId, catalog: catalog(100_000, []),
      revision: "rev-ws-attach", observedAtMs: 100_000, snapshotState: "STALE", sequence: 1,
      freshUntilMs: 100_000 };

    const result = await telemetry.diagnostic(readers(revision, feed), accountId);

    expect(result?.hops.find((hop) => hop.hop === "HOP3_ENVELOPE")?.detail.wsAttach).toEqual({
      sourceGeneration: 3, webSocketCreated: 7, webSockets: 2, ksportTargets: 1, attachedTargets: 1,
      framesReceived: 0, framesOrphan: 0, framesForwarded: 0, ignoredSockets: 0,
      framesBinary: 0, framesNotOwner: 0, framesUnattributed: 0, framesNotActiveStream: 0,
      framesDecoderFailed: 0, sockjsOpen: 0, sockjsHeartbeat: 0, sockjsArray: 0,
      sockjsClose: 0, sockjsOther: 0, decoderFailCode: "NONE",
      stompFrames: 0, stompMessages: 0, stompPartitionRejected: 0,
      stompPendingChars: 0, stompCommandFragments: 0, stompFragments: 0,
      destLiveLike: 0, destTodayLike: 0, destSportsLike: 0, subSportLike: 0,
      targetsTotal: 0, targetsIframe: 0, autoAttachEvents: 0
    });
  });

  it("keeps frame counters reported by a newer extension", async () => {
    // KSPORT's fault signature: frames arrive but none are forwarded. Without
    // these counters HOP3 only shows WS_FRAME 0, which cannot distinguish a
    // silent socket from frames dropped before forwarding.
    const telemetry = new PipelineTelemetry({ now: () => 120_000 });
    telemetry.recordEnvelope({ ...envelope(1, 100_000), transport: "TAB_STATE",
      request: { hostname: "provider.invalid", pathnameClass: "/__fieldline_heartbeat__",
        resourceType: "Tab" },
      payload: { encoding: "UTF8", body: JSON.stringify({ kind: "WS_ATTACH", sourceGeneration: 3,
        webSocketCreated: 7, webSockets: 2, ksportTargets: 1, attachedTargets: 1,
        framesReceived: 940, framesOrphan: 940, framesForwarded: 0,
        ignoredSockets: 12 }) } }, "worker-a:0");
    const feed: ProviderFeedSnapshot = {
      accountId, state: "STARTING", reason: "BASELINE_REQUIRED", sourceId: "chrome:CMD:7",
      sourceEpoch: "worker-a:0", tabReachableAtMs: 100_000, providerTransportAtMs: null,
      lastAuthoritativeEvidenceAtMs: null, lastCompleteBaselineAtMs: null, lastDeltaAtMs: null,
      lastSemanticChangeAtMs: null, activeGeneration: null, recoveryStage: "NONE", recoveryAttempt: 0
    };
    const revision: StoredCatalogRevision = { accountId, catalog: catalog(100_000, []),
      revision: "rev-ws-frames", observedAtMs: 100_000, snapshotState: "STALE", sequence: 1,
      freshUntilMs: 100_000 };

    const result = await telemetry.diagnostic(readers(revision, feed), accountId);

    expect(result?.hops.find((hop) => hop.hop === "HOP3_ENVELOPE")?.detail.wsAttach).toMatchObject({
      framesReceived: 940, framesOrphan: 940, framesForwarded: 0, ignoredSockets: 12
    });
  });

  it("counts only rawOdds or status changes and derives five-minute cadence percentiles", async () => {
    const telemetry = new PipelineTelemetry({ now: () => 120_000 });
    telemetry.recordEnvelope(envelope(1, 60_000), "worker-a:0");
    telemetry.recordAdapterDecoded(accountId, 60_000);
    telemetry.recordCatalog(catalog(60_000, [quote("0.83")]));
    telemetry.recordCatalog(catalog(70_000, [quote("0.83")]));
    telemetry.recordCatalog(catalog(80_000, [quote("0.75")]));
    telemetry.recordCatalog(catalog(90_000, [quote("0.75", "SUSPENDED")]));
    const feed = (atMs: number): ProviderFeedSnapshot => ({
      accountId, state: "LIVE", reason: null, sourceId: "chrome:CMD:7", sourceEpoch: "worker-a:0",
      tabReachableAtMs: atMs, providerTransportAtMs: atMs, lastAuthoritativeEvidenceAtMs: atMs,
      lastCompleteBaselineAtMs: atMs, lastDeltaAtMs: atMs, lastSemanticChangeAtMs: 90_000,
      activeGeneration: "cmd:1", recoveryStage: "NONE", recoveryAttempt: 0
    });
    for (const atMs of [60_000, 70_000, 90_000]) telemetry.recordFeed(feed(atMs));
    const liveFeed = feed(90_000);
    const storedCatalog = catalog(90_000, [quote("0.75", "SUSPENDED")]);
    const revision: StoredCatalogRevision = { accountId, catalog: storedCatalog, revision: "rev-2",
      observedAtMs: 90_000, snapshotState: "FRESH", sequence: 2, freshUntilMs: 130_000 };

    const result = await telemetry.diagnostic(readers(revision, liveFeed), accountId);
    const feedDetail = result?.hops.find((hop) => hop.hop === "HOP6_FEED")?.detail;
    const semantic = result?.hops.find((hop) => hop.hop === "HOP8_SEMANTIC")?.detail;

    expect(feedDetail?.observedEvidenceCadenceMs).toEqual({ p50: 10_000, p95: 20_000, samples: 2 });
    expect(semantic).toMatchObject({ quoteChanges60s: 2, quoteChanges300s: 2,
      sampleChange: { before: "OPEN", after: "SUSPENDED", atMs: 90_000 } });
  });

  it("reports a candidate tab at HOP1 while leaving authority failure to HOP5", async () => {
    const telemetry = new PipelineTelemetry({ now: () => 120_000 });
    const feed: ProviderFeedSnapshot = {
      accountId, state: "STARTING", reason: "BASELINE_REQUIRED", sourceId: null, sourceEpoch: null,
      tabReachableAtMs: null, providerTransportAtMs: null, lastAuthoritativeEvidenceAtMs: null,
      lastCompleteBaselineAtMs: null, lastDeltaAtMs: null, lastSemanticChangeAtMs: null,
      activeGeneration: null, recoveryStage: "NONE", recoveryAttempt: 0
    };
    const revision: StoredCatalogRevision = { accountId, catalog: catalog(100_000, [quote("0.83")]),
      revision: "rev-candidate", observedAtMs: 100_000, snapshotState: "STALE", sequence: 1,
      freshUntilMs: 100_000 };
    const base = readers(revision, feed);
    const candidateSource: ChromeBridgeSourceSnapshot = {
      lobby: "CMD", sourceId: "chrome:CMD:8", tabId: 8, state: "LIVE", lastSequence: 1,
      lastAcceptedAtMs: 119_000, reason: null, authorityDisposition: "CANDIDATE"
    };
    const candidateAuthority: AuthoritySlotSnapshot = {
      accountId, active: null, candidate: { accountId, sourceId: candidateSource.sourceId,
        sourceEpoch: "worker-b:0", connectionGeneration: 2 }, activeLaneToken: null,
      candidateLaneToken: { accountId, nonce: 2, phase: "CANDIDATE" },
      candidateToken: { accountId, nonce: 2 }
    };

    const result = await telemetry.diagnostic({ ...base, listSources: () => [candidateSource],
      listAuthorities: () => [candidateAuthority] }, accountId);
    const hop1 = result?.hops.find((hop) => hop.hop === "HOP1_TAB");
    const hop5 = result?.hops.find((hop) => hop.hop === "HOP5_AUTHORITY");

    expect(hop1).toMatchObject({ ok: true, detail: { sourceId: "chrome:CMD:8", tabId: 8,
      authorityDisposition: "CANDIDATE" } });
    expect(hop5).toMatchObject({ ok: false, detail: { authorityDisposition: "NONE" } });
  });

  it("enforces hard bucket and selection memory ceilings", () => {
    let nowMs = 0;
    const telemetry = new PipelineTelemetry({ now: () => nowMs });
    for (let index = 0; index < 100; index += 1) {
      nowMs = index * PIPELINE_TELEMETRY_LIMITS.bucketMs;
      telemetry.recordAdapterIgnored(accountId, nowMs);
    }
    const manyQuotes = Array.from({ length: PIPELINE_TELEMETRY_LIMITS.maxSelectionsPerAccount + 100 },
      (_, index) => quote("0.83", "OPEN", String(index)));
    telemetry.recordCatalog(catalog(nowMs, manyQuotes));

    expect(telemetry.storageStats()).toEqual({
      buckets: PIPELINE_TELEMETRY_LIMITS.maxBucketsPerAccount,
      selections: PIPELINE_TELEMETRY_LIMITS.maxSelectionsPerAccount
    });
  });
});
