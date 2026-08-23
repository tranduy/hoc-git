import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { ChromeBridgeRegistry } from "./chrome-bridge-registry.js";

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

  it("releases every source owned by a closed bridge connection", () => {
    const registry = new ChromeBridgeRegistry({ now: () => 2_000 });
    const connection = {};
    registry.ingest(envelope(0, "chrome:SABA:7"), connection);
    registry.ingest({ ...envelope(0, "chrome:IM:8"), lobby: "IM", tabId: 8 }, connection);

    registry.releaseConnection(connection);

    expect(registry.listSources()).toEqual([]);
  });
});
