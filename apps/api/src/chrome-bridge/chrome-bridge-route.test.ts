import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { ChromeBridgeRegistry } from "./chrome-bridge-registry.js";
import { registerChromeBridgeRoute } from "./chrome-bridge-route.js";
import type { Socket } from "node:net";

const loopbackSocket = { remoteAddress: "127.0.0.1" } as Socket;

const validEnvelope = {
  version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7, sequence: 0,
  observedAtMs: 1_000, receivedMonotonicMs: 50, transport: "WS_FRAME",
  request: { hostname: "sports.example", pathnameClass: "/feed", resourceType: "WebSocket" },
  payload: { encoding: "UTF8", body: "{}" }
} as const;

async function appWithRoute(openProviderTicket = true) {
  const app = Fastify({ logger: false });
  await app.register(websocket, { options: { maxPayload: 262_144 } });
  const registry = new ChromeBridgeRegistry();
  registerChromeBridgeRoute(app, registry, { installationKey: "local-key", openProviderTicket });
  await app.ready();
  return { app, registry };
}

function nextMessage(socket: { once(event: "message", callback: (data: Buffer) => void): void }): Promise<unknown> {
  return new Promise((resolve) => socket.once("message", (data) => resolve(JSON.parse(data.toString("utf8")))));
}

describe("Chrome bridge route", () => {
  it("accepts a loopback extension client, validates the envelope, and ACKs", async () => {
    const { app, registry } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const received = nextMessage(socket);
    socket.send(JSON.stringify(validEnvelope));
    await expect(received).resolves.toMatchObject({ kind: "ACK", sourceId: "chrome:SABA:7", sequence: 0 });
    expect(registry.listSources()).toHaveLength(1);
    socket.terminate();
    await app.close();
  });

  it("reloads SABA so its socket replays a full catalog on a new bridge connection", async () => {
    const { app, registry } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const firstControls = new Promise<unknown[]>((resolve) => {
      const controls: unknown[] = [];
      socket.on("message", (data) => {
        controls.push(JSON.parse(data.toString("utf8")));
        if (controls.length === 2) resolve(controls);
      });
    });
    socket.send(JSON.stringify(validEnvelope));
    await expect(firstControls).resolves.toEqual([
      expect.objectContaining({ kind: "ACK", sourceId: "chrome:SABA:7" }),
      { version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:7" }
    ]);
    socket.send(JSON.stringify({ ...validEnvelope, sequence: 1 }));
    await expect(nextMessage(socket)).resolves.toMatchObject({ kind: "ACK", sequence: 1 });
    socket.terminate();
    await app.close();
  });

  it("reloads IM so both complete market partitions are reacquired after an API restart", async () => {
    const { app } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const controls = new Promise<unknown[]>((resolve) => {
      const received: unknown[] = [];
      socket.on("message", (data) => {
        received.push(JSON.parse(data.toString("utf8")));
        if (received.length === 2) resolve(received);
      });
    });
    socket.send(JSON.stringify({ ...validEnvelope, lobby: "IM", sourceId: "chrome:IM:7",
      transport: "TAB_STATE", request: { ...validEnvelope.request, pathnameClass: "/__fieldline_heartbeat__" } }));
    await expect(controls).resolves.toEqual([
      expect.objectContaining({ kind: "ACK", sourceId: "chrome:IM:7" }),
      { version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:IM:7" }
    ]);
    socket.terminate();
    await app.close();
  });

  it("requests an in-page snapshot for a non-SABA source on a new bridge connection", async () => {
    const { app } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const controls = new Promise<unknown[]>((resolve) => {
      const received: unknown[] = [];
      socket.on("message", (data) => {
        received.push(JSON.parse(data.toString("utf8")));
        if (received.length === 2) resolve(received);
      });
    });
    socket.send(JSON.stringify({ ...validEnvelope, lobby: "CMD", sourceId: "chrome:CMD:7" }));
    await expect(controls).resolves.toEqual([
      expect.objectContaining({ kind: "ACK", sourceId: "chrome:CMD:7" }),
      { version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:CMD:7" }
    ]);
    socket.terminate();
    await app.close();
  });

  it("rejects a wrong installation key and a non-extension origin before upgrade", async () => {
    const { app } = await appWithRoute();
    await expect(app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, wrong-key" },
      socket: loopbackSocket
    })).rejects.toThrow();
    await expect(app.injectWS("/api/chrome-bridge", {
      headers: { origin: "https://evil.test", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    })).rejects.toThrow();
    await app.close();
  });

  it("rejects malformed identity without mutating registry state", async () => {
    const { app, registry } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const received = nextMessage(socket);
    socket.send(JSON.stringify({ ...validEnvelope, sourceId: "chrome:IM:999" }));
    await expect(received).resolves.toMatchObject({ kind: "REJECT", reason: "MALFORMED" });
    expect(registry.listSources()).toEqual([]);
    socket.terminate();
    await app.close();
  });

  it("closes a sequence-gapped connection so the client can reconnect and replay", async () => {
    const { app } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    socket.send(JSON.stringify(validEnvelope));
    await nextMessage(socket);
    const rejected = nextMessage(socket);
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));

    socket.send(JSON.stringify({ ...validEnvelope, sequence: 2 }));

    await expect(rejected).resolves.toMatchObject({ kind: "REJECT", reason: "SEQUENCE_GAP" });
    await expect(closed).resolves.toBeUndefined();
    await app.close();
  });

  it("exposes metadata-only source diagnostics", async () => {
    const { app, registry } = await appWithRoute();
    registry.ingest(validEnvelope);
    const response = await app.inject({ method: "GET", url: "/api/chrome-bridge/sources" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ sources: [{ lobby: "SABA", sourceId: "chrome:SABA:7" }] });
    expect(response.body).not.toContain("payload");
    await app.close();
  });

  it("dispatches a strict read-only focus command only to an attached source", async () => {
    const { app, registry } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const initialControls = new Promise<void>((resolve) => {
      let count = 0;
      socket.on("message", () => { if (++count === 2) resolve(); });
    });
    const cmdEnvelope = { ...validEnvelope, lobby: "CMD", sourceId: "chrome:CMD:7" } as const;
    socket.send(JSON.stringify(cmdEnvelope));
    await initialControls;
    const focused = nextMessage(socket);
    const response = await app.inject({
      method: "POST",
      url: "/api/chrome-bridge/focus-selection",
      payload: {
        sourceId: "chrome:CMD:7",
        providerEventId: "event-1",
        providerMarketId: "market-1",
        providerSelectionId: "selection-1"
      }
    });
    expect(response.statusCode).toBe(202);
    await expect(focused).resolves.toMatchObject({ kind: "FOCUS_SELECTION", providerSelectionId: "selection-1" });
    const missing = await app.inject({
      method: "POST",
      url: "/api/chrome-bridge/focus-selection",
      payload: { sourceId: "chrome:CMD:999", providerEventId: "e", providerMarketId: "m", providerSelectionId: "s" }
    });
    expect(missing.statusCode).toBe(409);
    registry.ingest(validEnvelope);
    const registryOnlySource = await app.inject({
      method: "POST", url: "/api/chrome-bridge/focus-selection",
      payload: { sourceId: "chrome:SABA:7", providerEventId: "e", providerMarketId: "m", providerSelectionId: "s" }
    });
    expect(registryOnlySource.statusCode).toBe(409);
    socket.terminate();
    await app.close();
  });

  it("exposes the feature flag and disables focus commands fail-closed", async () => {
    const { app } = await appWithRoute(false);
    expect((await app.inject({ method: "GET", url: "/api/chrome-bridge/features" })).json())
      .toEqual({ openProviderTicket: false });
    const response = await app.inject({
      method: "POST", url: "/api/chrome-bridge/focus-selection",
      payload: { sourceId: "chrome:CMD:7", providerEventId: "e", providerMarketId: "m", providerSelectionId: "s" }
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
