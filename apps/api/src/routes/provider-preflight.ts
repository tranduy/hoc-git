import { randomUUID } from "node:crypto";
import { ProviderTicketPreflightRequestSchema, ProviderTicketPreflightSchema,
  TicketRealtimeCheckRequestSchema, TicketRealtimeCheckResponseSchema,
  type ProviderTicketPreflight, type ProviderTicketPreflightRequest, type TicketRealtimeCheckLegResult,
  type TicketRealtimeCheckRequest, type TicketRealtimeCheckResponse,
  type TicketRealtimeDisplayedLeg } from "@tool-chenh/contracts";
import { Decimal, toDecimal } from "@tool-chenh/core";
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
  readonly visiblePriceProbe?: { probe(input: { readonly provider: TicketRealtimeDisplayedLeg["provider"];
    readonly providerEventId: string; readonly providerMarketId: string; readonly providerSelectionId: string;
    readonly eventLabel: string; readonly participantA: string; readonly participantB: string;
    readonly marketType: string; readonly scope: string;
    readonly selection: string; readonly line: string | null;
    readonly requestedAtMs: number }): Promise<{ readonly rawOdds: string; readonly observedAtMs: number;
      readonly method: "DOM" | "IN_PAGE_FETCH" }> };
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
  if (direct.rawFormat === displayed.rawFormat &&
    new Decimal(direct.rawOdds).eq(new Decimal(displayed.rawOdds))) return "MATCH";
  return new Decimal(direct.decimalOdds).eq(new Decimal(displayed.decimalOdds)) ? "MATCH" : "ODDS_CHANGED";
}

const knownProviderErrors = new Set(["PREFLIGHT_ACCOUNT_NOT_FOUND", "PREFLIGHT_ACCOUNT_UNAVAILABLE",
  "PREFLIGHT_IDENTITY_MISMATCH", "PREFLIGHT_PROVIDER_UNSUPPORTED", "PREFLIGHT_TIMEOUT", "PREFLIGHT_UNAVAILABLE",
  "VISIBLE_PRICE_SOURCE_NOT_LIVE", "VISIBLE_PRICE_PROBE_TIMEOUT", "VISIBLE_PRICE_NOT_FRESH",
  "VISIBLE_PRICE_NOT_FOUND", "VISIBLE_PRICE_AMBIGUOUS", "IM_SELECTION_UNSUPPORTED", "IM_ID_NOT_FOUND",
  "IM_ID_AMBIGUOUS", "IM_ID_HIDDEN", "IM_PRICE_AMBIGUOUS"]);

function safeProviderError(error: unknown): { readonly status: TicketRealtimeCheckLegResult["status"];
  readonly verificationStatus: TicketRealtimeCheckLegResult["verificationStatus"];
  readonly directMethod: TicketRealtimeCheckLegResult["directMethod"]; readonly code: string } {
  const candidate = error instanceof Error ? error.message : "PREFLIGHT_UNAVAILABLE";
  const method = typeof error === "object" && error !== null && "method" in error &&
    ((error as { method?: unknown }).method === "DOM" || (error as { method?: unknown }).method === "IN_PAGE_FETCH")
    ? (error as { method: "DOM" | "IN_PAGE_FETCH" }).method : null;
  const providerReadFailure = /^(?:SBOBET_(?:DIRECT|SELECTION)|BTI_(?:DETAIL|EVENT|MARKET|SELECTION|PRICE))_[A-Z0-9_]+$/u
    .test(candidate);
  const code = knownProviderErrors.has(candidate) || providerReadFailure ? candidate : "PREFLIGHT_UNAVAILABLE";
  if (code === "PREFLIGHT_IDENTITY_MISMATCH") {
    return { status: "IDENTITY_MISMATCH", verificationStatus: "NOT_FOUND", directMethod: method, code };
  }
  if (code === "PREFLIGHT_PROVIDER_UNSUPPORTED") {
    return { status: "UNSUPPORTED", verificationStatus: null, directMethod: method, code };
  }
  if (code === "PREFLIGHT_TIMEOUT" || code === "VISIBLE_PRICE_PROBE_TIMEOUT") {
    return { status: "TIMEOUT", verificationStatus: null, directMethod: method, code };
  }
  if (code === "VISIBLE_PRICE_AMBIGUOUS" || /_AMBIGUOUS$/u.test(code)) {
    return { status: "IDENTITY_MISMATCH", verificationStatus: "AMBIGUOUS", directMethod: method, code };
  }
  if (code === "VISIBLE_PRICE_NOT_FOUND" || code === "VISIBLE_PRICE_AMBIGUOUS" || code.startsWith("IM_")) {
    return { status: "IDENTITY_MISMATCH", verificationStatus: "NOT_FOUND", directMethod: method, code };
  }
  if (code === "PREFLIGHT_ACCOUNT_NOT_FOUND" || code === "PREFLIGHT_ACCOUNT_UNAVAILABLE" ||
    code === "PREFLIGHT_UNAVAILABLE" || code === "VISIBLE_PRICE_SOURCE_NOT_LIVE" || providerReadFailure) {
    return { status: "SOURCE_UNAVAILABLE", verificationStatus: null, directMethod: method, code };
  }
  return { status: "ERROR", verificationStatus: null, directMethod: method, code: "PREFLIGHT_UNAVAILABLE" };
}

async function checkLeg(preflight: ProviderPreflightLike, displayed: TicketRealtimeDisplayedLeg,
  clock: { nowMs(): number }, timeoutMs: number,
  visiblePriceProbe: ProviderPreflightRouteOptions["visiblePriceProbe"], requestedAtMs: number,
  ticket: Pick<TicketRealtimeCheckRequest, "eventLabel" | "participantA" | "participantB" |
    "marketType" | "scope">):
Promise<TicketRealtimeCheckLegResult> {
  const startedAtMs = clock.nowMs();
  let directMethod: TicketRealtimeCheckLegResult["directMethod"] = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const directRead = visiblePriceProbe === undefined ? preflight.preflight({
      accountId: displayed.accountId, providerEventId: displayed.providerEventId,
      providerMarketId: displayed.providerMarketId, providerSelectionId: displayed.providerSelectionId,
      selection: displayed.selection, line: displayed.line, expectedDecimalOdds: displayed.decimalOdds,
      requestedStake: displayed.requestedStake
    }) : visiblePriceProbe.probe({ provider: displayed.provider, providerEventId: displayed.providerEventId,
      providerMarketId: displayed.providerMarketId, providerSelectionId: displayed.providerSelectionId,
      eventLabel: ticket.eventLabel, participantA: ticket.participantA, participantB: ticket.participantB,
      marketType: ticket.marketType, scope: ticket.scope,
      selection: displayed.selection, line: displayed.line,
      requestedAtMs }).then((visible): ProviderTicketPreflight => {
      if (visible.observedAtMs < requestedAtMs) throw new Error("VISIBLE_PRICE_NOT_FRESH");
      directMethod = visible.method;
      const decimalOdds = toDecimal(visible.rawOdds, displayed.rawFormat);
      const normalized = decimalOdds.toFixed(decimalOdds.decimalPlaces());
      return { accountId: displayed.accountId, provider: displayed.provider,
        providerEventId: displayed.providerEventId, providerMarketId: displayed.providerMarketId,
        providerSelectionId: displayed.providerSelectionId, selection: displayed.selection, line: displayed.line,
        rawOdds: visible.rawOdds, rawFormat: displayed.rawFormat, decimalOdds: normalized, quoteStatus: "OPEN",
        providerObservedAtMs: visible.observedAtMs, receivedMonotonicMs: performance.now(), sequence: null,
        limitEvidence: null, constraint: null, eligible: false, reasons: ["LIMIT_UNAVAILABLE"] };
    });
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("PREFLIGHT_TIMEOUT")), timeoutMs);
    });
    const direct = ProviderTicketPreflightSchema.parse(await Promise.race([directRead, deadline]));
    const completedAtMs = clock.nowMs();
    const status = directStatus(displayed, direct);
    const verificationStatus = status === "MATCH" ? "MATCH" : status === "ODDS_CHANGED" ? "MISMATCH" : "NOT_FOUND";
    return { status, verificationStatus, directMethod, displayed, direct,
      error: status === "IDENTITY_MISMATCH" ? "PREFLIGHT_IDENTITY_MISMATCH" : null,
      startedAtMs, completedAtMs, elapsedMs: Math.max(0, completedAtMs - startedAtMs) };
  } catch (error) {
    const completedAtMs = clock.nowMs();
    const safe = safeProviderError(error);
    return { status: safe.status, verificationStatus: safe.verificationStatus, directMethod: safe.directMethod,
      displayed, direct: null, error: safe.code,
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
  const checked = await Promise.all(input.legs.map((leg) =>
    checkLeg(preflight, leg, clock, timeoutMs, options.visiblePriceProbe, input.capturedAtMs, input)));
  const legs = checked as [TicketRealtimeCheckLegResult, TicketRealtimeCheckLegResult];
  const completedAtMs = clock.nowMs();
  try {
    await options.journal?.append({ type: "CHECK_COMPLETED", checkId, atMs: completedAtMs, legs });
  } catch { persisted = false; }
  return TicketRealtimeCheckResponseSchema.parse({ checkId, eventLabel: input.eventLabel,
    participantA: input.participantA, participantB: input.participantB,
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
