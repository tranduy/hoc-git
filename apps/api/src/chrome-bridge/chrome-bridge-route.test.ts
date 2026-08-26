import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ChromeBridgeRegistry } from "./chrome-bridge-registry.js";
import { ChromeBridgeControlPlane } from "./chrome-bridge-control-plane.js";
import { registerChromeBridgeRoute } from "./chrome-bridge-route.js";
import type { Socket } from "node:net";
import type { ChromeBridgeProviderAccountId } from "./chrome-bridge-account.js";

const loopbackSocket = { remoteAddress: "127.0.0.1" } as Socket;
const localDashboardOrigin = "http://127.0.0.1:4311";
const configuredDashboardOrigin = "https://live.babiesbo.uk";

const validEnvelope = {
  version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7, sequence: 0,
  observedAtMs: 1_000, receivedMonotonicMs: 50, transport: "WS_FRAME",
  request: { hostname: "sports.example", pathnameClass: "/feed", resourceType: "WebSocket" },
  payload: { encoding: "UTF8", body: "{}" }
} as const;

async function appWithRoute(openProviderTicket = true, recoveryOptions: Record<string, unknown> = {}) {
  const app = Fastify({ logger: false });
  await app.register(websocket, { options: { maxPayload: 262_144 } });
  const registry = new ChromeBridgeRegistry();
  const controlPlane = new ChromeBridgeControlPlane({ authorityCoordinator: registry.authorityCoordinator });
  const routeOptions = {
    installationKey: "local-key", openProviderTicket, controlPlane,
    dashboardOrigins: new Set([localDashboardOrigin]), ...recoveryOptions
  };
  registerChromeBridgeRoute(app, registry, routeOptions);
  await app.ready();
  return { app, registry, controlPlane };
}

function promoteCandidate(registry: ChromeBridgeRegistry, accountId: ChromeBridgeProviderAccountId): void {
  const token = registry.authorityCoordinator.snapshot(accountId).candidateToken;
  if (token === null) throw new Error("candidate missing");
  const provider = accountId.split(":")[1] as "CMD" | "IM" | "SABA" | "SBOBET" | "APSPORT" | "BTI";
  registry.authorityCoordinator.promote(token, { authorityCursor: BigInt(token.nonce), provenance: "WS",
    contentClass: "FOOTBALL", completeness: "COMPLETE", scope: "ACCOUNT", completedPartitions: [provider],
    emptyProof: "PROVIDER_CONFIRMED_EMPTY", catalog: { dataMode: "LIVE", accountId, provider,
      category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: token.nonce,
      rejectedMarketCount: 0, events: [], markets: [], quotes: [] } });
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

  it("requests an in-page SABA baseline without hard-reloading on bridge reconnect", async () => {
    const { app, registry } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const controls: unknown[] = [];
    socket.on("message", (data) => controls.push(JSON.parse(data.toString("utf8"))));
    socket.send(JSON.stringify(validEnvelope));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(controls).toEqual([
      expect.objectContaining({ kind: "ACK", sourceId: "chrome:SABA:7" }),
      { version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:7" }
    ]);
    socket.send(JSON.stringify({ ...validEnvelope, sequence: 1 }));
    await expect(nextMessage(socket)).resolves.toMatchObject({ kind: "ACK", sequence: 1 });
    socket.terminate();
    await app.close();
  });

  it("requests an in-page K-Sports baseline recovery when the local bridge reconnects", async () => {
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

    socket.send(JSON.stringify({ ...validEnvelope, lobby: "KSPORT", sourceId: "chrome:KSPORT:7",
      transport: "TAB_STATE", request: { ...validEnvelope.request, pathnameClass: "/__fieldline_heartbeat__" } }));

    await expect(controls).resolves.toEqual([
      expect.objectContaining({ kind: "ACK", sourceId: "chrome:KSPORT:7" }),
      { version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:KSPORT:7" }
    ]);
    socket.terminate();
    await app.close();
  });

  it("requests the cached IM baseline without reusing its one-time launch URL", async () => {
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
      { version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:IM:7" }
    ]);
    socket.terminate();
    await app.close();
  });

  it("requests an in-page BTI refresh without reusing its one-time launch when the bridge reconnects", async () => {
    const { app } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const received: unknown[] = [];
    socket.on("message", (data) => received.push(JSON.parse(data.toString("utf8"))));

    socket.send(JSON.stringify({ ...validEnvelope, lobby: "BTI", sourceId: "chrome:BTI:7",
      transport: "TAB_STATE", request: { ...validEnvelope.request, pathnameClass: "/__fieldline_heartbeat__" } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(received).toEqual([
      expect.objectContaining({ kind: "ACK", sourceId: "chrome:BTI:7" }),
      { version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:BTI:7" }
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

  it("fences an older authenticated socket even when it stays silent until after its replacement", async () => {
    const { app, registry } = await appWithRoute();
    const headers = {
      origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key"
    };
    const silentOlderSocket = await app.injectWS("/api/chrome-bridge", { headers, socket: loopbackSocket });
    const currentSocket = await app.injectWS("/api/chrome-bridge", { headers, socket: loopbackSocket });

    const currentReply = nextMessage(currentSocket);
    currentSocket.send(JSON.stringify({ ...validEnvelope, sourceEpoch: "observer-a:0" }));
    await expect(currentReply).resolves.toMatchObject({ kind: "ACK" });

    const olderReply = nextMessage(silentOlderSocket);
    silentOlderSocket.send(JSON.stringify({ ...validEnvelope, sourceId: "chrome:SABA:8", tabId: 8,
      sourceEpoch: "observer-a:999" }));
    await expect(olderReply).resolves.toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
    expect(registry.listSources()).toEqual([expect.objectContaining({ sourceId: "chrome:SABA:7" })]);

    silentOlderSocket.terminate();
    currentSocket.terminate();
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

  it("blocks a remote caller before focus-selection reaches an attached bridge", async () => {
    const { app, registry } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const initialControls = new Promise<void>((resolve) => {
      let count = 0;
      socket.on("message", () => { if (++count === 2) resolve(); });
    });
    socket.send(JSON.stringify({ ...validEnvelope, lobby: "CMD", sourceId: "chrome:CMD:7" }));
    await initialControls;
    promoteCandidate(registry, "catalog-source:CMD:FOOTBALL");
    const controls: unknown[] = [];
    socket.on("message", (data) => controls.push(JSON.parse(data.toString("utf8"))));

    const response = await app.inject({
      method: "POST", url: "/api/chrome-bridge/focus-selection", remoteAddress: "203.0.113.8",
      payload: { sourceId: "chrome:CMD:7", providerEventId: "event-1", providerMarketId: "market-1",
        providerSelectionId: "selection-1" }
    });

    expect(response.statusCode).toBe(403);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(controls).not.toContainEqual(expect.objectContaining({ kind: "FOCUS_SELECTION" }));
    socket.terminate();
    await app.close();
  });

  it("blocks a Chrome extension origin before focus-selection reaches an attached bridge", async () => {
    const { app, registry } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const initialControls = new Promise<void>((resolve) => {
      let count = 0;
      socket.on("message", () => { if (++count === 2) resolve(); });
    });
    socket.send(JSON.stringify({ ...validEnvelope, lobby: "CMD", sourceId: "chrome:CMD:7" }));
    await initialControls;
    promoteCandidate(registry, "catalog-source:CMD:FOOTBALL");
    const controls: unknown[] = [];
    socket.on("message", (data) => controls.push(JSON.parse(data.toString("utf8"))));

    const response = await app.inject({
      method: "POST", url: "/api/chrome-bridge/focus-selection",
      headers: { origin: "chrome-extension://foreign-extension" },
      payload: { sourceId: "chrome:CMD:7", providerEventId: "event-1", providerMarketId: "market-1",
        providerSelectionId: "selection-1" }
    });

    expect(response.statusCode).toBe(403);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(controls).not.toContainEqual(expect.objectContaining({ kind: "FOCUS_SELECTION" }));
    socket.terminate();
    await app.close();
  });

  it.each([
    ["an arbitrary HTTPS Origin", "https://attacker.example"],
    ["the literal null Origin", "null"],
    ["a case-variant Chrome extension Origin", "Chrome-Extension://foreign-extension"]
  ])("rejects %s at the focus-selection boundary before source validation", async (_label, origin) => {
    const { app } = await appWithRoute();

    const response = await app.inject({
      method: "POST", url: "/api/chrome-bridge/focus-selection", headers: { origin },
      payload: { sourceId: "chrome:CMD:7", providerEventId: "event-1", providerMarketId: "market-1",
        providerSelectionId: "selection-1" }
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("allows an exact configured dashboard Origin to dispatch a focus command", async () => {
    const { app, registry } = await appWithRoute(true, {
      dashboardOrigins: new Set([configuredDashboardOrigin])
    });
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const initialControls = new Promise<void>((resolve) => {
      let count = 0;
      socket.on("message", () => { if (++count === 2) resolve(); });
    });
    socket.send(JSON.stringify({ ...validEnvelope, lobby: "CMD", sourceId: "chrome:CMD:7" }));
    await initialControls;
    promoteCandidate(registry, "catalog-source:CMD:FOOTBALL");
    const focused = nextMessage(socket);

    const response = await app.inject({
      method: "POST", url: "/api/chrome-bridge/focus-selection",
      headers: { origin: configuredDashboardOrigin },
      payload: { sourceId: "chrome:CMD:7", providerEventId: "event-1", providerMarketId: "market-1",
        providerSelectionId: "selection-1" }
    });

    expect(response.statusCode).toBe(202);
    await expect(focused).resolves.toMatchObject({ kind: "FOCUS_SELECTION", providerSelectionId: "selection-1" });
    socket.terminate();
    await app.close();
  });

  it("allows an Origin-less local dashboard caller to dispatch a focus command", async () => {
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
    promoteCandidate(registry, "catalog-source:CMD:FOOTBALL");
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

  it("requests recovery from an exact listed LIVE candidate source", async () => {
    const { app, registry } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const initialControls = new Promise<void>((resolve) => {
      let count = 0;
      socket.on("message", () => { if (++count === 2) resolve(); });
    });
    socket.send(JSON.stringify({ ...validEnvelope, lobby: "KSPORT", sourceId: "chrome:KSPORT:7" }));
    await initialControls;
    expect(registry.listSources()).toEqual([expect.objectContaining({
      sourceId: "chrome:KSPORT:7", state: "LIVE", authorityDisposition: "CANDIDATE"
    })]);

    const recovery = nextMessage(socket);
    const response = await app.inject({ method: "POST", url: "/api/chrome-bridge/request-snapshot",
      payload: { sourceId: "chrome:KSPORT:7" } });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ sourceId: "chrome:KSPORT:7", requested: 1 });
    await expect(recovery).resolves.toEqual({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:KSPORT:7" });
    const wrongSource = await app.inject({ method: "POST", url: "/api/chrome-bridge/request-snapshot",
      payload: { sourceId: "chrome:KSPORT:999" } });
    expect(wrongSource.statusCode).toBe(409);
    socket.terminate();
    await app.close();
  });

  it("rejects a replaced candidate and requests only the exact current candidate", async () => {
    const { app } = await appWithRoute();
    const firstSocket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const firstControls = new Promise<void>((resolve) => {
      let count = 0;
      firstSocket.on("message", () => { if (++count === 2) resolve(); });
    });
    firstSocket.send(JSON.stringify({ ...validEnvelope, lobby: "KSPORT", sourceId: "chrome:KSPORT:7" }));
    await firstControls;

    const currentSocket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const currentControls = new Promise<void>((resolve) => {
      let count = 0;
      currentSocket.on("message", () => { if (++count === 2) resolve(); });
    });
    currentSocket.send(JSON.stringify({ ...validEnvelope, lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 }));
    await currentControls;

    const replaced = await app.inject({ method: "POST", url: "/api/chrome-bridge/request-snapshot",
      payload: { sourceId: "chrome:KSPORT:7" } });
    expect(replaced.statusCode).toBe(409);
    const wrong = await app.inject({ method: "POST", url: "/api/chrome-bridge/request-snapshot",
      payload: { sourceId: "chrome:KSPORT:999" } });
    expect(wrong.statusCode).toBe(409);

    const recovery = nextMessage(currentSocket);
    const current = await app.inject({ method: "POST", url: "/api/chrome-bridge/request-snapshot",
      payload: { sourceId: "chrome:KSPORT:8" } });
    expect(current.statusCode).toBe(202);
    expect(current.json()).toEqual({ sourceId: "chrome:KSPORT:8", requested: 1 });
    await expect(recovery).resolves.toEqual({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:KSPORT:8" });
    firstSocket.terminate();
    currentSocket.terminate();
    await app.close();
  });

  it("requests recovery only from the exact attached source ID", async () => {
    const { app, registry } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const initialControls = new Promise<void>((resolve) => {
      let count = 0;
      socket.on("message", () => { if (++count === 2) resolve(); });
    });
    socket.send(JSON.stringify({ ...validEnvelope, lobby: "CMD", sourceId: "chrome:CMD:7" }));
    await initialControls;
    promoteCandidate(registry, "catalog-source:CMD:FOOTBALL");

    const recovery = nextMessage(socket);
    const response = await app.inject({ method: "POST", url: "/api/chrome-bridge/request-snapshot",
      payload: { sourceId: "chrome:CMD:7" } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ sourceId: "chrome:CMD:7", requested: 1 });
    await expect(recovery).resolves.toEqual({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:CMD:7" });

    const missing = await app.inject({ method: "POST", url: "/api/chrome-bridge/request-snapshot",
      payload: { sourceId: "chrome:CMD:999" } });
    expect(missing.statusCode).toBe(409);
    const malformed = await app.inject({ method: "POST", url: "/api/chrome-bridge/request-snapshot",
      payload: { sourceId: "not-a-source" } });
    expect(malformed.statusCode).toBe(400);
    socket.terminate();
    await app.close();
  });

  it("confirms an exact recovery only after a strictly newer provider baseline", async () => {
    const baseline = { accountId: "catalog-source:CMD:FOOTBALL", state: "LIVE", reason: null,
      sourceId: "chrome:CMD:7", sourceEpoch: "observer:2", tabReachableAtMs: 2_001,
      providerTransportAtMs: 2_002, lastAuthoritativeEvidenceAtMs: 2_003,
      lastCompleteBaselineAtMs: 2_004, lastDeltaAtMs: null, lastSemanticChangeAtMs: 2_004,
      activeGeneration: "cmd:200", recoveryStage: "NONE", recoveryAttempt: 0 } as const;
    const waitForFreshBaseline = vi.fn(async () => baseline);
    const { app, registry } = await appWithRoute(true, { now: () => 2_000,
      currentFeed: () => ({ ...baseline, lastCompleteBaselineAtMs: 1_000, activeGeneration: "cmd:100" }),
      waitForFreshBaseline });
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const initialControls = new Promise<void>((resolve) => {
      let count = 0;
      socket.on("message", () => { if (++count === 2) resolve(); });
    });
    socket.send(JSON.stringify({ ...validEnvelope, lobby: "CMD", sourceId: "chrome:CMD:7" }));
    await initialControls;
    promoteCandidate(registry, "catalog-source:CMD:FOOTBALL");
    const recovery = nextMessage(socket);

    const response = await app.inject({ method: "POST", url: "/api/chrome-bridge/request-snapshot",
      payload: { sourceId: "chrome:CMD:7" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sourceId: "chrome:CMD:7", requested: 1, baseline: {
      sourceEpoch: "observer:2", activeGeneration: "cmd:200", lastCompleteBaselineAtMs: 2_004
    } });
    expect(waitForFreshBaseline).toHaveBeenCalledExactlyOnceWith("chrome:CMD:7", 2_000);
    await expect(recovery).resolves.toMatchObject({ kind: "REQUEST_SNAPSHOT", sourceId: "chrome:CMD:7" });
    socket.terminate();
    await app.close();
  });

  it("does not confirm a recovery that merely republishes the prior authority generation", async () => {
    const prior = { accountId: "catalog-source:CMD:FOOTBALL", state: "LIVE", reason: null,
      sourceId: "chrome:CMD:7", sourceEpoch: "observer:1", tabReachableAtMs: 1_000,
      providerTransportAtMs: 1_000, lastAuthoritativeEvidenceAtMs: 1_000,
      lastCompleteBaselineAtMs: 1_000, lastDeltaAtMs: null, lastSemanticChangeAtMs: 1_000,
      activeGeneration: "cmd:100", recoveryStage: "NONE", recoveryAttempt: 0 } as const;
    const { app, registry } = await appWithRoute(true, { now: () => 2_000,
      currentFeed: () => prior,
      waitForFreshBaseline: async () => ({ ...prior, lastCompleteBaselineAtMs: 2_001 }) });
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const initialControls = new Promise<void>((resolve) => {
      let count = 0;
      socket.on("message", () => { if (++count === 2) resolve(); });
    });
    socket.send(JSON.stringify({ ...validEnvelope, lobby: "CMD", sourceId: "chrome:CMD:7" }));
    await initialControls;
    promoteCandidate(registry, "catalog-source:CMD:FOOTBALL");

    const response = await app.inject({ method: "POST", url: "/api/chrome-bridge/request-snapshot",
      payload: { sourceId: "chrome:CMD:7" } });
    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual({ error: "PROVIDER_FEED_BASELINE_TIMEOUT" });
    socket.terminate();
    await app.close();
  });

  it("compacts realistic same-connection source churn across route and control-plane indexes", async () => {
    const { app, registry, controlPlane } = await appWithRoute();
    const socket = await app.injectWS("/api/chrome-bridge", {
      headers: { origin: "chrome-extension://test-id", "sec-websocket-protocol": "tool-chenh.v1, local-key" },
      socket: loopbackSocket
    });
    const accepted = new Promise<void>((resolve) => {
      let acknowledgements = 0;
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString("utf8")) as { kind?: string };
        if (message.kind === "ACK" && ++acknowledgements === 1_000) resolve();
      });
    });
    for (let ordinal = 0; ordinal < 1_000; ordinal += 1) {
      const tabId = ordinal + 7;
      socket.send(JSON.stringify({ ...validEnvelope, sourceId: `chrome:SABA:${tabId}`, tabId,
        sourceEpoch: `observer-a:${ordinal}` }));
    }
    await accepted;

    promoteCandidate(registry, "catalog-source:SABA:FOOTBALL");

    expect(registry.listSources()).toEqual([expect.objectContaining({ sourceId: "chrome:SABA:1006" })]);
    expect(controlPlane.sourceCount()).toBe(1);
    expect(controlPlane.requestAllSnapshots()).toBe(1);
    const retired = await app.inject({ method: "POST", url: "/api/chrome-bridge/focus-selection",
      payload: { sourceId: "chrome:SABA:7", providerEventId: "e", providerMarketId: "m",
        providerSelectionId: "s" } });
    expect(retired.statusCode).toBe(409);
    const current = await app.inject({ method: "POST", url: "/api/chrome-bridge/focus-selection",
      payload: { sourceId: "chrome:SABA:1006", providerEventId: "e", providerMarketId: "m",
        providerSelectionId: "s" } });
    expect(current.statusCode).toBe(202);
    socket.terminate();
    await app.close();
  }, 15_000);
});
