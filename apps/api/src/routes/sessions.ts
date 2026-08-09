import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { DomainDiscovery } from "../sessions/domain-discovery.js";
import { SessionManager } from "../sessions/session-manager.js";
import { TrustedDomainStore } from "../sessions/trusted-domain-store.js";

export interface SessionServices {
  readonly manager: SessionManager;
  readonly discovery: DomainDiscovery;
  readonly trustStore: TrustedDomainStore;
}

interface RateBucket {
  count: number;
  resetAtMs: number;
}

export class SessionRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #clock: { nowMs(): number };
  readonly #buckets = new Map<string, RateBucket>();

  constructor(options: { limit?: number; windowMs?: number; clock?: { nowMs(): number } } = {}) {
    this.#limit = options.limit ?? 20;
    this.#windowMs = options.windowMs ?? 60_000;
    this.#clock = options.clock ?? { nowMs: Date.now };
  }

  consume(key: string): boolean {
    const nowMs = this.#clock.nowMs();
    const current = this.#buckets.get(key);
    if (current === undefined || nowMs >= current.resetAtMs) {
      this.#buckets.set(key, { count: 1, resetAtMs: nowMs + this.#windowMs });
      return true;
    }
    if (current.count >= this.#limit) return false;
    current.count += 1;
    return true;
  }
}

const entryUrlBody = z.strictObject({ entryUrl: z.string().trim().min(1).max(2_048) });
const trustBody = z.strictObject({ hostname: z.string().trim().min(1).max(253) });
const fabetBody = z.strictObject({
  entryUrl: z.string().trim().min(1).max(2_048),
  trustedHostname: z.string().trim().min(1).max(253),
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(1_024)
});
const manualBody = z.strictObject({
  provider: z.string().trim().min(1).max(64),
  kind: z.enum(["TOKEN", "COOKIE_BUNDLE", "LAUNCH_URL"]),
  secret: z.string().min(1).max(24_000)
});
const sessionParams = z.strictObject({ id: z.string().trim().min(1).max(128) });
const resetBody = z.strictObject({ confirmation: z.literal("RESET_FABET") });

function invalid(reply: FastifyReply) {
  return reply.code(400).send({ error: "INVALID_REQUEST" });
}

function safeFailure(reply: FastifyReply, error: unknown) {
  const code = typeof error === "object" && error !== null && typeof (error as Record<string, unknown>).code === "string"
    ? String((error as Record<string, unknown>).code)
    : "SESSION_OPERATION_FAILED";
  const status = code === "DOMAIN_APPROVAL_REQUIRED" ? 409
    : code === "UNAUTHORIZED" ? 401
    : code === "UNREACHABLE" || code === "VAULT_UNAVAILABLE" ? 503
    : code === "SESSION_NOT_FOUND" ? 404
    : 400;
  return reply.code(status).send({ error: code });
}

export function registerSessionRoutes(
  app: FastifyInstance,
  services: SessionServices,
  limiter = new SessionRateLimiter()
): void {
  const consume = (ip: string, reply: FastifyReply): boolean => {
    if (limiter.consume(ip)) return true;
    void reply.code(429).send({ error: "RATE_LIMITED" });
    return false;
  };

  app.get("/api/sessions", async () => services.manager.listStatuses());

  app.post("/api/sessions/fabet/discover", async (request, reply) => {
    if (!consume(request.ip, reply)) return;
    const parsed = entryUrlBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    try {
      return await services.discovery.discover(parsed.data.entryUrl);
    } catch (error) {
      return safeFailure(reply, error);
    }
  });

  app.post("/api/sessions/fabet/trust", async (request, reply) => {
    if (!consume(request.ip, reply)) return;
    const parsed = trustBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    try {
      await services.trustStore.approve(parsed.data.hostname);
      return { hostname: parsed.data.hostname.toLowerCase(), trusted: true };
    } catch (error) {
      return safeFailure(reply, error);
    }
  });

  app.post("/api/sessions/fabet/configure", async (request, reply) => {
    if (!consume(request.ip, reply)) return;
    const parsed = fabetBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    try {
      return await services.manager.configureFabet(parsed.data);
    } catch (error) {
      return safeFailure(reply, error);
    }
  });

  app.post("/api/sessions/manual", async (request, reply) => {
    if (!consume(request.ip, reply)) return;
    const parsed = manualBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    try {
      return await services.manager.configureManual(parsed.data);
    } catch (error) {
      return safeFailure(reply, error);
    }
  });

  app.post("/api/sessions/:id/validate", async (request, reply) => {
    if (!consume(request.ip, reply)) return;
    const parsed = sessionParams.safeParse(request.params);
    if (!parsed.success) return invalid(reply);
    try {
      return await services.manager.validate(parsed.data.id);
    } catch (error) {
      return safeFailure(reply, error);
    }
  });

  app.post("/api/sessions/:id/renew", async (request, reply) => {
    if (!consume(request.ip, reply)) return;
    const parsed = sessionParams.safeParse(request.params);
    if (!parsed.success) return invalid(reply);
    try {
      return await services.manager.renew(parsed.data.id);
    } catch (error) {
      return safeFailure(reply, error);
    }
  });

  app.post("/api/sessions/fabet/reset", async (request, reply) => {
    if (!consume(request.ip, reply)) return;
    const parsed = resetBody.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    try {
      await services.manager.resetFabet();
      return { reset: true };
    } catch (error) {
      return safeFailure(reply, error);
    }
  });
}
