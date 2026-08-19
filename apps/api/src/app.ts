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
import { registerCatalogSourceRoutes, type CatalogSourceRegistryLike } from "./routes/catalog-sources.js";
import type { CatalogTelemetryRegistry } from "./routes/catalog-telemetry.js";
import { registerProviderPreflightRoutes, type ProviderPreflightLike } from "./routes/provider-preflight.js";
import { registerTwoLegPreflightRoutes, type TwoLegPreflightLike } from "./routes/two-leg-preflight.js";
import { registerReceiptProtocolRoute, type ReceiptProtocolLike } from "./routes/receipt-protocol.js";
import { registerBetHistoryRoute, type BetHistoryLike } from "./routes/bet-history.js";
import type { FileBetHistory } from "./history/file-bet-history.js";
import type { CatalogStoreLike } from "./catalog/durable-catalog-store.js";
import { registerChromeBridgeRoute } from "./chrome-bridge/chrome-bridge-route.js";
import type { ChromeBridgeRegistry } from "./chrome-bridge/chrome-bridge-registry.js";
import type { ChromeBridgeControlPlane } from "./chrome-bridge/chrome-bridge-control-plane.js";
import { registerMaintenanceRoutes } from "./routes/maintenance.js";
import type { SessionRefreshControl } from "./session-maintenance.js";
import type { CatalogRevisionStore } from "./catalog/catalog-revision-store.js";
import { registerCmdHiddenMarketProbeRoute, type CmdHiddenMarketProbeLike } from "./routes/cmd-hidden-market-probe.js";

export interface AppOptions {
  readonly viteOrigin?: string;
  readonly heartbeatIntervalMs?: number;
  readonly maxBufferedBytes?: number;
  readonly sessionServices?: SessionServices;
  readonly accountRegistry?: AccountRegistryLike;
  readonly catalogReader?: CatalogReaderLike;
  readonly catalogSources?: CatalogSourceRegistryLike;
  readonly catalogObserver?: CatalogObserverLike;
  readonly catalogTelemetry?: CatalogTelemetryRegistry;
  readonly catalogStore?: CatalogStoreLike;
  readonly catalogRevisions?: CatalogRevisionStore;
  readonly providerPreflight?: ProviderPreflightLike;
  readonly twoLegPreflight?: TwoLegPreflightLike;
  readonly receiptProtocol?: ReceiptProtocolLike;
  readonly betHistory?: FileBetHistory & BetHistoryLike;
  readonly chromeBridge?: {
    readonly registry: ChromeBridgeRegistry;
    readonly installationKey: string;
    readonly openProviderTicket?: boolean;
    readonly controlPlane?: ChromeBridgeControlPlane;
  };
  readonly maintenance?: SessionRefreshControl;
  readonly cmdHiddenMarketProbe?: CmdHiddenMarketProbeLike;
}

const defaultViteOrigin = "http://127.0.0.1:4311";
const defaultHeartbeatIntervalMs = 15_000;
const defaultMaxBufferedBytes = 1024 * 1024;
const cloudflareDashboardOrigin = "https://live.babiesbo.uk";
const logLevels = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

export function resolveApiLogLevel(value: string | undefined, nodeEnvironment: string | undefined): string {
  const normalized = value?.trim().toLocaleLowerCase("en");
  if (normalized !== undefined && logLevels.has(normalized)) return normalized;
  return nodeEnvironment === "test" ? "silent" : "warn";
}

export function validateViteOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("viteOrigin must be a local HTTP origin");
  }
  const isLoopbackOrigin = url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.origin !== origin || (!isLoopbackOrigin && origin !== cloudflareDashboardOrigin)) {
    throw new Error("viteOrigin must be a local HTTP origin or allowed dashboard origin");
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
  const dashboardOrigins = new Set([defaultViteOrigin, viteOrigin]);
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
    disableRequestLogging: true,
    logger: {
      level: resolveApiLogLevel(process.env.TOOL_CHENH_LOG_LEVEL, process.env.NODE_ENV),
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
    const chromeBridgeOrigin = request.url.startsWith("/api/chrome-bridge")
      && origin?.startsWith("chrome-extension://") === true;
    if (origin !== undefined && !dashboardOrigins.has(origin) && !chromeBridgeOrigin) {
      await reply.code(403).send({ error: "Origin not allowed" });
    }
  });
  void app.register(cors, {
    origin: (origin, callback) => callback(
      null,
      origin !== undefined && dashboardOrigins.has(origin) ? origin : false
    ),
    methods: ["GET", "POST"]
  });

  registerHealthRoute(app, runtime);
  registerSnapshotRoute(app, runtime);
  if (options.sessionServices !== undefined) registerSessionRoutes(app, options.sessionServices);
  if (options.accountRegistry !== undefined) registerAccountRoutes(app, options.accountRegistry);
  if (options.catalogSources !== undefined) registerCatalogSourceRoutes(app, options.catalogSources);
  if (options.catalogReader !== undefined) registerCatalogRoutes(
    app, options.catalogReader, options.catalogTelemetry, options.catalogObserver, options.catalogStore,
    options.catalogRevisions
  );
  if (options.providerPreflight !== undefined) registerProviderPreflightRoutes(app, options.providerPreflight);
  if (options.twoLegPreflight !== undefined) registerTwoLegPreflightRoutes(app, options.twoLegPreflight, options.betHistory);
  if (options.receiptProtocol !== undefined) registerReceiptProtocolRoute(app, options.receiptProtocol);
  if (options.betHistory !== undefined) registerBetHistoryRoute(app, options.betHistory);
  if (options.maintenance !== undefined) registerMaintenanceRoutes(app, options.maintenance);
  if (options.cmdHiddenMarketProbe !== undefined) {
    registerCmdHiddenMarketProbeRoute(app, options.cmdHiddenMarketProbe);
  }
  if (options.chromeBridge !== undefined) void app.register(async (instance) => {
    registerChromeBridgeRoute(instance, options.chromeBridge!.registry, {
      installationKey: options.chromeBridge!.installationKey,
      ...(options.chromeBridge!.controlPlane === undefined ? {} : { controlPlane: options.chromeBridge!.controlPlane }),
      ...(options.chromeBridge!.openProviderTicket === undefined
        ? {}
        : { openProviderTicket: options.chromeBridge!.openProviderTicket })
    });
  });
  void app.register(async (instance) => {
    registerOpportunityWebsocket(instance, runtime, { heartbeatIntervalMs, maxBufferedBytes }, options.catalogRevisions);
  });
  if (options.catalogRevisions !== undefined) app.addHook("onClose", async () => options.catalogRevisions?.close());

  return app;
}
