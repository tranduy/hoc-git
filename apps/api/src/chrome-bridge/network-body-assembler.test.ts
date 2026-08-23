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

function ksportEnvelope(index: number, count = 2, fragment = index === 0 ? "live-" : "body",
  snapshotId = "network-ksport-request-1", requestStartSequence = 10): ChromeBridgeEnvelope {
  const base = envelope(index, count, fragment, snapshotId);
  return {
    ...base, lobby: "KSPORT", sourceId: "chrome:KSPORT:8", sourceEpoch: "worker-k:1",
    request: {
      ...base.request,
      providerPartition: "KSPORT_LIVE",
      providerContentIntent: "FOOTBALL_FULL_CATALOG",
      requestStartSequence
    }
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
    ["lobby identity", (value: ChromeBridgeEnvelope) => ({ ...value, lobby: "BTI" as const })],
    ["source identity", (value: ChromeBridgeEnvelope) => ({ ...value, sourceId: "chrome:IM:other" })],
    ["source epoch", (value: ChromeBridgeEnvelope) => ({ ...value, sourceEpoch: "worker-b:1" })],
    ["tab identity", (value: ChromeBridgeEnvelope) => ({ ...value, tabId: 9 })],
    ["request host", (value: ChromeBridgeEnvelope) => ({ ...value,
      request: { ...value.request, hostname: "other.example" } })],
    ["request method", (value: ChromeBridgeEnvelope) => ({ ...value,
      request: { ...value.request, resourceType: "Fetch" } })],
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

  it.each([
    ["provider partition", (value: ChromeBridgeEnvelope) => ({ ...value, request: {
      ...value.request, providerPartition: "KSPORT_TODAY" as const
    } }) as ChromeBridgeEnvelope],
    ["provider content intent", (value: ChromeBridgeEnvelope) => ({ ...value, request: {
      ...value.request, providerContentIntent: "FOOTBALL_FULL_CATALOG_V2"
    } }) as ChromeBridgeEnvelope],
    ["request-start cutoff", (value: ChromeBridgeEnvelope) => ({ ...value, request: {
      ...value.request, requestStartSequence: 11
    } })]
  ])("binds KSPORT recovery %s across every chunk", (_label, mutate) => {
    const assembler = new NetworkBodyAssembler();
    expect(assembler.ingest(ksportEnvelope(0))).toBeNull();
    expect(assembler.ingest(mutate(ksportEnvelope(1)))).toBeNull();
    expect(assembler.ingest(ksportEnvelope(1))).toBeNull();
  });

  it("binds chunk count and snapshot request/document identity", () => {
    const assembler = new NetworkBodyAssembler();
    expect(assembler.ingest(envelope(0, 2, "first-", "network-request-document-a"))).toBeNull();
    expect(assembler.ingest(envelope(1, 3, "wrong", "network-request-document-a"))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "body", "network-request-document-a"))).toBeNull();

    expect(assembler.ingest(envelope(0, 2, "other-", "network-request-document-b"))).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "scope", "network-request-document-b"), tabId: 9 }))
      .toBeNull();
    expect(assembler.ingest(envelope(1, 2, "scope", "network-request-document-b"))).toBeNull();
  });

  it("quarantines only the poisoned source/epoch/snapshot identity", () => {
    const assembler = new NetworkBodyAssembler();
    expect(assembler.ingest(envelope(0, 2, "bad-", "network-poisoned-request"))).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "body", "network-poisoned-request"), tabId: 9 }))
      .toBeNull();

    expect(assembler.ingest(envelope(0, 2, "good-", "network-same-source-fresh"))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "body", "network-same-source-fresh")))
      .toMatchObject({ payload: { body: "good-body" } });
  });

  it("bounds 5,000 incomplete bodies without starving an independent provider", () => {
    let now = 1_000;
    const assembler = new NetworkBodyAssembler({
      now: () => now, ttlMs: 100,
      maxPendingBodiesPerSource: 2, maxPendingBodies: 12,
      maxPendingBytesPerSource: 32, maxPendingBytes: 192,
      maxBodyBytes: 16, maxQuarantinedBodiesPerSource: 2, maxQuarantinedBodies: 12
    });
    const providerB = (chunkIndex: number) => ({ ...envelope(chunkIndex, 2,
      chunkIndex === 0 ? "B" : "!", "network-provider-b"), lobby: "BTI" as const,
      sourceId: "chrome:BTI:9", sourceEpoch: "worker-b:0", tabId: 9,
      request: { ...envelope(chunkIndex).request, hostname: "bti.example" } });
    expect(assembler.ingest(providerB(0))).toBeNull();
    for (let index = 0; index < 5_000; index += 1) {
      expect(assembler.ingest({ ...envelope(0, 2, "a", `network-request-${index}`),
        sourceEpoch: "worker-a:0" })).toBeNull();
    }
    expect(assembler.stats()).toMatchObject({
      pendingBodies: expect.any(Number), pendingBytes: expect.any(Number), blockedSourceEpochs: 1
    });
    expect(assembler.stats().pendingBodies).toBeLessThanOrEqual(2);
    expect(assembler.stats().pendingBytes).toBeLessThanOrEqual(32);

    expect(assembler.ingest(providerB(1))).toMatchObject({ payload: { body: "B!" } });

    // Overflow quarantines cannot be completed by a late missing fragment.
    expect(assembler.ingest({ ...envelope(1, 2, "z", "network-request-4999"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    // The compact source-epoch fence is scoped to the same TTL as exact
    // quarantine and cannot permanently suppress a recovered producer.
    now = 1_101;
    expect(assembler.ingest({ ...envelope(0, 2, "T", "network-recovery-same-epoch"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "L", "network-recovery-same-epoch"),
      sourceEpoch: "worker-a:0" })).toMatchObject({ payload: { body: "TL" } });
    // A strictly newer canonical epoch can recover without affecting provider B.
    expect(assembler.ingest({ ...envelope(0, 2, "O", "network-recovery-1"),
      sourceEpoch: "worker-a:1" })).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "K", "network-recovery-1"),
      sourceEpoch: "worker-a:1" })).toMatchObject({ payload: { body: "OK" } });
  });

  it("expires partial bodies lazily, fences late chunks, and allows reuse after quarantine TTL", () => {
    let now = 0;
    const assembler = new NetworkBodyAssembler({ now: () => now, ttlMs: 100 });
    expect(assembler.ingest(envelope(0, 2, "old-", "network-expiring-1"))).toBeNull();
    now = 101;
    expect(assembler.ingest(envelope(1, 2, "body", "network-expiring-1"))).toBeNull();
    expect(assembler.ingest(envelope(0, 2, "old-", "network-expiring-1"))).toBeNull();
    expect(assembler.stats().pendingBodies).toBe(0);

    now = 10_000;
    expect(assembler.ingest(envelope(0, 2, "old-", "network-expiring-1"))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "body", "network-expiring-1")))
      .toMatchObject({ payload: { body: "old-body" } });

    expect(assembler.ingest(envelope(0, 2, "new-", "network-fresh-body"))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "body", "network-fresh-body")))
      .toMatchObject({ payload: { body: "new-body" } });
  });

  it("uses the default 30-second TTL for partial bodies and scoped quarantine", () => {
    let now = 0;
    const assembler = new NetworkBodyAssembler({ now: () => now });
    expect(assembler.ingest(envelope(0, 2, "old-", "network-default-ttl-1"))).toBeNull();
    now = 29_999;
    expect(assembler.ingest(envelope(1, 2, "body", "network-default-ttl-1")))
      .toMatchObject({ payload: { body: "old-body" } });

    expect(assembler.ingest(envelope(0, 2, "poison-", "network-default-ttl-2"))).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "body", "network-default-ttl-2"), tabId: 9 }))
      .toBeNull();
    now = 59_998;
    expect(assembler.ingest(envelope(0, 2, "fresh-", "network-default-ttl-2"))).toBeNull();
    now = 59_999;
    expect(assembler.ingest(envelope(0, 2, "fresh-", "network-default-ttl-2"))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "body", "network-default-ttl-2")))
      .toMatchObject({ payload: { body: "fresh-body" } });
  });

  it("keeps exactly 8 pending bodies per source and 48 globally by default", () => {
    const perSource = new NetworkBodyAssembler();
    for (let index = 0; index < 8; index += 1) {
      expect(perSource.ingest(envelope(0, 2, "body-", `network-per-source-${index}`))).toBeNull();
    }
    expect(perSource.ingest(envelope(0, 2, "overflow-", "network-per-source-overflow"))).toBeNull();
    expect(perSource.stats()).toMatchObject({ pendingBodies: 8, quarantinedBodies: 1 });
    for (let index = 0; index < 8; index += 1) {
      expect(perSource.ingest(envelope(1, 2, "done", `network-per-source-${index}`)))
        .toMatchObject({ payload: { body: "body-done" } });
    }

    const global = new NetworkBodyAssembler({ maxPendingBodiesPerSource: 48 });
    for (let index = 0; index < 48; index += 1) {
      expect(global.ingest(envelope(0, 2, "body-", `network-global-body-${index}`))).toBeNull();
    }
    expect(global.ingest(envelope(0, 2, "overflow-", "network-global-overflow"))).toBeNull();
    expect(global.stats()).toMatchObject({ pendingBodies: 48, quarantinedBodies: 1 });
    for (let index = 0; index < 48; index += 1) {
      expect(global.ingest(envelope(1, 2, "done", `network-global-body-${index}`)))
        .toMatchObject({ payload: { body: "body-done" } });
    }
  });

  it("keeps exactly 24 MiB pending per source and 144 MiB globally by default", () => {
    const fragment = "x".repeat(128 * 1024);
    const perSource = new NetworkBodyAssembler();
    for (let index = 0; index < 191; index += 1) {
      expect(perSource.ingest(envelope(index, 192, fragment, "network-byte-source-a"))).toBeNull();
    }
    expect(perSource.ingest(envelope(0, 2, fragment, "network-byte-source-b"))).toBeNull();
    expect(perSource.stats().pendingBytes).toBe(24 * 1024 * 1024);
    expect(perSource.ingest(envelope(1, 2, "x", "network-byte-source-b"))).toBeNull();
    const completedPerSource = perSource.ingest(envelope(191, 192, fragment, "network-byte-source-a"));
    expect(completedPerSource?.payload.body).toHaveLength(24 * 1024 * 1024);

    const global = new NetworkBodyAssembler({ maxPendingBytesPerSource: 144 * 1024 * 1024 });
    for (let body = 0; body < 6; body += 1) {
      for (let index = 0; index < 191; index += 1) {
        expect(global.ingest(envelope(index, 192, fragment, `network-byte-global-${body}`))).toBeNull();
      }
    }
    for (let index = 0; index < 6; index += 1) {
      expect(global.ingest(envelope(index, 7, fragment, "network-byte-global-tail"))).toBeNull();
    }
    expect(global.stats()).toMatchObject({ pendingBodies: 7, pendingBytes: 144 * 1024 * 1024 });
    expect(global.ingest(envelope(6, 7, "x", "network-byte-global-tail"))).toBeNull();
    const completedGlobal = global.ingest(envelope(191, 192, fragment, "network-byte-global-0"));
    expect(completedGlobal?.payload.body).toHaveLength(24 * 1024 * 1024);
  }, 30_000);

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
