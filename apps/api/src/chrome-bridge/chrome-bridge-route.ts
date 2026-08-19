import { timingSafeEqual } from "node:crypto";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeControlMessage } from "@tool-chenh/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RawData } from "ws";
import { z } from "zod";
import type { ChromeBridgeRegistry } from "./chrome-bridge-registry.js";
import type { ChromeBridgeControlPlane } from "./chrome-bridge-control-plane.js";

const MAX_FRAME_BYTES = 256 * 1024;

export interface ChromeBridgeRouteOptions {
  readonly installationKey: string;
  readonly openProviderTicket?: boolean;
  readonly controlPlane?: ChromeBridgeControlPlane;
}

const FocusSelectionBodySchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(128),
  providerEventId: z.string().trim().min(1).max(512),
  providerMarketId: z.string().trim().min(1).max(512),
  providerSelectionId: z.string().trim().min(1).max(512)
});

interface WritableBridgeSocket {
  readonly readyState: number;
  send(data: string): void;
  on(event: "close", callback: () => void): void;
}

export function registerChromeBridgeRoute(
  app: FastifyInstance,
  registry: ChromeBridgeRegistry,
  options: ChromeBridgeRouteOptions
): void {
  if (!options.installationKey.trim()) throw new Error("CHROME_BRIDGE_KEY_REQUIRED");

  const openProviderTicket = options.openProviderTicket ?? true;
  const socketsBySource = new Map<string, WritableBridgeSocket>();

  app.get("/api/chrome-bridge/sources", async () => ({ sources: registry.listSources() }));
  app.get("/api/chrome-bridge/features", async () => ({ openProviderTicket }));
  app.post("/api/chrome-bridge/focus-selection", async (request, reply) => {
    if (!openProviderTicket) return reply.code(404).send({ error: "FEATURE_DISABLED" });
    const parsed = FocusSelectionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SELECTION_IDENTITY" });
    const source = registry.listSources().find((item) => item.sourceId === parsed.data.sourceId);
    if (source === undefined) return reply.code(409).send({ error: "SOURCE_NOT_ATTACHED" });
    const socket = socketsBySource.get(parsed.data.sourceId);
    if (!socket || socket.readyState !== 1) return reply.code(409).send({ error: "SOURCE_NOT_ATTACHED" });
    const control: ChromeBridgeControlMessage = { version: 1, kind: "FOCUS_SELECTION", ...parsed.data };
    socket.send(JSON.stringify(control));
    return reply.code(202).send({ accepted: true });
  });
  app.get("/api/chrome-bridge", {
    websocket: true,
    preValidation: async (request, reply) => {
      if (!isLoopback(request.ip)
        || !isExtensionOrigin(request.headers.origin)
        || !hasInstallationKey(request, options.installationKey)) {
        await reply.code(401).send({ error: "Unauthorized" });
      }
    }
  }, (socket) => {
    const writableSocket = socket as unknown as WritableBridgeSocket;
    options.controlPlane?.attachInstallation(writableSocket);
    const connection = {};
    const requestedSnapshots = new Set<string>();
    const connectionSources = new Set<string>();
    writableSocket.on("close", () => {
      for (const sourceId of connectionSources) {
        if (socketsBySource.get(sourceId) === writableSocket) socketsBySource.delete(sourceId);
      }
      registry.releaseConnection(connection);
      options.controlPlane?.detach(writableSocket);
    });
    socket.on("message", (raw: RawData) => {
      const bytes = rawDataBytes(raw);
      if (bytes > MAX_FRAME_BYTES) {
        socket.send(JSON.stringify(reject("PAYLOAD_TOO_LARGE")));
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(rawDataText(raw));
      } catch {
        socket.send(JSON.stringify(reject("MALFORMED")));
        return;
      }
      const parsed = ChromeBridgeEnvelopeSchema.safeParse(value);
      if (!parsed.success || parsed.data.sourceId !== `chrome:${parsed.data.lobby}:${parsed.data.tabId}`) {
        socket.send(JSON.stringify(reject("MALFORMED")));
        return;
      }
      const control = registry.ingest(parsed.data, connection);
      if (control.kind === "ACK") {
        socketsBySource.set(parsed.data.sourceId, writableSocket);
        connectionSources.add(parsed.data.sourceId);
        options.controlPlane?.attach(parsed.data.sourceId, writableSocket);
      }
      socket.send(JSON.stringify(control), () => {
        if (control.kind === "REJECT" && control.reason === "SEQUENCE_GAP") { socket.close(); return; }
        if (control.kind === "ACK" && !requestedSnapshots.has(parsed.data.sourceId)) {
          requestedSnapshots.add(parsed.data.sourceId);
          // BTI launch URLs are one-time credentials. Its extension poller
          // already performs an authenticated in-page catalog refresh, so a
          // reconnect must not turn a healthy tab into a reload of a consumed
          // launch. If no fresh catalog arrives, the data plane requests a
          // newly issued launch through targeted source recovery.
          if (parsed.data.lobby === "BTI") return;
          // SABA needs a complete socket reset/done replay. Other sources can
          // provide their current baseline without a new Fabet navigation.
          const kind = parsed.data.lobby === "SABA" ? "RELOAD_SOURCE" : "REQUEST_SNAPSHOT";
          socket.send(JSON.stringify({ version: 1, kind, sourceId: parsed.data.sourceId }));
        }
      });
    });
  });
}

function reject(reason: "MALFORMED" | "PAYLOAD_TOO_LARGE"): ChromeBridgeControlMessage {
  return { version: 1, kind: "REJECT", sourceId: null, sequence: null, reason };
}

function hasInstallationKey(request: FastifyRequest, expected: string): boolean {
  const header = request.headers["sec-websocket-protocol"];
  const protocols = typeof header === "string" ? header.split(",").map((value) => value.trim()) : [];
  const supplied = protocols[1] ?? "";
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

function isExtensionOrigin(origin: string | undefined): boolean {
  return typeof origin === "string" && origin.startsWith("chrome-extension://");
}

function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function rawDataBytes(raw: RawData): number {
  if (typeof raw === "string") return Buffer.byteLength(raw, "utf8");
  if (Array.isArray(raw)) return raw.reduce((total, part) => total + part.byteLength, 0);
  return raw.byteLength;
}

function rawDataText(raw: RawData): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return raw instanceof ArrayBuffer
    ? Buffer.from(new Uint8Array(raw)).toString("utf8")
    : Buffer.from(raw).toString("utf8");
}
