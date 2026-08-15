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

async function appWithRoute() {
  const app = Fastify({ logger: false });
  await app.register(websocket, { options: { maxPayload: 262_144 } });
  const registry = new ChromeBridgeRegistry();
  registerChromeBridgeRoute(app, registry, { installationKey: "local-key" });
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

  it("exposes metadata-only source diagnostics", async () => {
    const { app, registry } = await appWithRoute();
    registry.ingest(validEnvelope);
    const response = await app.inject({ method: "GET", url: "/api/chrome-bridge/sources" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ sources: [{ lobby: "SABA", sourceId: "chrome:SABA:7" }] });
    expect(response.body).not.toContain("payload");
    await app.close();
  });
});
