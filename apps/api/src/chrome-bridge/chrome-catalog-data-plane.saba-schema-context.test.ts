import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { ChromeCatalogDataPlane, type ChromeCatalogIngestContext } from "./chrome-catalog-data-plane.js";
import { ProviderAuthorityCoordinator } from "./provider-authority-coordinator.js";
import { ProviderFeedRegistry } from "./provider-feed-registry.js";
import type { AuthorityEvidenceClass, AuthorityIdentity } from "./provider-authority-types.js";
import type { PipelineTelemetry } from "../diagnostics/pipeline-telemetry.js";

const ACCOUNT_ID = "catalog-source:SABA:FOOTBALL";
const SOURCE_ID = "chrome:SABA:7";
const SOURCE_EPOCH = "worker-a:0";
const NOW = 100_100;

const fields = ["type", "leagueid", "leaguenameen", "sporttype", "matchid", "hteamnameen",
  "ateamnameen", "kickofftime", "marketid", "oddsid", "bettype", "parenttypeid", "oddsstatus",
  "enable", "odds1a", "odds2a", "hdp1", "hdp2"];

function identity(sourceEpoch = SOURCE_EPOCH): AuthorityIdentity {
  return { accountId: ACCOUNT_ID, sourceId: SOURCE_ID, sourceEpoch, connectionGeneration: 1 };
}

function context(coordinator: ProviderAuthorityCoordinator, evidence: AuthorityEvidenceClass,
  sourceEpoch = SOURCE_EPOCH): ChromeCatalogIngestContext {
  const authorityIdentity = identity(sourceEpoch);
  return { connectionGeneration: 1, authorityIdentity,
    authorityObservation: coordinator.observe(authorityIdentity, evidence) };
}

function socketEnvelope(sequence: number, body: string, transport: "WS_FRAME" | "WS_STATE" = "WS_FRAME",
  streamId = "1", sourceEpoch = SOURCE_EPOCH): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: SOURCE_ID, tabId: 7,
    sourceEpoch, sequence, observedAtMs: 100_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport, request: { hostname: "sports.example", pathnameClass: "/socket.io/",
      resourceType: "WebSocket", streamId }, payload: { encoding: "UTF8", body } };
}

function openEnvelope(sequence = 1, streamId = "1"): ChromeBridgeEnvelope {
  return socketEnvelope(sequence, '{"state":"OPEN"}', "WS_STATE", streamId);
}

function schemaEnvelope(sequence: number, rows: readonly unknown[] = [["f", 0, fields]],
  options: { readonly streamId?: string; readonly sourceEpoch?: string; readonly replayed?: boolean;
    readonly lobby?: ChromeBridgeEnvelope["lobby"] } = {}): ChromeBridgeEnvelope {
  const lobby = options.lobby ?? "SABA";
  const sourceId = lobby === "SABA" ? SOURCE_ID : `chrome:${lobby}:7`;
  return { version: 1, kind: "NETWORK", lobby, sourceId, tabId: 7,
    sourceEpoch: options.sourceEpoch ?? SOURCE_EPOCH, sequence,
    observedAtMs: 100_000 + sequence, receivedMonotonicMs: 50 + sequence, transport: "TAB_STATE",
    request: { hostname: "sports.example", pathnameClass: "/__fieldline_saba_schema_context__",
      resourceType: "Diagnostic", streamId: options.streamId ?? "1",
      ...(options.replayed === true ? { replayed: true } : {}) },
    payload: { encoding: "UTF8", body: JSON.stringify({ kind: "SABA_SCHEMA_CONTEXT", bridgeId: "b1",
      rows, revision: null }) } };
}

function encode(record: Readonly<Record<string, unknown>>): readonly unknown[] {
  return Object.entries(record).flatMap(([key, value]) => [fields.indexOf(key), value]);
}

function catalogRows(matchId = 2): readonly unknown[] {
  return [
    encode({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
    encode({ type: "m", matchid: matchId, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
      kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
    encode({ type: "o", oddsid: matchId + 1, matchid: matchId, bettype: 1, parenttypeid: 1,
      oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 })
  ];
}

function fieldlessFrame(sequence: number, rows: readonly unknown[], bridgeId = "b1"): ChromeBridgeEnvelope {
  return socketEnvelope(sequence, `42${JSON.stringify(["m", bridgeId, rows, `revision-${sequence}`])}`);
}

function fieldlessBaseline(sequence: number, matchId = 2, bridgeId = "b1"): ChromeBridgeEnvelope {
  return fieldlessFrame(sequence, [[0, "reset"], ...catalogRows(matchId), [0, "done"]], bridgeId);
}

describe("ChromeCatalogDataPlane SABA schema context", () => {
  it("seeds only an existing candidate lane and publishes only the later fieldless reset/done baseline", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const feeds = new ProviderFeedRegistry({ now: () => NOW });
    const publish = vi.fn();
    const telemetry = { recordEnvelope: vi.fn(), recordEnvelopeRejected: vi.fn(),
      recordAdapterIgnored: vi.fn(), recordAdapterDecoded: vi.fn(), recordAdapterRejected: vi.fn(),
      recordCatalog: vi.fn() } as unknown as PipelineTelemetry;
    const plane = new ChromeCatalogDataPlane({ now: () => NOW, authorityCoordinator: coordinator,
      feedRegistry: feeds, publish, telemetry });

    expect(plane.ingest(openEnvelope(), context(coordinator, "TRANSPORT"))).toBe(false);
    vi.clearAllMocks();
    const authorityBefore = coordinator.snapshot(ACCOUNT_ID);
    const feedBefore = feeds.snapshot(ACCOUNT_ID);
    const schemaContext = context(coordinator, "TRANSPORT");
    const observe = vi.spyOn(coordinator, "observe");

    expect(plane.ingest(schemaEnvelope(2), schemaContext)).toBe(false);
    expect(observe).not.toHaveBeenCalled();
    expect(telemetry.recordEnvelope).not.toHaveBeenCalled();
    expect(telemetry.recordEnvelopeRejected).not.toHaveBeenCalled();
    expect(coordinator.snapshot(ACCOUNT_ID)).toEqual(authorityBefore);
    expect(feeds.snapshot(ACCOUNT_ID)).toEqual(feedBefore);
    expect(publish).not.toHaveBeenCalled();
    await expect(plane.read(ACCOUNT_ID)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    observe.mockRestore();
    expect(plane.ingest(fieldlessBaseline(3), context(coordinator, "CANDIDATE_DATA"))).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    await expect(plane.read(ACCOUNT_ID)).resolves.toMatchObject({ provider: "SABA",
      events: [expect.objectContaining({ providerEventId: "2" })] });
  });

  it("does not let schema or a fieldless delta establish baseline authority", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => NOW, authorityCoordinator: coordinator, publish });

    plane.ingest(openEnvelope(), context(coordinator, "TRANSPORT"));
    expect(plane.ingest(schemaEnvelope(2), context(coordinator, "TRANSPORT"))).toBe(false);
    expect(plane.ingest(fieldlessFrame(3, catalogRows()), context(coordinator, "CANDIDATE_DATA"))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    await expect(plane.read(ACCOUNT_ID)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    expect(plane.ingest(fieldlessBaseline(4), context(coordinator, "CANDIDATE_DATA"))).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("retains the seeded adapter reference when the candidate pipeline is promoted", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => NOW, authorityCoordinator: coordinator, publish });

    plane.ingest(openEnvelope(), context(coordinator, "TRANSPORT"));
    plane.ingest(schemaEnvelope(2), context(coordinator, "TRANSPORT"));
    expect(plane.ingest(fieldlessBaseline(3), context(coordinator, "CANDIDATE_DATA"))).toBe(true);
    expect(coordinator.snapshot(ACCOUNT_ID)).toMatchObject({ active: identity(), candidate: null });

    const activeContext = context(coordinator, "TRANSPORT");
    const secondSchema = { ...schemaEnvelope(4), payload: { encoding: "UTF8" as const,
      body: JSON.stringify({ kind: "SABA_SCHEMA_CONTEXT", bridgeId: "b2",
        rows: [["f", 0, fields]], revision: null }) } };
    expect(plane.ingest(secondSchema, activeContext)).toBe(false);
    expect(plane.ingest(fieldlessBaseline(5, 4, "b2"), context(coordinator, "CANDIDATE_DATA"))).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("does not allocate or poison a pipeline from unknown, replayed, mismatched, or malformed context", async () => {
    const unknownCoordinator = new ProviderAuthorityCoordinator();
    const unknownPublish = vi.fn();
    const unknownPlane = new ChromeCatalogDataPlane({ now: () => NOW,
      authorityCoordinator: unknownCoordinator, publish: unknownPublish });

    // A context receipt alone must not allocate the candidate decoder pipeline.
    expect(unknownPlane.ingest(schemaEnvelope(1), context(unknownCoordinator, "TRANSPORT"))).toBe(false);
    unknownPlane.ingest(openEnvelope(2), context(unknownCoordinator, "TRANSPORT"));
    expect(unknownPlane.ingest(fieldlessBaseline(3), context(unknownCoordinator, "CANDIDATE_DATA"))).toBe(false);
    expect(unknownPublish).not.toHaveBeenCalled();

    const coordinator = new ProviderAuthorityCoordinator();
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => NOW, authorityCoordinator: coordinator, publish });
    plane.ingest(openEnvelope(), context(coordinator, "TRANSPORT"));

    expect(plane.ingest(schemaEnvelope(4, [["f", 0, fields], [0, "reset"]]),
      context(coordinator, "TRANSPORT"))).toBe(false);
    expect(plane.ingest(schemaEnvelope(5, undefined, { replayed: true }),
      context(coordinator, "TRANSPORT"))).toBe(false);
    expect(plane.ingest(schemaEnvelope(6, undefined, { streamId: "2" }),
      context(coordinator, "TRANSPORT"))).toBe(false);
    expect(plane.ingest(schemaEnvelope(7, undefined, { sourceEpoch: "worker-a:1" }),
      context(coordinator, "TRANSPORT"))).toBe(false);
    expect(plane.ingest(schemaEnvelope(8, undefined, { lobby: "CMD" }),
      context(coordinator, "TRANSPORT"))).toBe(false);
    expect(plane.ingest({ ...schemaEnvelope(9), observedAtMs: 1 },
      context(coordinator, "TRANSPORT"))).toBe(false);
    expect(publish).not.toHaveBeenCalled();

    // Atomic rejection left the current decoder seedable and usable.
    expect(plane.ingest(schemaEnvelope(10), context(coordinator, "TRANSPORT"))).toBe(false);
    expect(plane.ingest(fieldlessBaseline(11), context(coordinator, "CANDIDATE_DATA"))).toBe(true);
    await expect(plane.read(ACCOUNT_ID)).resolves.toMatchObject({ events: expect.any(Array) });
  });
});
