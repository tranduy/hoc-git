import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkBodyAssembler } from "./network-body-assembler.js";

function envelope(index: number, count = 2, fragment = index === 0 ? "{\"StatusCode\":" : "100}",
  snapshotId = "network-8-request-abcdef"): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "IM", sourceId: "chrome:IM:8", tabId: 8, sequence: index,
    observedAtMs: 1_000, receivedMonotonicMs: 50, transport: "HTTP_RESPONSE",
    request: { hostname: "imsports.directsb.net", pathnameClass: "/api/EventV6/GetSE", resourceType: "XHR" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1,
      snapshotId, chunkIndex: index, chunkCount: count,
      bodyEncoding: "UTF8", bodyFragment: fragment }) }
  };
}

describe("NetworkBodyAssembler", () => {
  it("returns an HTTP envelope only after every ordered chunk arrives", () => {
    const assembler = new NetworkBodyAssembler();
    expect(assembler.ingest(envelope(0))).toBeNull();
    expect(assembler.ingest(envelope(1))).toMatchObject({
      lobby: "IM", transport: "HTTP_RESPONSE", payload: { encoding: "UTF8", body: "{\"StatusCode\":100}" }
    });
  });

  it("fails closed when chunk metadata conflicts", () => {
    const assembler = new NetworkBodyAssembler();
    expect(assembler.ingest(envelope(0))).toBeNull();
    expect(assembler.ingest({ ...envelope(1), request: { ...envelope(1).request, pathnameClass: "/wrong" } })).toBeNull();
    expect(assembler.ingest(envelope(1))).toBeNull();
  });

  it.each([
    ["replayed first", { first: true, second: undefined }],
    ["replayed final", { first: undefined, second: true }]
  ])("rejects and quarantines a body with %s instead of laundering replay authority",
    (_label, replayed) => {
      const assembler = new NetworkBodyAssembler();
      const first = envelope(0);
      const second = envelope(1);

      expect(assembler.ingest({ ...first, request: { ...first.request,
        ...(replayed.first === undefined ? {} : { replayed: replayed.first }) } })).toBeNull();
      expect(assembler.ingest({ ...second, request: { ...second.request,
        ...(replayed.second === undefined ? {} : { replayed: replayed.second }) } })).toBeNull();

      // A mismatch discards the entire response identity. Replaying either
      // missing fragment cannot resurrect that poisoned body.
      expect(assembler.ingest(first)).toBeNull();
      expect(assembler.ingest(second)).toBeNull();
    });

  it.each([
    ["source epoch", (value: ChromeBridgeEnvelope) => ({ ...value, sourceEpoch: "worker-b:1" })],
    ["tab identity", (value: ChromeBridgeEnvelope) => ({ ...value, tabId: 9 })],
    ["provider partition", (value: ChromeBridgeEnvelope) => ({ ...value,
      request: { ...value.request, providerPartition: "IM_MARKET_2" as const } })],
    ["provider function", (value: ChromeBridgeEnvelope) => ({ ...value,
      request: { ...value.request, providerFunctionCode: 2 } })],
    ["request generation", (value: ChromeBridgeEnvelope) => ({ ...value,
      request: { ...value.request, streamId: "im:8:2" } })],
    ["reconciliation cutoff", (value: ChromeBridgeEnvelope) => ({ ...value,
      request: { ...value.request, reconcileCutoffSequence: 9 } })],
    ["observation clock", (value: ChromeBridgeEnvelope) => ({ ...value, observedAtMs: 9_999 })],
    ["monotonic clock", (value: ChromeBridgeEnvelope) => ({ ...value, receivedMonotonicMs: 9_999 })]
  ])("binds %s across every chunk", (_label, mutate) => {
    const assembler = new NetworkBodyAssembler();
    expect(assembler.ingest(envelope(0))).toBeNull();
    expect(assembler.ingest(mutate(envelope(1)))).toBeNull();
    expect(assembler.ingest(envelope(1))).toBeNull();
  });

  it("bounds 5,000 incomplete bodies without starving an independent provider", () => {
    const assembler = new NetworkBodyAssembler({
      now: () => 1_000, ttlMs: 100,
      maxPendingBodiesPerSource: 2, maxPendingBodies: 12,
      maxPendingBytesPerSource: 32, maxPendingBytes: 192,
      maxBodyBytes: 16, maxQuarantinedBodiesPerSource: 2, maxQuarantinedBodies: 12
    });
    for (let index = 0; index < 5_000; index += 1) {
      expect(assembler.ingest({ ...envelope(0, 2, "a", `network-request-${index}`),
        sourceEpoch: "worker-a:0" })).toBeNull();
    }
    expect(assembler.stats()).toMatchObject({
      pendingBodies: expect.any(Number), pendingBytes: expect.any(Number), blockedSourceEpochs: 1
    });
    expect(assembler.stats().pendingBodies).toBeLessThanOrEqual(2);
    expect(assembler.stats().pendingBytes).toBeLessThanOrEqual(32);

    const providerB = (chunkIndex: number) => ({ ...envelope(chunkIndex, 2,
      chunkIndex === 0 ? "B" : "!", "network-provider-b"), lobby: "BTI" as const,
      sourceId: "chrome:BTI:9", sourceEpoch: "worker-b:0", tabId: 9,
      request: { ...envelope(chunkIndex).request, hostname: "bti.example" } });
    expect(assembler.ingest(providerB(0))).toBeNull();
    expect(assembler.ingest(providerB(1))).toMatchObject({ payload: { body: "B!" } });

    // Overflow quarantines cannot be completed by a late missing fragment.
    expect(assembler.ingest({ ...envelope(1, 2, "z", "network-request-4999"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    // A strictly newer canonical epoch can recover without affecting provider B.
    expect(assembler.ingest({ ...envelope(0, 2, "O", "network-recovery-1"),
      sourceEpoch: "worker-a:1" })).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "K", "network-recovery-1"),
      sourceEpoch: "worker-a:1" })).toMatchObject({ payload: { body: "OK" } });
  });

  it("expires partial bodies lazily and prevents their late remainder from resurrecting them", () => {
    let now = 0;
    const assembler = new NetworkBodyAssembler({ now: () => now, ttlMs: 100 });
    expect(assembler.ingest(envelope(0, 2, "old-", "network-expiring-1"))).toBeNull();
    now = 101;
    expect(assembler.ingest(envelope(1, 2, "body", "network-expiring-1"))).toBeNull();
    expect(assembler.ingest(envelope(0, 2, "old-", "network-expiring-1"))).toBeNull();
    expect(assembler.stats().pendingBodies).toBe(0);

    now = 10_000;
    expect(assembler.ingest(envelope(0, 2, "old-", "network-expiring-1"))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "body", "network-expiring-1"))).toBeNull();

    expect(assembler.ingest(envelope(0, 2, "new-", "network-fresh-body"))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "body", "network-fresh-body")))
      .toMatchObject({ payload: { body: "new-body" } });
  });

  it("rejects bodies that exceed per-body or byte-pool limits and never completes them later", () => {
    const assembler = new NetworkBodyAssembler({
      maxBodyBytes: 5, maxPendingBytesPerSource: 6, maxPendingBytes: 36
    });
    expect(assembler.ingest(envelope(0, 2, "1234", "network-oversize-1"))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "5678", "network-oversize-1"))).toBeNull();
    expect(assembler.ingest(envelope(0, 2, "1234", "network-oversize-1"))).toBeNull();
    expect(assembler.stats().pendingBytes).toBe(0);

    const other = (index: number) => ({ ...envelope(index, 2, index === 0 ? "A" : "B",
      "network-other-byte"), lobby: "BTI" as const, sourceId: "chrome:BTI:9", tabId: 9,
      request: { ...envelope(index).request, hostname: "bti.example" } });
    expect(assembler.ingest(other(0))).toBeNull();
    expect(assembler.ingest(other(1))).toMatchObject({ payload: { body: "AB" } });
  });
});
