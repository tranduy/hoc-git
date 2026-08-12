import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { registerOpportunityWebsocket } from "./realtime/opportunity-ws.js";
import type { Runtime } from "./runtime.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerAccountRoutes, type AccountRegistryLike } from "./routes/accounts.js";
import { registerSnapshotRoute } from "./routes/snapshot.js";
import { registerSessionRoutes, type SessionServices } from "./routes/sessions.js";
import { registerCatalogRoutes, type CatalogObserverLike, type CatalogReaderLike } from "./routes/catalog.js";
import type { CatalogTelemetryRegistry } from "./routes/catalog-telemetry.js";
import { registerProviderPreflightRoutes, type ProviderPreflightLike } from "./routes/provider-preflight.js";
import { registerTwoLegPreflightRoutes, type TwoLegPreflightLike } from "./routes/two-leg-preflight.js";
import { registerExecutionDryRunRoute, type ExecutionDryRunLike } from "./routes/execution-dry-run.js";
import { registerReceiptProtocolRoute, type ReceiptProtocolLike } from "./routes/receipt-protocol.js";

export interface AppOptions {
  readonly viteOrigin?: string;
  readonly heartbeatIntervalMs?: number;
  readonly maxBufferedBytes?: number;
  readonly sessionServices?: SessionServices;
  readonly accountRegistry?: AccountRegistryLike;
  readonly catalogReader?: CatalogReaderLike;
  readonly catalogObserver?: CatalogObserverLike;
  readonly catalogTelemetry?: CatalogTelemetryRegistry;
  readonly providerPreflight?: ProviderPreflightLike;
  readonly twoLegPreflight?: TwoLegPreflightLike;
  readonly executionDryRun?: ExecutionDryRunLike;
  readonly receiptProtocol?: ReceiptProtocolLike;
}

const defaultViteOrigin = "http://127.0.0.1:4311";
const defaultHeartbeatIntervalMs = 15_000;
const defaultMaxBufferedBytes = 1024 * 1024;

export function validateViteOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("viteOrigin must be a local HTTP origin");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.origin !== origin
  ) {
    throw new Error("viteOrigin must be a local HTTP origin");
  }
  return origin;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function safeRequestSerializer(request: unknown): {
  readonly method: string;
  readonly url: string;
} {
  const value = objectValue(request);
  const method = typeof value.method === "string" ? value.method : "UNKNOWN";
  const rawUrl = typeof value.url === "string" ? value.url : "";
  return { method, url: rawUrl.split(/[?#]/u, 1)[0] ?? "" };
}

export function safeResponseSerializer(response: unknown): { readonly statusCode: number } {
  const value = objectValue(response);
  return { statusCode: typeof value.statusCode === "number" ? value.statusCode : 0 };
}

export function buildApp(runtime: Runtime, options: AppOptions = {}): FastifyInstance {
  const viteOrigin = validateViteOrigin(options.viteOrigin ?? defaultViteOrigin);
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? defaultHeartbeatIntervalMs;
  const maxBufferedBytes = options.maxBufferedBytes ?? defaultMaxBufferedBytes;
  if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
    throw new Error("heartbeatIntervalMs must be positive");
  }
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes <= 0) {
    throw new Error("maxBufferedBytes must be a positive safe integer");
  }
  const app = Fastify({
    bodyLimit: 32 * 1024,
    logger: {
      level: process.env.NODE_ENV === "test" ? "silent" : "info",
      serializers: {
        req: safeRequestSerializer,
        res: safeResponseSerializer
      },
      redact: {
        paths: [
          "req.headers",
          "req.query",
          "req.body",
          "res.headers",
          "headers",
          "query",
          "body",
          "authorization",
          "cookie",
          "set-cookie",
          "token",
          "account",
          "accountId",
          "session"
        ],
        remove: true
      }
    }
  });
  void app.register(websocket, { options: { maxPayload: maxBufferedBytes } });
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/")) reply.header("cache-control", "no-store");
    return payload;
  });
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== viteOrigin) {
      await reply.code(403).send({ error: "Origin not allowed" });
    }
  });
  void app.register(cors, {
    origin: (origin, callback) => callback(null, origin === viteOrigin ? viteOrigin : false),
    methods: ["GET", "POST"]
  });

  registerHealthRoute(app, runtime);
  registerSnapshotRoute(app, runtime);
  if (options.sessionServices !== undefined) registerSessionRoutes(app, options.sessionServices);
  if (options.accountRegistry !== undefined) registerAccountRoutes(app, options.accountRegistry);
  if (options.catalogReader !== undefined) registerCatalogRoutes(
    app, options.catalogReader, options.catalogTelemetry, options.catalogObserver
  );
  if (options.providerPreflight !== undefined) registerProviderPreflightRoutes(app, options.providerPreflight);
  if (options.twoLegPreflight !== undefined) registerTwoLegPreflightRoutes(app, options.twoLegPreflight);
  if (options.executionDryRun !== undefined) registerExecutionDryRunRoute(app, options.executionDryRun);
  if (options.receiptProtocol !== undefined) registerReceiptProtocolRoute(app, options.receiptProtocol);
  void app.register(async (instance) => {
    registerOpportunityWebsocket(instance, runtime, { heartbeatIntervalMs, maxBufferedBytes });
  });

  return app;
}
