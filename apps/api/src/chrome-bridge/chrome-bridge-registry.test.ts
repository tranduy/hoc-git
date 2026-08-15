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
});
