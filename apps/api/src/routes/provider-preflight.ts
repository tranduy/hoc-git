import { randomUUID } from "node:crypto";
import { ProviderTicketPreflightRequestSchema, ProviderTicketPreflightSchema,
  TicketRealtimeCheckRequestSchema, TicketRealtimeCheckResponseSchema,
  type ProviderTicketPreflight, type ProviderTicketPreflightRequest, type TicketRealtimeCheckLegResult,
  type TicketRealtimeCheckRequest, type TicketRealtimeCheckResponse,
  type TicketRealtimeDisplayedLeg } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import type { FastifyInstance } from "fastify";

export interface ProviderPreflightLike {
  preflight(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight>;
}

export type TicketRealtimeAuditJournalEntry =
  | { readonly type: "DISPLAY_CAPTURED"; readonly checkId: string; readonly atMs: number;
      readonly request: TicketRealtimeCheckRequest }
  | { readonly type: "CHECK_COMPLETED"; readonly checkId: string; readonly atMs: number;
      readonly legs: readonly [TicketRealtimeCheckLegResult, TicketRealtimeCheckLegResult] };

export interface TicketRealtimeAuditJournal {
  append(entry: TicketRealtimeAuditJournalEntry): Promise<void>;
}

export interface ProviderPreflightRouteOptions {
  readonly journal?: TicketRealtimeAuditJournal;
  readonly clock?: { nowMs(): number };
  readonly idFactory?: () => string;
  readonly requestTimeoutMs?: number;
}

function identityMatches(displayed: TicketRealtimeDisplayedLeg, direct: ProviderTicketPreflight): boolean {
  return direct.provider === displayed.provider && direct.accountId === displayed.accountId &&
    direct.providerEventId === displayed.providerEventId && direct.providerMarketId === displayed.providerMarketId &&
    direct.providerSelectionId === displayed.providerSelectionId && direct.selection === displayed.selection &&
    direct.line === displayed.line;
}

function directStatus(displayed: TicketRealtimeDisplayedLeg, direct: ProviderTicketPreflight):
TicketRealtimeCheckLegResult["status"] {
  if (!identityMatches(displayed, direct)) return "IDENTITY_MISMATCH";
  if (direct.quoteStatus !== "OPEN") return "MARKET_NOT_OPEN";
  return new Decimal(direct.decimalOdds).eq(new Decimal(displayed.decimalOdds)) ? "MATCH" : "ODDS_CHANGED";
}

const knownProviderErrors = new Set(["PREFLIGHT_ACCOUNT_NOT_FOUND", "PREFLIGHT_ACCOUNT_UNAVAILABLE",
  "PREFLIGHT_IDENTITY_MISMATCH", "PREFLIGHT_PROVIDER_UNSUPPORTED", "PREFLIGHT_TIMEOUT", "PREFLIGHT_UNAVAILABLE"]);

function safeProviderError(error: unknown): { readonly status: TicketRealtimeCheckLegResult["status"];
  readonly code: string } {
  const candidate = error instanceof Error ? error.message : "PREFLIGHT_UNAVAILABLE";
  const code = knownProviderErrors.has(candidate) ? candidate : "PREFLIGHT_UNAVAILABLE";
  if (code === "PREFLIGHT_IDENTITY_MISMATCH") return { status: "IDENTITY_MISMATCH", code };
  if (code === "PREFLIGHT_PROVIDER_UNSUPPORTED") return { status: "UNSUPPORTED", code };
  if (code === "PREFLIGHT_TIMEOUT") return { status: "TIMEOUT", code };
  if (code === "PREFLIGHT_ACCOUNT_NOT_FOUND" || code === "PREFLIGHT_ACCOUNT_UNAVAILABLE" ||
    code === "PREFLIGHT_UNAVAILABLE") return { status: "SOURCE_UNAVAILABLE", code };
  return { status: "ERROR", code: "PREFLIGHT_UNAVAILABLE" };
}

async function checkLeg(preflight: ProviderPreflightLike, displayed: TicketRealtimeDisplayedLeg,
  clock: { nowMs(): number }, timeoutMs: number): Promise<TicketRealtimeCheckLegResult> {
  const startedAtMs = clock.nowMs();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const directRead = preflight.preflight({
      accountId: displayed.accountId, providerEventId: displayed.providerEventId,
      providerMarketId: displayed.providerMarketId, providerSelectionId: displayed.providerSelectionId,
      selection: displayed.selection, line: displayed.line, expectedDecimalOdds: displayed.decimalOdds,
      requestedStake: displayed.requestedStake
    });
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("PREFLIGHT_TIMEOUT")), timeoutMs);
    });
    const direct = ProviderTicketPreflightSchema.parse(await Promise.race([directRead, deadline]));
    const completedAtMs = clock.nowMs();
    const status = directStatus(displayed, direct);
    return { status, displayed, direct, error: status === "IDENTITY_MISMATCH" ? "PREFLIGHT_IDENTITY_MISMATCH" : null,
      startedAtMs, completedAtMs, elapsedMs: Math.max(0, completedAtMs - startedAtMs) };
  } catch (error) {
    const completedAtMs = clock.nowMs();
    const safe = safeProviderError(error);
    return { status: safe.status, displayed, direct: null, error: safe.code,
      startedAtMs, completedAtMs, elapsedMs: Math.max(0, completedAtMs - startedAtMs) };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function checkTicket(preflight: ProviderPreflightLike, input: TicketRealtimeCheckRequest,
  options: ProviderPreflightRouteOptions): Promise<TicketRealtimeCheckResponse> {
  const clock = options.clock ?? { nowMs: Date.now };
  const checkId = options.idFactory?.() ?? randomUUID();
  const timeoutMs = Number.isFinite(options.requestTimeoutMs) && (options.requestTimeoutMs ?? 0) > 0
    ? Math.floor(options.requestTimeoutMs as number) : 10_000;
  let persisted = options.journal !== undefined;
  try {
    await options.journal?.append({ type: "DISPLAY_CAPTURED", checkId, atMs: clock.nowMs(), request: input });
  } catch { persisted = false; }
  const checked = await Promise.all(input.legs.map((leg) => checkLeg(preflight, leg, clock, timeoutMs)));
  const legs = checked as [TicketRealtimeCheckLegResult, TicketRealtimeCheckLegResult];
  const completedAtMs = clock.nowMs();
  try {
    await options.journal?.append({ type: "CHECK_COMPLETED", checkId, atMs: completedAtMs, legs });
  } catch { persisted = false; }
  return TicketRealtimeCheckResponseSchema.parse({ checkId, eventLabel: input.eventLabel,
    marketType: input.marketType, scope: input.scope, capturedAtMs: input.capturedAtMs,
    completedAtMs, persisted, legs });
}

export function registerProviderPreflightRoutes(app: FastifyInstance, preflight: ProviderPreflightLike,
  options: ProviderPreflightRouteOptions = {}): void {
  app.post("/api/preflight/provider", async (request, reply) => {
    const parsed = ProviderTicketPreflightRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    try {
      return ProviderTicketPreflightSchema.parse(await preflight.preflight(parsed.data));
    } catch (error) {
      const code = error instanceof Error ? error.message : "PREFLIGHT_UNAVAILABLE";
      if (code === "PREFLIGHT_ACCOUNT_NOT_FOUND") return reply.code(404).send({ error: code });
      if (code === "PREFLIGHT_ACCOUNT_UNAVAILABLE") return reply.code(409).send({ error: code });
      if (code === "PREFLIGHT_IDENTITY_MISMATCH") return reply.code(422).send({ error: code });
      return reply.code(503).send({ error: code === "PREFLIGHT_PROVIDER_UNSUPPORTED" ? code : "PREFLIGHT_UNAVAILABLE" });
    }
  });
  app.post("/api/preflight/realtime-check", async (request, reply) => {
    const parsed = TicketRealtimeCheckRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    try {
      return await checkTicket(preflight, parsed.data, options);
    } catch {
      return reply.code(503).send({ error: "REALTIME_CHECK_UNAVAILABLE" });
    }
  });
}
