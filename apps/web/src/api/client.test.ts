import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSnapshot, CatalogRevisionEntry } from "@tool-chenh/contracts";
import { SnapshotClient } from "./client.js";

const snapshot = (revision: number, generatedAtMs = 1): AppSnapshot => ({
  revision,
  generatedAtMs,
  providerStatuses: [],
  counts: { FOOTBALL: { events: 0, markets: 0 }, LOL: { events: 0, markets: 0 }, mappings: { VERIFIED: 0, REVIEW_REQUIRED: 0, REJECTED: 0 }, opportunities: 0 },
  events: [], markets: [], opportunities: [], blockedDiagnostics: []
});

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
}

afterEach(() => vi.useRealTimers());

describe("SnapshotClient", () => {
  it("delivers a catalog baseline and only later catalog sequences on the same socket", async () => {
    const socket = new FakeSocket();
    const baselines: Array<{ entries: readonly CatalogRevisionEntry[]; sequence: number }> = [];
    const updates: CatalogRevisionEntry[] = [];
    const client = new SnapshotClient({
      initialSnapshot: snapshot(1), onSnapshot: () => {}, onConnectionState: () => {},
      onCatalogBaseline: (entries, sequence) => baselines.push({ entries, sequence }),
      onCatalogRevision: (entry) => updates.push(entry),
      fetchSnapshot: async () => new Response(JSON.stringify(snapshot(1)), { status: 200 }),
      createWebSocket: () => socket as unknown as WebSocket
    });
    await client.start();
    socket.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 1, data: snapshot(1) }) } as MessageEvent);
    const entry = { accountId: "catalog-source:SABA:FOOTBALL", revision: "catalog-4",
      observedAtMs: 100, snapshotState: "FRESH" as const };
    socket.onmessage?.({ data: JSON.stringify({ type: "CATALOG_REVISION_BASELINE",
      sequence: 4, entries: [entry] }) } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "CATALOG_REVISION", sequence: 4, ...entry }) } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "CATALOG_REVISION", sequence: 5,
      ...entry, revision: "catalog-5", observedAtMs: 101 }) } as MessageEvent);

    expect(baselines).toEqual([{ sequence: 4, entries: [entry] }]);
    expect(updates).toEqual([{ ...entry, revision: "catalog-5", observedAtMs: 101 }]);
    client.stop();
  });

  it("fetches once, accepts the first realtime baseline, then only higher revisions", async () => {
    const received: AppSnapshot[] = [];
    const socket = new FakeSocket();
    const fetchSnapshot = vi.fn(async () => new Response(JSON.stringify(snapshot(4)), { status: 200 }));
    const client = new SnapshotClient({
      onSnapshot: (next) => received.push(next), onConnectionState: () => {}, fetchSnapshot,
      createWebSocket: () => socket as unknown as WebSocket
    });

    await client.start();
    socket.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 4, data: snapshot(4) }) } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 5, data: snapshot(5) }) } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 5, data: snapshot(5, 6) }) } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 4, data: snapshot(4, 7) }) } as MessageEvent);

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(received.map((item) => [item.revision, item.generatedAtMs])).toEqual([[4, 1], [4, 1], [5, 1]]);
  });

  it("does not report LIVE until a reconnect receives a validated full snapshot", async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const received: AppSnapshot[] = [];
    const signals: string[] = [];
    const sockets: FakeSocket[] = [];
    const client = new SnapshotClient({
      initialSnapshot: snapshot(4),
      onSnapshot: (next) => {
        received.push(next);
        signals.push(`SNAPSHOT:${next.generatedAtMs}`);
      },
      onConnectionState: (state) => {
        states.push(state);
        signals.push(`STATE:${state}`);
      },
      fetchSnapshot: async () => new Response(JSON.stringify(snapshot(4)), { status: 200 }),
      createWebSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      }
    });

    await client.start();
    sockets[0]!.onopen?.();
    expect(states.at(-1)).toBe("CONNECTING");

    sockets[0]!.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 4, data: snapshot(4) }) } as MessageEvent);
    expect(states.at(-1)).toBe("LIVE");

    sockets[0]!.onclose?.();
    await vi.advanceTimersByTimeAsync(1_000);
    sockets[1]!.onopen?.();
    expect(states.at(-1)).toBe("CONNECTING");

    sockets[1]!.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 4, data: { revision: "bad" } }) } as MessageEvent);
    sockets[0]!.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 99, data: snapshot(99) }) } as MessageEvent);
    expect(states.at(-1)).toBe("CONNECTING");
    const receivedBeforeFreshHandshake = received.length;
    const signalsBeforeFreshHandshake = signals.length;

    sockets[1]!.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 4, data: snapshot(4, 9) }) } as MessageEvent);
    expect(received).toHaveLength(receivedBeforeFreshHandshake + 1);
    expect(received.at(-1)?.generatedAtMs).toBe(9);
    expect(signals.slice(signalsBeforeFreshHandshake)).toEqual(["SNAPSHOT:9", "STATE:LIVE"]);
    expect(states.at(-1)).toBe("LIVE");

    client.stop();
    expect(sockets[1]!.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets).toHaveLength(2);
  });

  it("accepts a lower-revision full snapshot as the baseline after a server restart", async () => {
    vi.useFakeTimers();
    const received: AppSnapshot[] = [];
    const states: string[] = [];
    const sockets: FakeSocket[] = [];
    const client = new SnapshotClient({
      initialSnapshot: snapshot(8, 80),
      onSnapshot: (next) => received.push(next),
      onConnectionState: (state) => states.push(state),
      fetchSnapshot: async () => new Response(JSON.stringify(snapshot(8, 80)), { status: 200 }),
      createWebSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      }
    });

    await client.start();
    sockets[0]!.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 8, data: snapshot(8, 81) }) } as MessageEvent);
    sockets[0]!.onclose?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(states.at(-1)).toBe("CONNECTING");

    sockets[1]!.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 2, data: snapshot(2, 20) }) } as MessageEvent);
    expect(received.at(-1)).toEqual(snapshot(2, 20));
    expect(states.at(-1)).toBe("LIVE");

    const receivedAfterBaseline = received.length;
    sockets[1]!.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 1, data: snapshot(1, 21) }) } as MessageEvent);
    sockets[1]!.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 2, data: snapshot(2, 22) }) } as MessageEvent);
    expect(received).toHaveLength(receivedAfterBaseline);
    expect(received.at(-1)).toEqual(snapshot(2, 20));

    client.stop();
  });

  it("diagnoses malformed fetch and realtime payloads without replacing the snapshot", async () => {
    const received: AppSnapshot[] = [];
    const diagnostics: string[] = [];
    const socket = new FakeSocket();
    const client = new SnapshotClient({
      onSnapshot: (next) => received.push(next), onConnectionState: () => {}, onDiagnostic: (message) => diagnostics.push(message),
      fetchSnapshot: async () => new Response(JSON.stringify({ revision: "not-a-number" }), { status: 200 }),
      createWebSocket: () => socket as unknown as WebSocket
    });

    await client.start();
    socket.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 2, data: { revision: "bad" } }) } as MessageEvent);

    expect(received).toEqual([]);
    expect(diagnostics).toHaveLength(2);
  });

  it("caps exponential reconnect delays at ten seconds without writing local storage", async () => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.localStorage.setItem("sentinel", "preserved");
    const sockets: FakeSocket[] = [];
    const client = new SnapshotClient({
      onSnapshot: () => {}, onConnectionState: () => {},
      fetchSnapshot: async () => new Response(JSON.stringify(snapshot(1)), { status: 200 }),
      createWebSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      }
    });

    await client.start();
    for (const delay of [1_000, 2_000, 4_000, 8_000, 10_000, 10_000]) {
      sockets.at(-1)?.onclose?.();
      await vi.advanceTimersByTimeAsync(delay);
    }

    expect(sockets).toHaveLength(7);
    expect(window.localStorage.getItem("sentinel")).toBe("preserved");
    client.stop();
  });
});
