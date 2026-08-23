import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkBodyAssembler } from "./network-body-assembler.js";
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

  it("latches an expired assembly fault until a newer epoch or explicit reset", () => {
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
    expect(assembler.ingest(envelope(0, 2, "reset-", "network-reset-source"))).toBeNull();
    expect(assembler.ingest(envelope(1, 2, "body", "network-reset-source")))
      .toMatchObject({ payload: { body: "reset-body" } });
  });

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
    expect(assembler.ingest(withEpoch(envelope(1, 2, "body", "network-default-ttl-2"))))
      .toMatchObject({ payload: { body: "fresh-body" } });
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
