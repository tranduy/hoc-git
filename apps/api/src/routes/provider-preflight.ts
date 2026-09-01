import { randomUUID } from "node:crypto";
import { ProviderTicketPreflightRequestSchema, ProviderTicketPreflightSchema,
  TicketRealtimeCheckRequestSchema, TicketRealtimeCheckResponseSchema,
  type ProviderTicketPreflight, type ProviderTicketPreflightRequest, type TicketRealtimeCheckLegResult,
  type TicketRealtimeCheckRequest, type TicketRealtimeCheckResponse,
  type TicketRealtimeDisplayedLeg } from "@tool-chenh/contracts";
import { Decimal, toDecimal } from "@tool-chenh/core";
import type { FastifyInstance } from "fastify";

export interface TicketReportRequest {
  readonly eventKey: string;
  readonly ticketKey: string;
  readonly reason: string;
  readonly reportedAtMs: number;
  readonly competition: string;
  readonly startAtUtcMs: number;
  readonly display: TicketRealtimeCheckRequest;
  readonly estimate: { readonly state: string; readonly roi: string | null;
    readonly worstCaseProfit: string | null; readonly totalStake: string | null;
    readonly movementMagnitude: string };
  readonly realtimeCheck: TicketRealtimeCheckResponse | null;
}
export interface TicketReportEntry {
  readonly reportId: string;
  readonly createdAtMs: number;
  readonly request: TicketReportRequest;
}
export interface TicketReportJournal {
  append(entry: TicketReportEntry): Promise<void>;
  list(eventKey: string): Promise<readonly TicketReportEntry[]>;
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parseTicketReportRequest(value: unknown): TicketReportRequest | null {
  const input = record(value); const estimate = record(input?.estimate);
  if (input === null || estimate === null) return null;
  const eventKey = boundedString(input.eventKey, 512); const ticketKey = boundedString(input.ticketKey, 512);
  const reason = boundedString(input.reason, 2_000); const competition = boundedString(input.competition, 512);
  const state = boundedString(estimate.state, 64); const movementMagnitude = boundedString(estimate.movementMagnitude, 128);
  const optional = (candidate: unknown): string | null | undefined => candidate === null ? null : boundedString(candidate, 128) ?? undefined;
  const roi = optional(estimate.roi); const worstCaseProfit = optional(estimate.worstCaseProfit);
  const totalStake = optional(estimate.totalStake);
  const display = TicketRealtimeCheckRequestSchema.safeParse(input.display);
  const realtimeCheck = input.realtimeCheck === null ? null : TicketRealtimeCheckResponseSchema.safeParse(input.realtimeCheck);
  if (eventKey === null || ticketKey === null || reason === null || competition === null || state === null ||
    movementMagnitude === null || roi === undefined || worstCaseProfit === undefined || totalStake === undefined ||
    typeof input.reportedAtMs !== "number" || !Number.isFinite(input.reportedAtMs) || input.reportedAtMs < 0 ||
    typeof input.startAtUtcMs !== "number" || !Number.isFinite(input.startAtUtcMs) || input.startAtUtcMs < 0 ||
    !display.success || (realtimeCheck !== null && !realtimeCheck.success)) return null;
  return { eventKey, ticketKey, reason, reportedAtMs: input.reportedAtMs, competition,
    startAtUtcMs: input.startAtUtcMs, display: display.data,
    estimate: { state, roi, worstCaseProfit, totalStake, movementMagnitude },
    realtimeCheck: realtimeCheck === null ? null : realtimeCheck.data };
}

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
  readonly reportJournal?: TicketReportJournal;
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
  const providerSelection = displayed.providerSelection ?? displayed.selection;
  const providerLine = displayed.providerLine === undefined ? displayed.line : displayed.providerLine;
  return direct.provider === displayed.provider && direct.accountId === displayed.accountId &&
    direct.providerEventId === displayed.providerEventId && direct.providerMarketId === displayed.providerMarketId &&
    direct.providerSelectionId === displayed.providerSelectionId && direct.selection === providerSelection &&
    direct.line === providerLine;
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
  "IM_ID_AMBIGUOUS", "IM_ID_HIDDEN", "IM_PRICE_AMBIGUOUS", "IM_DIRECT_TOKEN_UNAVAILABLE",
  "IM_DIRECT_REQUEST_FAILED", "IM_DIRECT_SELECTION_NOT_FOUND", "IM_DIRECT_SELECTION_AMBIGUOUS"]);

function safeProviderError(error: unknown): { readonly status: TicketRealtimeCheckLegResult["status"];
  readonly verificationStatus: TicketRealtimeCheckLegResult["verificationStatus"];
  readonly directMethod: TicketRealtimeCheckLegResult["directMethod"]; readonly code: string } {
  const candidate = error instanceof Error ? error.message : "PREFLIGHT_UNAVAILABLE";
  const method = typeof error === "object" && error !== null && "method" in error &&
    ((error as { method?: unknown }).method === "DOM" || (error as { method?: unknown }).method === "IN_PAGE_FETCH")
    ? (error as { method: "DOM" | "IN_PAGE_FETCH" }).method : null;
  const providerReadFailure = /^(?:SBOBET_(?:DIRECT|SELECTION)|BTI_(?:DETAIL|EVENT|MARKET|SELECTION|PRICE)|TSPORT_(?:SELECTION|EVENT|PARTICIPANTS|MARKET|OUTCOME|LINE|PRICE)|IM_DIRECT_(?:TOKEN|REQUEST|HTTP))_[A-Z0-9_]+$/u
    .test(candidate);
  // A name this list has not met yet still says more than PREFLIGHT_UNAVAILABLE,
  // which says only that something went wrong somewhere. The check is the shape,
  // not the membership: bounded, upper snake case, so nothing from a provider
  // body can arrive here as free text.
  const shapedName = /^[A-Z][A-Z0-9_]{0,63}$/u.test(candidate);
  const code = knownProviderErrors.has(candidate) || providerReadFailure || shapedName
    ? candidate : "PREFLIGHT_UNAVAILABLE";
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
  if (code === "VISIBLE_PRICE_NOT_FOUND" || code === "VISIBLE_PRICE_AMBIGUOUS" ||
    (code.startsWith("IM_") && !providerReadFailure) ||
    (code.startsWith("TSPORT_") && (code.endsWith("_NOT_FOUND") || code.endsWith("_NOT_RENDERED") ||
      code.endsWith("_HIDDEN")))) {
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
    const providerSelection = displayed.providerSelection ?? displayed.selection;
    const providerLine = displayed.providerLine === undefined ? displayed.line : displayed.providerLine;
    const providerParticipantA = displayed.providerParticipantA ?? ticket.participantA;
    const providerParticipantB = displayed.providerParticipantB ?? ticket.participantB;
    const providerEventLabel = `${providerParticipantA} vs ${providerParticipantB}`;
    const directRead = visiblePriceProbe === undefined ? preflight.preflight({
      accountId: displayed.accountId, providerEventId: displayed.providerEventId,
      providerMarketId: displayed.providerMarketId, providerSelectionId: displayed.providerSelectionId,
      selection: providerSelection, line: providerLine, expectedDecimalOdds: displayed.decimalOdds,
      requestedStake: displayed.requestedStake
    }) : visiblePriceProbe.probe({ provider: displayed.provider, providerEventId: displayed.providerEventId,
      providerMarketId: displayed.providerMarketId, providerSelectionId: displayed.providerSelectionId,
      eventLabel: providerEventLabel, participantA: providerParticipantA, participantB: providerParticipantB,
      marketType: ticket.marketType, scope: ticket.scope,
      selection: providerSelection, line: providerLine,
      requestedAtMs }).then((visible): ProviderTicketPreflight => {
      if (visible.observedAtMs < requestedAtMs) throw new Error("VISIBLE_PRICE_NOT_FRESH");
      directMethod = visible.method;
      const decimalOdds = toDecimal(visible.rawOdds, displayed.rawFormat);
      const normalized = decimalOdds.toFixed(decimalOdds.decimalPlaces());
      return { accountId: displayed.accountId, provider: displayed.provider,
        providerEventId: displayed.providerEventId, providerMarketId: displayed.providerMarketId,
        providerSelectionId: displayed.providerSelectionId, selection: providerSelection, line: providerLine,
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
  app.post("/api/ticket-reports", async (request, reply) => {
    const parsed = parseTicketReportRequest(request.body);
    if (parsed === null) return reply.code(400).send({ error: "INVALID_TICKET_REPORT" });
    if (options.reportJournal === undefined) return reply.code(503).send({ error: "TICKET_REPORT_UNAVAILABLE" });
    const clock = options.clock ?? { nowMs: Date.now };
    const entry: TicketReportEntry = { reportId: options.idFactory?.() ?? randomUUID(),
      createdAtMs: clock.nowMs(), request: parsed };
    try {
      await options.reportJournal.append(entry);
      return reply.code(201).send(entry);
    } catch {
      return reply.code(503).send({ error: "TICKET_REPORT_UNAVAILABLE" });
    }
  });
  app.get("/api/ticket-reports", async (request, reply) => {
    const eventKey = boundedString(record(request.query)?.eventKey, 512);
    if (eventKey === null) return reply.code(400).send({ error: "INVALID_TICKET_REPORT_QUERY" });
    if (options.reportJournal === undefined) return reply.code(503).send({ error: "TICKET_REPORT_UNAVAILABLE" });
    try {
      return { reports: await options.reportJournal.list(eventKey) };
    } catch {
      return reply.code(503).send({ error: "TICKET_REPORT_UNAVAILABLE" });
    }
  });
}
