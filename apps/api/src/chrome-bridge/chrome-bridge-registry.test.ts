import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { ChromeBridgeRegistry } from "./chrome-bridge-registry.js";
import type { CatalogCommitProof } from "./provider-authority-types.js";

function proof(cursor: bigint): CatalogCommitProof {
  return {
    authorityCursor: cursor, provenance: "WS", contentClass: "FOOTBALL", completeness: "COMPLETE",
    scope: "ACCOUNT", completedPartitions: ["SABA"], emptyProof: "PROVIDER_CONFIRMED_EMPTY",
    catalog: { dataMode: "LIVE", accountId: "catalog-source:SABA:FOOTBALL", provider: "SABA",
      category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: Number(cursor),
      rejectedMarketCount: 0, events: [], markets: [], quotes: [] }
  };
}

function envelope(sequence: number, sourceId = "chrome:SABA:7"): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "SABA", sourceId, tabId: 7, sequence,
    observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport: "WS_FRAME",
    request: { hostname: "sports.example", pathnameClass: "/feed", resourceType: "WebSocket" },
    payload: { encoding: "UTF8", body: "{}" }
  };
}

describe("ChromeBridgeRegistry", () => {
  it("ACKs transport while keeping active and candidate records proof-fenced", () => {
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    const firstConnection = {};
    const candidateConnection = {};
    const replayConnection = {};
    const observed = vi.fn();
    registry.subscribe(observed);

    expect(registry.ingest({ ...envelope(0), sourceEpoch: "observer-a:0" }, firstConnection))
      .toMatchObject({ kind: "ACK" });
    const firstToken = registry.authorityCoordinator.snapshot("catalog-source:SABA:FOOTBALL").candidateToken!;
    expect(registry.authorityCoordinator.promote(firstToken, proof(1n))).toMatchObject({ promoted: true });
    expect(registry.listSources()).toEqual([expect.objectContaining({
      sourceId: "chrome:SABA:7", authorityDisposition: "ACTIVE"
    })]);

    const next = { ...envelope(0, "chrome:SABA:8"), tabId: 8, sourceEpoch: "observer-b:0" };
    expect(registry.ingest(next, candidateConnection)).toMatchObject({ kind: "ACK" });
    expect(registry.listSources()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "chrome:SABA:7", authorityDisposition: "ACTIVE" }),
      expect.objectContaining({ sourceId: "chrome:SABA:8", authorityDisposition: "CANDIDATE" })
    ]));

    expect(registry.ingest({ ...envelope(0, "chrome:SABA:9"), tabId: 9,
      sourceEpoch: "observer-replay:0", request: { ...envelope(0).request, replayed: true } }, replayConnection))
      .toMatchObject({ kind: "ACK" });
    expect(registry.listSources()).toHaveLength(2);
    expect(observed).toHaveBeenCalledTimes(2);

    const nextToken = registry.authorityCoordinator.snapshot("catalog-source:SABA:FOOTBALL").candidateToken!;
    registry.authorityCoordinator.promote(nextToken, proof(2n));
    registry.releaseConnection(firstConnection);
    expect(registry.listSources()).toEqual([expect.objectContaining({
      sourceId: "chrome:SABA:8", authorityDisposition: "ACTIVE"
    })]);
  });

  it("accepts ordered envelopes, publishes them, and ACKs exact sequence", () => {
    const accepted = vi.fn();
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    registry.subscribe(accepted);
    expect(registry.ingest(envelope(0))).toEqual({
      version: 1, kind: "ACK", sourceId: "chrome:SABA:7", sequence: 0
    });
    expect(registry.ingest(envelope(1))).toMatchObject({ kind: "ACK", sequence: 1 });
    expect(accepted).toHaveBeenCalledTimes(2);
    expect(registry.listSources()).toMatchObject([{ lobby: "SABA", sourceId: "chrome:SABA:7", state: "LIVE", lastSequence: 1 }]);
  });

  it("uses the first observed sequence as a baseline after an API restart", () => {
    const accepted = vi.fn();
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    registry.subscribe(accepted);

    expect(registry.ingest(envelope(41))).toMatchObject({ kind: "ACK", sequence: 41 });
    expect(registry.ingest(envelope(42))).toMatchObject({ kind: "ACK", sequence: 42 });
    expect(registry.ingest(envelope(44))).toMatchObject({ kind: "REJECT", reason: "SEQUENCE_GAP" });
    expect(accepted).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicates, lower sequence, and quarantines a sequence gap without publishing", () => {
    const accepted = vi.fn();
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    registry.subscribe(accepted);
    registry.ingest(envelope(0));
    expect(registry.ingest(envelope(0))).toMatchObject({ kind: "REJECT", reason: "DUPLICATE" });
    expect(registry.ingest(envelope(2))).toMatchObject({ kind: "REJECT", reason: "SEQUENCE_GAP" });
    expect(registry.ingest(envelope(1))).toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(registry.listSources()).toMatchObject([{ state: "ERROR", reason: "SEQUENCE_GAP" }]);
  });

  it("isolates source failures and derives stale status from accepted receipt time", () => {
    let now = 1_000;
    const registry = new ChromeBridgeRegistry({ now: () => now, staleAfterMs: 20_000 });
    registry.ingest(envelope(0, "chrome:SABA:7"));
    registry.ingest({ ...envelope(0, "chrome:IM:8"), lobby: "IM", tabId: 8 });
    registry.ingest({ ...envelope(2, "chrome:SABA:7") });
    now = 21_001;
    expect(registry.listSources()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "chrome:SABA:7", state: "ERROR" }),
      expect.objectContaining({ sourceId: "chrome:IM:8", state: "STALE" })
    ]));
  });

  it("re-baselines a source on a new authenticated bridge connection", () => {
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    const firstConnection = {};
    const replacementConnection = {};
    expect(registry.ingest(envelope(40), firstConnection)).toMatchObject({ kind: "ACK", sequence: 40 });
    expect(registry.ingest(envelope(42), firstConnection)).toMatchObject({ kind: "REJECT", reason: "SEQUENCE_GAP" });
    expect(registry.ingest(envelope(0), replacementConnection)).toMatchObject({ kind: "ACK", sequence: 0 });
    expect(registry.ingest(envelope(1), replacementConnection)).toMatchObject({ kind: "ACK", sequence: 1 });
    expect(registry.listSources()).toMatchObject([{ state: "LIVE", lastSequence: 1, reason: null }]);
  });

  it("never lets a superseded bridge connection reclaim its source", () => {
    const accepted = vi.fn();
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    const firstConnection = {};
    const replacementConnection = {};
    registry.subscribe(accepted);

    expect(registry.ingest({ ...envelope(40), sourceEpoch: "worker-a:0" }, firstConnection))
      .toMatchObject({ kind: "ACK" });
    expect(registry.ingest({ ...envelope(0), sourceEpoch: "worker-b:0" }, replacementConnection))
      .toMatchObject({ kind: "ACK" });
    expect(registry.ingest({ ...envelope(41), sourceEpoch: "worker-a:1" }, firstConnection))
      .toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
    expect(accepted).toHaveBeenCalledTimes(2);
    expect(registry.listSources()).toMatchObject([{ lastSequence: 0 }]);
  });

  it("orders connection authority when the bridge authenticates, not when its first envelope arrives", () => {
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    const silentOlderConnection = {};
    const currentConnection = {};
    registry.registerConnection(silentOlderConnection);
    registry.registerConnection(currentConnection);

    expect(registry.ingest({ ...envelope(0), sourceEpoch: "observer-a:0" }, currentConnection))
      .toMatchObject({ kind: "ACK" });
    expect(registry.ingest({ ...envelope(0, "chrome:SABA:8"), tabId: 8,
      sourceEpoch: "observer-a:999" }, silentOlderConnection))
      .toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
    expect(registry.listSources()).toEqual([expect.objectContaining({
      sourceId: "chrome:SABA:7", lastSequence: 0
    })]);
  });

  it("does not revoke a silent incumbent merely because another socket authenticates", () => {
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    const olderConnection = {};
    const replacementConnection = {};
    registry.registerConnection(olderConnection);
    expect(registry.ingest({ ...envelope(0), sourceEpoch: "observer-a:0" }, olderConnection))
      .toMatchObject({ kind: "ACK" });
    expect(registry.ingest({ ...envelope(0, "chrome:IM:8"), lobby: "IM", tabId: 8,
      sourceEpoch: "observer-a:1" }, olderConnection)).toMatchObject({ kind: "ACK" });

    registry.registerConnection(replacementConnection);

    expect(registry.listSources()).toHaveLength(2);
    expect(registry.ingest({ ...envelope(1), sourceEpoch: "observer-a:2" }, olderConnection))
      .toMatchObject({ kind: "ACK" });
    expect(registry.ingest({ ...envelope(0), sourceEpoch: "observer-b:0" }, replacementConnection))
      .toMatchObject({ kind: "ACK" });
    expect(registry.ingest({ ...envelope(2), sourceEpoch: "observer-a:2" }, olderConnection))
      .toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
  });

  it("keeps the six provider owners bounded when unproven source IDs flood one account", () => {
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    const connection = {};
    const providers = ["CMD", "IM", "SABA", "KSPORT", "TSPORT", "BTI"] as const;
    for (const [index, lobby] of providers.entries()) {
      const sourceId = `chrome:${lobby}:${index + 1}`;
      expect(registry.ingest({ ...envelope(0, sourceId), lobby, tabId: index + 1,
        sourceEpoch: `observer-a:${index}` }, connection)).toMatchObject({ kind: "ACK" });
    }

    for (let index = 0; index < 1_000; index += 1) {
      expect(registry.ingest({ ...envelope(0, `chrome:SABA:noise-${index}`), sourceEpoch: "observer-a:2" },
        connection)).toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
    }
    expect(registry.listSources()).toHaveLength(6);
    expect(registry.listSources()).toContainEqual(expect.objectContaining({
      lobby: "SABA", sourceId: "chrome:SABA:3"
    }));
  });

  it("compacts ordered source churn to one account owner and rejects the oldest source", () => {
    const accepted = vi.fn();
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    const connection = {};
    registry.subscribe(accepted);
    for (let ordinal = 0; ordinal < 1_000; ordinal += 1) {
      expect(registry.ingest({ ...envelope(0, `chrome:SABA:${ordinal + 7}`), tabId: ordinal + 7,
        sourceEpoch: `observer-a:${ordinal}` }, connection)).toMatchObject({ kind: "ACK" });
    }

    expect(registry.listSources()).toEqual([expect.objectContaining({
      sourceId: "chrome:SABA:1006", lastSequence: 0
    })]);
    expect(registry.ingest({ ...envelope(1, "chrome:SABA:7"), sourceEpoch: "observer-a:0" }, connection))
      .toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
    expect(accepted).toHaveBeenCalledTimes(1_000);
  });

  it("evicts retired tab sources instead of retaining their server state forever", () => {
    let now = 1_000;
    const registry = new ChromeBridgeRegistry({
      now: () => now, staleAfterMs: 20_000, retireAfterMs: 300_000
    });
    registry.ingest(envelope(0, "chrome:SABA:old-tab"));
    now = 301_001;

    expect(registry.listSources()).toEqual([]);
  });

  it("requires a newer authenticated connection generation to reclaim a retired owner", () => {
    let now = 1_000;
    const registry = new ChromeBridgeRegistry({ now: () => now, retireAfterMs: 100 });
    const retiredConnection = {};
    const replacementConnection = {};

    expect(registry.ingest({ ...envelope(0), sourceEpoch: "observer-a:0" }, retiredConnection))
      .toMatchObject({ kind: "ACK" });
    now = 1_101;
    expect(registry.listSources()).toEqual([]);

    expect(registry.ingest({ ...envelope(0, "chrome:SABA:8"), tabId: 8,
      sourceEpoch: "observer-a:1" }, retiredConnection))
      .toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
    expect(registry.ingest({ ...envelope(0, "chrome:SABA:8"), tabId: 8,
      sourceEpoch: "observer-a:1" }, replacementConnection))
      .toMatchObject({ kind: "ACK" });
    expect(registry.listSources()).toEqual([expect.objectContaining({
      sourceId: "chrome:SABA:8", lastSequence: 0
    })]);
  });

  it("requires a newer connection generation after an explicit connection release", () => {
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    const releasedConnection = {};
    const replacementConnection = {};
    expect(registry.ingest({ ...envelope(0), sourceEpoch: "observer-a:0" }, releasedConnection))
      .toMatchObject({ kind: "ACK" });
    registry.releaseConnection(releasedConnection);

    expect(registry.ingest({ ...envelope(0, "chrome:SABA:8"), tabId: 8,
      sourceEpoch: "observer-a:1" }, releasedConnection))
      .toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
    expect(registry.ingest({ ...envelope(0, "chrome:SABA:8"), tabId: 8,
      sourceEpoch: "observer-a:1" }, replacementConnection))
      .toMatchObject({ kind: "ACK" });
  });

  it("releases every source owned by a closed bridge connection", () => {
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    const connection = {};
    registry.ingest(envelope(0, "chrome:SABA:7"), connection);
    registry.ingest({ ...envelope(0, "chrome:IM:8"), lobby: "IM", tabId: 8 }, connection);

    registry.releaseConnection(connection);

    expect(registry.listSources()).toEqual([]);
  });
});
