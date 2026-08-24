import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkBodyAssembler, NetworkBodyAssemblyBudget } from "./network-body-assembler.js";
import * as networkBodyAssembly from "./network-body-assembler.js";

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

  it("latches only the poisoned source epoch and leaves another source usable", () => {
    const assembler = new NetworkBodyAssembler();
    expect(assembler.ingest(envelope(0, 2, "bad-", "network-poisoned-request"))).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "body", "network-poisoned-request"), tabId: 9 }))
      .toBeNull();

    expect(assembler.ingest(envelope(0, 2, "good-", "network-same-source-fresh"))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "body", "network-same-source-fresh"))).toBeNull();

    const sourceB = (index: number) => ({ ...envelope(index, 2, index === 0 ? "good-" : "body",
      "network-other-source-fresh"), sourceId: "chrome:IM:9", tabId: 9, sourceEpoch: "worker-b:0" });
    expect(assembler.ingest(sourceB(0))).toBeNull();
    expect(assembler.ingest(sourceB(1))).toMatchObject({ payload: { body: "good-body" } });
  });

  it("assembles the same snapshot ID independently for different source epochs", () => {
    const assembler = new NetworkBodyAssembler();
    const sharedSnapshotId = "network-shared-request-id";
    const sourceB = (index: number) => ({ ...envelope(index, 2, index === 0 ? "B-" : "body",
      sharedSnapshotId), lobby: "BTI" as const, sourceId: "chrome:BTI:9", sourceEpoch: "worker-b:0",
      tabId: 9, request: { ...envelope(index).request, hostname: "bti.example" } });

    expect(assembler.ingest(envelope(0, 2, "A-", sharedSnapshotId))).toBeNull();
    expect(assembler.ingest(sourceB(0))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "body", sharedSnapshotId)))
      .toMatchObject({ payload: { body: "A-body" } });
    expect(assembler.ingest(sourceB(1))).toMatchObject({ payload: { body: "B-body" } });
  });

  it("bounds 5,000 incomplete bodies without starving another source in the same provider account", () => {
    let now = 1_000;
    const assembler = new NetworkBodyAssembler({
      now: () => now, ttlMs: 100,
      maxPendingBodiesPerSource: 2, maxPendingBodies: 12,
      maxPendingBytesPerSource: 32, maxPendingBytes: 192,
      maxBodyBytes: 16, maxQuarantinedBodiesPerSource: 2, maxQuarantinedBodies: 12
    });
    const providerB = (chunkIndex: number) => ({ ...envelope(chunkIndex, 2,
      chunkIndex === 0 ? "B" : "!", "network-provider-b"), lobby: "SBO" as const,
      sourceId: "chrome:SBO:9", sourceEpoch: "worker-b:0", tabId: 9,
      request: { ...envelope(chunkIndex).request, hostname: "sbobet.example" } });
    expect(assembler.ingest(providerB(0))).toBeNull();
    for (let index = 0; index < 5_000; index += 1) {
      expect(assembler.ingest({ ...envelope(0, 2, "a", `network-request-${index}`),
        lobby: "KSPORT", sourceId: "chrome:KSPORT:8", sourceEpoch: "worker-a:0" })).toBeNull();
    }
    expect(assembler.stats()).toMatchObject({
      pendingBodies: expect.any(Number), pendingBytes: expect.any(Number), blockedSourceEpochs: 1
    });
    expect(assembler.stats().pendingBodies).toBeLessThanOrEqual(2);
    expect(assembler.stats().pendingBytes).toBeLessThanOrEqual(32);

    expect(assembler.ingest(providerB(1))).toMatchObject({ payload: { body: "B!" } });

    // Overflow quarantines cannot be completed by a late missing fragment.
    expect(assembler.ingest({ ...envelope(1, 2, "z", "network-request-4999"),
      lobby: "KSPORT", sourceId: "chrome:KSPORT:8", sourceEpoch: "worker-a:0" })).toBeNull();
    // Releasing fragment bytes at TTL cannot reopen the faulted source epoch.
    now = 1_101;
    expect(assembler.ingest({ ...envelope(0, 2, "T", "network-recovery-same-epoch"),
      lobby: "KSPORT", sourceId: "chrome:KSPORT:8", sourceEpoch: "worker-a:0" })).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "L", "network-recovery-same-epoch"),
      lobby: "KSPORT", sourceId: "chrome:KSPORT:8", sourceEpoch: "worker-a:0" })).toBeNull();
    // A strictly newer canonical epoch can recover without affecting provider B.
    expect(assembler.ingest({ ...envelope(0, 2, "O", "network-recovery-1"),
      lobby: "KSPORT", sourceId: "chrome:KSPORT:8", sourceEpoch: "worker-a:1" })).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "K", "network-recovery-1"),
      lobby: "KSPORT", sourceId: "chrome:KSPORT:8", sourceEpoch: "worker-a:1" }))
      .toMatchObject({ payload: { body: "OK" } });
  });

  it("latches an expired assembly fault across reset while allowing a newer epoch", () => {
    let now = 0;
    const assembler = new NetworkBodyAssembler({ now: () => now, ttlMs: 100 });
    const oldEpoch = (index: number) => ({ ...envelope(index, 2, index === 0 ? "old-" : "body",
      "network-expiring-1"), sourceEpoch: "worker-a:0" });
    expect(assembler.ingest(oldEpoch(0))).toBeNull();
    now = 101;
    expect(assembler.ingest(oldEpoch(1))).toBeNull();
    expect(assembler.ingest(oldEpoch(0))).toBeNull();
    expect(assembler.stats().pendingBodies).toBe(0);

    now = 202;
    expect(assembler.ingest(oldEpoch(0))).toBeNull();
    expect(assembler.ingest(oldEpoch(1))).toBeNull();

    expect(assembler.ingest({ ...envelope(0, 2, "new-", "network-newer-epoch"),
      sourceEpoch: "worker-a:1" })).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "body", "network-newer-epoch"),
      sourceEpoch: "worker-a:1" })).toMatchObject({ payload: { body: "new-body" } });

    assembler.resetSource("chrome:IM:8");
    expect(assembler.ingest({ ...envelope(0, 2, "reset-", "network-reset-source"),
      sourceEpoch: "worker-a:1" })).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "body", "network-reset-source"),
      sourceEpoch: "worker-a:1" })).toBeNull();
    expect(assembler.ingest({ ...envelope(0, 2, "next-", "network-reset-newer"),
      sourceEpoch: "worker-a:2" })).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "body", "network-reset-newer"),
      sourceEpoch: "worker-a:2" })).toMatchObject({ payload: { body: "next-body" } });
  });

  it("never re-admits retired canonical generations after advance or reset", () => {
    let now = 0;
    const assembler = new NetworkBodyAssembler({ now: () => now, ttlMs: 100 });
    const chunk = (generation: number, index: number, snapshotId: string) => ({
      ...envelope(index, 2, index === 0 ? `${generation}-` : "body", snapshotId),
      sourceEpoch: `observer:session-a:${generation}`
    });

    expect(assembler.ingest(chunk(0, 0, "network-retired-zero"))).toBeNull();
    now = 101;
    expect(assembler.ingest(chunk(0, 1, "network-retired-zero"))).toBeNull();
    expect(assembler.ingest(chunk(1, 0, "network-current-one"))).toBeNull();
    expect(assembler.ingest(chunk(1, 1, "network-current-one")))
      .toMatchObject({ payload: { body: "1-body" } });

    expect(assembler.ingest(chunk(0, 0, "network-retired-zero-retry"))).toBeNull();
    expect(assembler.ingest(chunk(0, 1, "network-retired-zero-retry"))).toBeNull();
    assembler.resetSource("chrome:IM:8");
    expect(assembler.ingest(chunk(0, 0, "network-retired-zero-reset"))).toBeNull();
    expect(assembler.ingest(chunk(0, 1, "network-retired-zero-reset"))).toBeNull();

    expect(assembler.ingest(chunk(2, 0, "network-current-two"))).toBeNull();
    expect(assembler.ingest(chunk(2, 1, "network-current-two")))
      .toMatchObject({ payload: { body: "2-body" } });
  });

  it("retains the maximum retired generation when multiple epochs expire together", () => {
    let now = 0;
    const assembler = new NetworkBodyAssembler({ now: () => now, ttlMs: 100 });
    const chunk = (generation: number, index: number, snapshotId: string) => ({
      ...envelope(index, 2, index === 0 ? `${generation}-` : "body", snapshotId),
      sourceEpoch: `worker-a:${generation}`
    });

    expect(assembler.ingest(chunk(0, 0, "network-expire-zero"))).toBeNull();
    expect(assembler.ingest(chunk(1, 0, "network-expire-one"))).toBeNull();
    now = 101;
    expect(assembler.stats()).toMatchObject({ pendingBodies: 0, pendingBytes: 0 });
    for (const generation of [0, 1]) {
      expect(assembler.ingest(chunk(generation, 0, `network-expired-${generation}-retry`))).toBeNull();
      expect(assembler.ingest(chunk(generation, 1, `network-expired-${generation}-retry`))).toBeNull();
    }
    expect(assembler.ingest(chunk(2, 0, "network-expire-two"))).toBeNull();
    expect(assembler.ingest(chunk(2, 1, "network-expire-two")))
      .toMatchObject({ payload: { body: "2-body" } });
  });

  it("keeps legacy retirement across reset and rejects arbitrary session replacement", () => {
    const legacy = new NetworkBodyAssembler();
    expect(legacy.ingest(envelope(0, 2, "old-", "network-legacy-retired"))).toBeNull();
    legacy.resetSource("chrome:IM:8");
    expect(legacy.ingest(envelope(0, 2, "new-", "network-legacy-retry"))).toBeNull();
    expect(legacy.ingest(envelope(1, 2, "body", "network-legacy-retry"))).toBeNull();

    const canonical = new NetworkBodyAssembler();
    const session = (sessionId: string, index: number) => ({
      ...envelope(index, 2, index === 0 ? `${sessionId}-` : "body", `network-session-${sessionId}`),
      sourceEpoch: `${sessionId}:0`
    });
    expect(canonical.ingest(session("observer-a", 0))).toBeNull();
    expect(canonical.ingest(session("observer-a", 1)))
      .toMatchObject({ payload: { body: "observer-a-body" } });
    expect(canonical.ingest(session("observer-b", 0))).toBeNull();
    expect(canonical.ingest(session("observer-b", 1))).toBeNull();

    const replacementLane = new NetworkBodyAssembler();
    expect(replacementLane.ingest(session("observer-b", 0))).toBeNull();
    expect(replacementLane.ingest(session("observer-b", 1)))
      .toMatchObject({ payload: { body: "observer-b-body" } });
  });

  it("bounds source lineages without evicting retirement evidence", () => {
    const budget = new NetworkBodyAssemblyBudget();
    const assembler = new NetworkBodyAssembler({ budget });
    const chunk = (sourceNumber: number, generation: number, index: number,
      snapshotId: string, mismatched = false): ChromeBridgeEnvelope => ({
      ...envelope(index, 2, index === 0 ? "A" : "B", snapshotId),
      sourceId: `chrome:IM:${sourceNumber + 20}`,
      tabId: sourceNumber + 20 + (mismatched ? 1 : 0),
      sourceEpoch: `observer-${sourceNumber}:${generation}`
    });

    for (let sourceNumber = 0; sourceNumber < 50_000; sourceNumber += 1) {
      const snapshotId = `network-lineage-fault-${sourceNumber}`;
      expect(assembler.ingest(chunk(sourceNumber, 0, 0, snapshotId))).toBeNull();
      expect(assembler.ingest(chunk(sourceNumber, 0, 1, snapshotId, true))).toBeNull();
    }

    expect(assembler.stats()).toMatchObject({
      pendingBodies: 0,
      pendingBytes: 0,
      blockedSourceEpochs: 8
    });
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });

    const retiredFirst = "network-lineage-retired-first";
    expect(assembler.ingest(chunk(0, 0, 0, retiredFirst))).toBeNull();
    expect(assembler.ingest(chunk(0, 0, 1, retiredFirst))).toBeNull();

    const unknown = "network-lineage-unknown-50001";
    expect(assembler.ingest(chunk(50_000, 0, 0, unknown))).toBeNull();
    expect(assembler.ingest(chunk(50_000, 0, 1, unknown))).toBeNull();

    const newerKnown = "network-lineage-known-newer";
    expect(assembler.ingest(chunk(0, 1, 0, newerKnown))).toBeNull();
    expect(assembler.ingest(chunk(0, 1, 1, newerKnown)))
      .toMatchObject({ payload: { body: "AB" } });

    const retiredAfterAdvance = "network-lineage-retired-after-advance";
    expect(assembler.ingest(chunk(0, 0, 0, retiredAfterAdvance))).toBeNull();
    expect(assembler.ingest(chunk(0, 0, 1, retiredAfterAdvance))).toBeNull();
    const otherStoredFence = "network-lineage-other-stored-fence";
    expect(assembler.ingest(chunk(1, 0, 0, otherStoredFence))).toBeNull();
    expect(assembler.ingest(chunk(1, 0, 1, otherStoredFence))).toBeNull();
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });

    const freshLane = new NetworkBodyAssembler();
    const freshSnapshot = "network-lineage-fresh-lane";
    expect(freshLane.ingest(chunk(50_000, 0, 0, freshSnapshot))).toBeNull();
    expect(freshLane.ingest(chunk(50_000, 0, 1, freshSnapshot)))
      .toMatchObject({ payload: { body: "AB" } });
  }, 30_000);

  it("uses the default 30-second TTL to release fragments without reopening the faulted epoch", () => {
    let now = 0;
    const assembler = new NetworkBodyAssembler({ now: () => now });
    const withEpoch = (value: ChromeBridgeEnvelope) => ({ ...value, sourceEpoch: "worker-a:0" });
    expect(assembler.ingest(withEpoch(envelope(0, 2, "old-", "network-default-ttl-1")))).toBeNull();
    now = 29_999;
    expect(assembler.ingest(withEpoch(envelope(1, 2, "body", "network-default-ttl-1"))))
      .toMatchObject({ payload: { body: "old-body" } });

    expect(assembler.ingest(withEpoch(envelope(0, 2, "poison-", "network-default-ttl-2"))))
      .toBeNull();
    expect(assembler.ingest(withEpoch({ ...envelope(1, 2, "body", "network-default-ttl-2"), tabId: 9 })))
      .toBeNull();
    now = 59_999;
    expect(assembler.ingest(withEpoch(envelope(0, 2, "fresh-", "network-default-ttl-2")))).toBeNull();
    expect(assembler.ingest(withEpoch(envelope(1, 2, "body", "network-default-ttl-2")))).toBeNull();
    assembler.resetSource("chrome:IM:8");
    expect(assembler.ingest(withEpoch(envelope(0, 2, "fresh-", "network-default-ttl-2")))).toBeNull();
    expect(assembler.ingest(withEpoch(envelope(1, 2, "body", "network-default-ttl-2")))).toBeNull();
    expect(assembler.ingest({ ...envelope(0, 2, "fresh-", "network-default-ttl-newer"),
      sourceEpoch: "worker-a:1" })).toBeNull();
    expect(assembler.ingest({ ...envelope(1, 2, "body", "network-default-ttl-newer"),
      sourceEpoch: "worker-a:1" })).toMatchObject({ payload: { body: "fresh-body" } });
  });

  it("extends sliding TTL after each accepted new chunk", () => {
    let now = 0;
    const assembler = new NetworkBodyAssembler({ now: () => now, ttlMs: 100 });
    const chunk = (index: number) => ({ ...envelope(index, 3, String.fromCharCode(65 + index),
      "network-sliding-ttl"), sourceEpoch: "worker-a:0" });

    expect(assembler.ingest(chunk(0))).toBeNull();
    now = 50;
    expect(assembler.ingest(chunk(1))).toBeNull();
    now = 101;
    expect(assembler.ingest(chunk(2))).toMatchObject({ payload: { body: "ABC" } });
  });

  it("expires only after one TTL interval without accepted chunk activity", () => {
    let now = 0;
    const assembler = new NetworkBodyAssembler({ now: () => now, ttlMs: 100 });
    const chunk = (index: number) => ({ ...envelope(index, 3, String.fromCharCode(65 + index),
      "network-sliding-inactive"), sourceEpoch: "worker-a:0" });

    expect(assembler.ingest(chunk(0))).toBeNull();
    now = 50;
    expect(assembler.ingest(chunk(1))).toBeNull();
    now = 149;
    expect(assembler.stats()).toMatchObject({ pendingBodies: 1, blockedSourceEpochs: 0 });
    now = 150;
    expect(assembler.stats()).toMatchObject({ pendingBodies: 0, blockedSourceEpochs: 1 });
    expect(assembler.ingest(chunk(2))).toBeNull();
  });

  it("does not extend TTL for duplicate or mismatched traffic", () => {
    let now = 0;
    const duplicate = new NetworkBodyAssembler({ now: () => now, ttlMs: 100 });
    const first = { ...envelope(0, 2, "A", "network-duplicate-no-touch"),
      sourceEpoch: "worker-a:0" };
    expect(duplicate.ingest(first)).toBeNull();
    now = 90;
    expect(duplicate.ingest(first)).toBeNull();
    now = 101;
    expect(duplicate.ingest({ ...envelope(1, 2, "B", "network-duplicate-no-touch"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    expect(duplicate.stats()).toMatchObject({ pendingBodies: 0, blockedSourceEpochs: 1 });

    now = 0;
    const mismatch = new NetworkBodyAssembler({ now: () => now, ttlMs: 100 });
    expect(mismatch.ingest(first)).toBeNull();
    now = 90;
    expect(mismatch.ingest({ ...first, payload: { encoding: "UTF8", body: JSON.stringify({
      schemaVersion: 1, snapshotId: "network-duplicate-no-touch", chunkIndex: 0,
      chunkCount: 2, bodyEncoding: "UTF8", bodyFragment: "X"
    }) } })).toBeNull();
    expect(mismatch.stats()).toMatchObject({ pendingBodies: 0, blockedSourceEpochs: 1 });
  });

  it("keeps exactly 8 pending bodies per source and 48 globally by default", () => {
    const perSource = new NetworkBodyAssembler();
    for (let index = 0; index < 8; index += 1) {
      expect(perSource.ingest(envelope(0, 2, "body-", `network-per-source-${index}`))).toBeNull();
    }
    expect(perSource.stats()).toMatchObject({ pendingBodies: 8, pendingBytes: 40 });
    for (let index = 0; index < 8; index += 1) {
      expect(perSource.ingest(envelope(1, 2, "done", `network-per-source-${index}`)))
        .toMatchObject({ payload: { body: "body-done" } });
    }
    for (let index = 0; index < 8; index += 1) {
      expect(perSource.ingest(envelope(0, 2, "body-", `network-per-source-fault-${index}`))).toBeNull();
    }
    expect(perSource.ingest(envelope(0, 2, "overflow-", "network-per-source-overflow"))).toBeNull();
    expect(perSource.stats()).toMatchObject({ pendingBodies: 0, blockedSourceEpochs: 1 });
    expect(perSource.ingest(envelope(1, 2, "done", "network-per-source-fault-0"))).toBeNull();

    const global = new NetworkBodyAssembler({ maxPendingBodiesPerSource: 48 });
    for (let index = 0; index < 48; index += 1) {
      expect(global.ingest(envelope(0, 2, "body-", `network-global-body-${index}`))).toBeNull();
    }
    expect(global.stats()).toMatchObject({ pendingBodies: 48 });
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
    // The final chunk completes at exactly 24 MiB and releases the local pool.
    const completedPerSource = perSource.ingest(envelope(191, 192, fragment, "network-byte-source-a"));
    expect(completedPerSource?.payload.body).toHaveLength(24 * 1024 * 1024);
    expect(perSource.stats().pendingBytes).toBe(0);

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
    global.resetSource("chrome:IM:8");
    expect(global.stats()).toMatchObject({ pendingBodies: 0, pendingBytes: 0 });
  }, 30_000);

  it("shares the default application budget across assemblers and releases it idempotently", () => {
    type Budget = {
      stats(): { readonly pendingBodies: number; readonly pendingBytes: number };
    };
    type BudgetConstructor = new (options?: {
      readonly maxPendingBodies?: number;
      readonly maxPendingBytes?: number;
    }) => Budget;
    const BudgetClass = (networkBodyAssembly as Record<string, unknown>)
      .NetworkBodyAssemblyBudget as BudgetConstructor | undefined;
    expect(BudgetClass).toBeDefined();
    if (BudgetClass === undefined) return;
    const withBudget = (budget: Budget, options: Record<string, unknown> = {}) =>
      new NetworkBodyAssembler({ ...options, budget } as ConstructorParameters<typeof NetworkBodyAssembler>[0]);

    const countBudget = new BudgetClass();
    const countA = withBudget(countBudget, { maxPendingBodiesPerSource: 48 });
    const countB = withBudget(countBudget, { maxPendingBodiesPerSource: 48 });
    const countOverflow = withBudget(countBudget);
    for (let index = 0; index < 24; index += 1) {
      expect(countA.ingest(envelope(0, 2, "A-", `network-shared-count-a-${index}`))).toBeNull();
      expect(countB.ingest({ ...envelope(0, 2, "B-", `network-shared-count-b-${index}`),
        sourceId: "chrome:IM:9", tabId: 9, sourceEpoch: "worker-b:0" })).toBeNull();
    }
    expect(countBudget.stats()).toMatchObject({ pendingBodies: 48, pendingBytes: 96 });
    expect(countOverflow.ingest({ ...envelope(0, 2, "X", "network-shared-count-overflow"),
      sourceId: "chrome:BTI:10", tabId: 10, sourceEpoch: "worker-c:0",
      lobby: "BTI", request: { ...envelope(0).request, hostname: "bti.example" } })).toBeNull();
    expect(countBudget.stats()).toMatchObject({ pendingBodies: 48, pendingBytes: 96 });
    for (let index = 0; index < 24; index += 1) {
      expect(countA.ingest(envelope(1, 2, "done", `network-shared-count-a-${index}`)))
        .toMatchObject({ payload: { body: "A-done" } });
      expect(countB.ingest({ ...envelope(1, 2, "done", `network-shared-count-b-${index}`),
        sourceId: "chrome:IM:9", tabId: 9, sourceEpoch: "worker-b:0" }))
        .toMatchObject({ payload: { body: "B-done" } });
    }
    expect(countBudget.stats()).toMatchObject({ pendingBodies: 0, pendingBytes: 0 });

    const byteBudget = new BudgetClass({ maxPendingBodies: 4, maxPendingBytes: 4 });
    const byteA = withBudget(byteBudget);
    const byteB = withBudget(byteBudget);
    const byteOverflow = withBudget(byteBudget);
    expect(byteA.ingest(envelope(0, 2, "AA", "network-shared-byte-a"))).toBeNull();
    expect(byteB.ingest({ ...envelope(0, 2, "BB", "network-shared-byte-b"),
      sourceId: "chrome:IM:9", tabId: 9, sourceEpoch: "worker-b:0" })).toBeNull();
    expect(byteBudget.stats()).toMatchObject({ pendingBodies: 2, pendingBytes: 4 });
    expect(byteOverflow.ingest({ ...envelope(0, 2, "X", "network-shared-byte-overflow"),
      sourceId: "chrome:BTI:10", tabId: 10, sourceEpoch: "worker-c:0",
      lobby: "BTI", request: { ...envelope(0).request, hostname: "bti.example" } })).toBeNull();
    expect(byteBudget.stats()).toMatchObject({ pendingBodies: 2, pendingBytes: 4 });
    (byteA as NetworkBodyAssembler & { dispose(): void }).dispose();
    (byteA as NetworkBodyAssembler & { dispose(): void }).dispose();
    expect(byteBudget.stats()).toMatchObject({ pendingBodies: 1, pendingBytes: 2 });
    expect(byteB.ingest({ ...envelope(1, 2, "B", "network-shared-byte-b"),
      sourceId: "chrome:IM:9", tabId: 9, sourceEpoch: "worker-b:0" }))
      .toMatchObject({ payload: { body: "BBB" } });
    expect(byteBudget.stats()).toMatchObject({ pendingBodies: 0, pendingBytes: 0 });

    const defaultByteBudget = new BudgetClass();
    const defaultByteA = withBudget(defaultByteBudget);
    const defaultByteB = withBudget(defaultByteBudget);
    const defaultByteOverflow = withBudget(defaultByteBudget);
    const fragment = "y".repeat(128 * 1024);
    for (let body = 0; body < 6; body += 1) {
      const target = body < 3 ? defaultByteA : defaultByteB;
      const sourceId = `chrome:IM:${20 + body}`;
      for (let index = 0; index < 191; index += 1) {
        expect(target.ingest({ ...envelope(index, 192, fragment, `network-shared-global-${body}`),
          sourceId, tabId: 20 + body, sourceEpoch: `worker-${body}:0` })).toBeNull();
      }
    }
    for (let index = 0; index < 6; index += 1) {
      expect(defaultByteB.ingest({ ...envelope(index, 7, fragment, "network-shared-global-tail"),
        sourceId: "chrome:IM:30", tabId: 30, sourceEpoch: "worker-tail:0" })).toBeNull();
    }
    expect(defaultByteBudget.stats()).toMatchObject({
      pendingBodies: 7, pendingBytes: 144 * 1024 * 1024
    });
    expect(defaultByteOverflow.ingest({ ...envelope(0, 2, "z", "network-shared-global-overflow"),
      sourceId: "chrome:BTI:31", tabId: 31, sourceEpoch: "worker-overflow:0",
      lobby: "BTI", request: { ...envelope(0).request, hostname: "bti.example" } })).toBeNull();
    expect(defaultByteBudget.stats()).toMatchObject({
      pendingBodies: 7, pendingBytes: 144 * 1024 * 1024
    });
    (defaultByteA as NetworkBodyAssembler & { dispose(): void }).dispose();
    (defaultByteB as NetworkBodyAssembler & { dispose(): void }).dispose();
    expect(defaultByteBudget.stats()).toMatchObject({ pendingBodies: 0, pendingBytes: 0 });
  }, 30_000);

  it("preserves an existing body when shared byte pressure rejects a later fragment", () => {
    const budget = new NetworkBodyAssemblyBudget({ maxPendingBodies: 2, maxPendingBytes: 3 });
    const victim = new NetworkBodyAssembler({ budget });
    const aggressor = new NetworkBodyAssembler({ budget });
    const aggressorChunk = (index: number) => ({
      ...envelope(index, 2, "a", "network-pressure-aggressor"),
      sourceId: "chrome:IM:9", tabId: 9, sourceEpoch: "worker-b:0"
    });

    expect(victim.ingest({ ...envelope(0, 2, "v", "network-pressure-victim"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    expect(aggressor.ingest(aggressorChunk(0))).toBeNull();
    expect(budget.stats()).toEqual({ pendingBodies: 2, pendingBytes: 2 });

    expect(victim.ingest({ ...envelope(1, 2, "vv", "network-pressure-victim"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    expect(budget.stats()).toEqual({ pendingBodies: 2, pendingBytes: 2 });
    expect(aggressor.ingest(aggressorChunk(1)))
      .toMatchObject({ payload: { body: "aa" } });
    expect(victim.ingest({ ...envelope(1, 2, "vv", "network-pressure-victim"),
      sourceEpoch: "worker-a:0" })).toMatchObject({ payload: { body: "vvv" } });
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
  });

  it("does not fault a source when global body pressure rejects a new body", () => {
    const budget = new NetworkBodyAssemblyBudget({ maxPendingBodies: 1, maxPendingBytes: 10 });
    const occupied = new NetworkBodyAssembler({ budget });
    const waiting = new NetworkBodyAssembler({ budget });
    const waitingChunk = (index: number) => ({
      ...envelope(index, 2, index === 0 ? "B" : "!", "network-pressure-waiting"),
      sourceId: "chrome:IM:9", tabId: 9, sourceEpoch: "worker-b:0"
    });

    expect(occupied.ingest({ ...envelope(0, 2, "A", "network-pressure-occupied"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    expect(waiting.ingest(waitingChunk(0))).toBeNull();
    expect(waiting.stats()).toMatchObject({ pendingBodies: 0, blockedSourceEpochs: 0 });
    expect(occupied.ingest({ ...envelope(1, 2, "!", "network-pressure-occupied"),
      sourceEpoch: "worker-a:0" })).toMatchObject({ payload: { body: "A!" } });
    expect(waiting.ingest(waitingChunk(0))).toBeNull();
    expect(waiting.ingest(waitingChunk(1))).toMatchObject({ payload: { body: "B!" } });
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
  });

  it("lets another assembler reclaim an idle owner's expired reservation", () => {
    let now = 0;
    const budget = new NetworkBodyAssemblyBudget({
      maxPendingBodies: 1, maxPendingBytes: 10, now: () => now
    });
    const idle = new NetworkBodyAssembler({ now: () => now, ttlMs: 100, budget });
    const active = new NetworkBodyAssembler({ now: () => now, ttlMs: 100, budget });

    expect(idle.ingest({ ...envelope(0, 2, "A", "network-idle-owner"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    expect(budget.stats()).toEqual({ pendingBodies: 1, pendingBytes: 1 });
    now = 101;
    expect(active.ingest({ ...envelope(0, 1, "B", "network-active-owner"),
      sourceId: "chrome:IM:9", tabId: 9, sourceEpoch: "worker-b:0" }))
      .toMatchObject({ payload: { body: "B" } });
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });

    expect(idle.ingest({ ...envelope(1, 2, "!", "network-idle-owner"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    expect(idle.stats()).toMatchObject({ pendingBodies: 0, blockedSourceEpochs: 1 });
    expect(() => idle.dispose()).not.toThrow();
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
  });

  it("reclaims all 48 expired global reservations when a new owner arrives", () => {
    let now = 0;
    const budget = new NetworkBodyAssemblyBudget({ now: () => now });
    const owners = Array.from({ length: 48 }, (_, index) => {
      const assembler = new NetworkBodyAssembler({ now: () => now, ttlMs: 100, budget });
      expect(assembler.ingest({ ...envelope(0, 2, "x", `network-expired-owner-${index}`),
        sourceId: `chrome:IM:${index + 20}`, tabId: index + 20,
        sourceEpoch: `worker-${index}:0` })).toBeNull();
      return assembler;
    });
    expect(budget.stats()).toEqual({ pendingBodies: 48, pendingBytes: 48 });

    now = 101;
    const newcomer = new NetworkBodyAssembler({ now: () => now, ttlMs: 100, budget });
    expect(newcomer.ingest({ ...envelope(0, 1, "N", "network-after-global-expiry"),
      sourceId: "chrome:BTI:100", tabId: 100, sourceEpoch: "worker-new:0",
      lobby: "BTI", request: { ...envelope(0).request, hostname: "bti.example" } }))
      .toMatchObject({ payload: { body: "N" } });
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
    for (const owner of owners) owner.dispose();
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
  });

  it("makes disposal harmless after the budget expires a reservation independently", () => {
    let now = 0;
    const budget = new NetworkBodyAssemblyBudget({
      maxPendingBodies: 2, maxPendingBytes: 10, now: () => now
    });
    const expired = new NetworkBodyAssembler({ now: () => now, ttlMs: 100, budget });
    expect(expired.ingest({ ...envelope(0, 2, "A", "network-expiry-dispose"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    now = 101;
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
    expect(() => expired.dispose()).not.toThrow();
    expect(() => expired.dispose()).not.toThrow();
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
  });

  it("uses the system clock to expire default-budget reservations during stats", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const budget = new NetworkBodyAssemblyBudget({ maxPendingBodies: 1, maxPendingBytes: 10 });
      const assembler = new NetworkBodyAssembler({ ttlMs: 100, budget });
      expect(assembler.ingest({ ...envelope(0, 2, "A", "network-default-budget-clock"),
        sourceEpoch: "worker-a:0" })).toBeNull();
      expect(budget.stats()).toEqual({ pendingBodies: 1, pendingBytes: 1 });
      vi.setSystemTime(101);
      expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
      expect(() => assembler.dispose()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the default budget clock even when an assembler supplies a conflicting clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const budget = new NetworkBodyAssemblyBudget({ maxPendingBodies: 1, maxPendingBytes: 10 });
      const assembler = new NetworkBodyAssembler({ now: () => 0, ttlMs: 100, budget });
      expect(assembler.ingest({ ...envelope(0, 2, "A", "network-default-clock-owner"),
        sourceEpoch: "worker-a:0" })).toBeNull();
      expect(budget.stats()).toEqual({ pendingBodies: 1, pendingBytes: 1 });
      vi.setSystemTime(1_101);
      expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
      expect(() => assembler.dispose()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives every assembler the shared budget's deterministic clock", () => {
    let now = 0;
    const budget = new NetworkBodyAssemblyBudget({
      maxPendingBodies: 2, maxPendingBytes: 10, now: () => now
    });
    const first = new NetworkBodyAssembler({ now: Date.now, ttlMs: 100, budget });
    const second = new NetworkBodyAssembler({ now: () => 999_999, ttlMs: 100, budget });
    expect(first.ingest({ ...envelope(0, 3, "A", "network-shared-clock-first"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    expect(second.ingest({ ...envelope(0, 2, "B", "network-shared-clock-second"),
      sourceId: "chrome:IM:9", tabId: 9, sourceEpoch: "worker-b:0" })).toBeNull();
    expect(budget.stats()).toEqual({ pendingBodies: 2, pendingBytes: 2 });

    now = 50;
    expect(first.ingest({ ...envelope(1, 3, "C", "network-shared-clock-first"),
      sourceEpoch: "worker-a:0" })).toBeNull();
    now = 101;
    expect(budget.stats()).toEqual({ pendingBodies: 1, pendingBytes: 2 });
    now = 150;
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
    first.dispose();
    second.dispose();
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
