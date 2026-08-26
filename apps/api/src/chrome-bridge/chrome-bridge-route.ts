import { timingSafeEqual } from "node:crypto";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeControlMessage } from "@tool-chenh/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RawData } from "ws";
import { z } from "zod";
import type { ChromeBridgeRegistry } from "./chrome-bridge-registry.js";
import type { ChromeBridgeControlPlane } from "./chrome-bridge-control-plane.js";
import { chromeBridgeSourceIdentity, type ChromeBridgeProviderAccountId } from "./chrome-bridge-account.js";
import type { ProviderFeedSnapshot } from "./provider-feed-types.js";

const MAX_FRAME_BYTES = 256 * 1024;

export interface ChromeBridgeRouteOptions {
  readonly installationKey: string;
  readonly dashboardOrigins: ReadonlySet<string>;
  readonly openProviderTicket?: boolean;
  readonly controlPlane?: ChromeBridgeControlPlane;
  readonly now?: () => number;
  readonly currentFeed?: (sourceId: string) => ProviderFeedSnapshot | null;
  readonly waitForFreshBaseline?: (sourceId: string, afterMs: number) => Promise<ProviderFeedSnapshot>;
}

const FocusSelectionBodySchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(128),
  providerEventId: z.string().trim().min(1).max(512),
  providerMarketId: z.string().trim().min(1).max(512),
  providerSelectionId: z.string().trim().min(1).max(512)
});

const SnapshotRequestBodySchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(128).regex(/^chrome:[A-Z]+:[0-9]+$/u)
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
  const now = options.now ?? Date.now;
  app.get("/api/chrome-bridge/sources", async () => ({ sources: registry.listSources() }));
  app.get("/api/chrome-bridge/features", async () => ({ openProviderTicket }));
  app.post("/api/chrome-bridge/request-snapshot", async (request, reply) => {
    if (!isLoopback(request.ip)) return reply.code(403).send({ error: "LOCAL_ACCESS_ONLY" });
    const parsed = SnapshotRequestBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SOURCE_ID" });
    const prior = options.currentFeed?.(parsed.data.sourceId) ?? null;
    const requestedAtMs = now();
    const requested = requestExactSourceSnapshot(registry, options.controlPlane, parsed.data.sourceId);
    if (requested !== 1) return reply.code(409).send({ error: "SOURCE_NOT_ATTACHED" });
    if (options.waitForFreshBaseline === undefined) {
      return reply.code(202).send({ sourceId: parsed.data.sourceId, requested });
    }
    try {
      const baseline = await options.waitForFreshBaseline(parsed.data.sourceId, requestedAtMs);
      if (baseline.state !== "LIVE" || baseline.sourceId !== parsed.data.sourceId ||
        baseline.activeGeneration === null || baseline.lastCompleteBaselineAtMs === null ||
        baseline.lastCompleteBaselineAtMs <= requestedAtMs ||
        (prior?.activeGeneration !== null && prior?.activeGeneration !== undefined &&
          baseline.activeGeneration === prior.activeGeneration)) throw new Error("BASELINE_NOT_NEWER");
      return reply.send({ sourceId: parsed.data.sourceId, requested, baseline: {
        sourceEpoch: baseline.sourceEpoch, activeGeneration: baseline.activeGeneration,
        lastCompleteBaselineAtMs: baseline.lastCompleteBaselineAtMs
      } });
    } catch {
      return reply.code(504).send({ error: "PROVIDER_FEED_BASELINE_TIMEOUT" });
    }
  });
  app.post("/api/chrome-bridge/focus-selection", async (request, reply) => {
    if (!isLoopback(request.ip) || !isTrustedFocusOrigin(request.headers.origin, options.dashboardOrigins)) {
      return reply.code(403).send({ error: "LOCAL_ACCESS_ONLY" });
    }
    if (!openProviderTicket) return reply.code(404).send({ error: "FEATURE_DISABLED" });
    const parsed = FocusSelectionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SELECTION_IDENTITY" });
    const source = registry.listActiveSources().find((item) => item.sourceId === parsed.data.sourceId);
    if (source === undefined) return reply.code(409).send({ error: "SOURCE_NOT_ATTACHED" });
    if (chromeBridgeSourceIdentity(parsed.data.sourceId) === null ||
      options.controlPlane?.isActiveSource(parsed.data.sourceId) !== true) {
      return reply.code(409).send({ error: "SOURCE_NOT_ATTACHED" });
    }
    const sent = options.controlPlane.focusSelection(parsed.data.sourceId, {
      providerEventId: parsed.data.providerEventId,
      providerMarketId: parsed.data.providerMarketId,
      providerSelectionId: parsed.data.providerSelectionId
    });
    if (!sent) return reply.code(409).send({ error: "SOURCE_NOT_ATTACHED" });
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
    registry.registerConnection(connection);
    // All per-connection indexes are provider-account scoped. A tab/source
    // replacement atomically overwrites its prior identity, keeping the route
    // bounded to the six supported provider accounts even before socket close.
    const requestedSnapshots = new Map<ChromeBridgeProviderAccountId, number>();
    writableSocket.on("close", () => {
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
      const result = registry.ingestDetailed(parsed.data, connection, (context) => {
        options.controlPlane?.attachAuthority(context.authorityIdentity,
          context.authorityObservation, parsed.data.lobby, writableSocket);
      });
      const control = result.control;
      socket.send(JSON.stringify(control), () => {
        if (control.kind === "REJECT" && control.reason === "SEQUENCE_GAP") { socket.close(); return; }
        const observation = result.context?.authorityObservation;
        if (control.kind === "ACK" && observation?.disposition === "CANDIDATE" &&
          requestedSnapshots.get(observation.token.accountId) !== observation.token.nonce) {
          requestedSnapshots.set(observation.token.accountId, observation.token.nonce);
          // A loopback reconnect is not authorization to hard-reload a provider
          // tab. The extension resolves this command with a DOM capture,
          // provider API call, or socket-only reconnect inside the current tab.
          if (options.controlPlane?.requestCandidateSnapshot(observation.token) !== 1 &&
            registry.authorityCoordinator.snapshot(observation.token.accountId).candidateToken === observation.token) {
            socket.send(JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT", sourceId: parsed.data.sourceId }));
          }
        }
      });
    });
  });
}

function requestExactSourceSnapshot(registry: ChromeBridgeRegistry,
  controlPlane: ChromeBridgeControlPlane | undefined, sourceId: string): number {
  if (controlPlane === undefined) return 0;
  const source = chromeBridgeSourceIdentity(sourceId);
  if (source !== null) {
    const authority = registry.authorityCoordinator.snapshot(source.accountId);
    if (authority.candidate?.sourceId === sourceId && authority.candidateToken !== null) {
      return controlPlane.requestCandidateSnapshot(authority.candidateToken);
    }
  }
  return controlPlane.requestSourceSnapshot(sourceId);
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

function isTrustedFocusOrigin(origin: string | undefined, dashboardOrigins: ReadonlySet<string>): boolean {
  return origin === undefined || dashboardOrigins.has(origin);
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
