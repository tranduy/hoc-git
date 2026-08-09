import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSnapshot } from "@tool-chenh/contracts";
import { SnapshotClient } from "./client.js";

const snapshot = (revision: number): AppSnapshot => ({
  revision,
  generatedAtMs: 1,
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
  it("fetches once and accepts only a higher validated snapshot revision", async () => {
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

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(received.map((item) => item.revision)).toEqual([4, 5]);
  });

  it("does not report LIVE until a reconnect receives a validated full snapshot", async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const sockets: FakeSocket[] = [];
    const client = new SnapshotClient({
      initialSnapshot: snapshot(4),
      onSnapshot: () => {},
      onConnectionState: (state) => states.push(state),
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
    sockets[1]!.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 3, data: snapshot(3) }) } as MessageEvent);
    expect(states.at(-1)).toBe("CONNECTING");

    sockets[1]!.onmessage?.({ data: JSON.stringify({ type: "SNAPSHOT", revision: 4, data: snapshot(4) }) } as MessageEvent);
    expect(states.at(-1)).toBe("LIVE");
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
