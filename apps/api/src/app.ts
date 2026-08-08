import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { registerOpportunityWebsocket } from "./realtime/opportunity-ws.js";
import type { Runtime } from "./runtime.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerSnapshotRoute } from "./routes/snapshot.js";

export interface AppOptions {
  readonly viteOrigin?: string;
  readonly heartbeatIntervalMs?: number;
  readonly maxBufferedBytes?: number;
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

function isSameOrigin(origin: string, protocol: string, host: string | undefined): boolean {
  if (host === undefined) return false;
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
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
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      origin !== viteOrigin &&
      !isSameOrigin(origin, request.protocol, request.headers.host)
    ) {
      await reply.code(403).send({ error: "Origin not allowed" });
    }
  });
  void app.register(cors, {
    origin: (origin, callback) => callback(null, origin === viteOrigin ? viteOrigin : false),
    methods: ["GET"]
  });

  registerHealthRoute(app, runtime);
  registerSnapshotRoute(app, runtime);
  void app.register(async (instance) => {
    registerOpportunityWebsocket(instance, runtime, { heartbeatIntervalMs, maxBufferedBytes });
  });

  return app;
}
