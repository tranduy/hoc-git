import { timingSafeEqual } from "node:crypto";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeControlMessage } from "@tool-chenh/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RawData } from "ws";
import type { ChromeBridgeRegistry } from "./chrome-bridge-registry.js";

const MAX_FRAME_BYTES = 256 * 1024;

export interface ChromeBridgeRouteOptions {
  readonly installationKey: string;
}

export function registerChromeBridgeRoute(
  app: FastifyInstance,
  registry: ChromeBridgeRegistry,
  options: ChromeBridgeRouteOptions
): void {
  if (!options.installationKey.trim()) throw new Error("CHROME_BRIDGE_KEY_REQUIRED");

  app.get("/api/chrome-bridge/sources", async () => ({ sources: registry.listSources() }));
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
      socket.send(JSON.stringify(registry.ingest(parsed.data)));
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
