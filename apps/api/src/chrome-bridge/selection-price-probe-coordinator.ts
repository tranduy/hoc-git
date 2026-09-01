import { randomUUID } from "node:crypto";
import type { ChromeBridgeControlMessage, ChromeBridgeEnvelope, ProviderId } from "@tool-chenh/contracts";
import { z } from "zod";
import type { ChromeBridgeSourceSnapshot } from "./chrome-bridge-registry.js";

const ResultSchema = z.strictObject({
  requestId: z.string().min(1).max(128),
  providerEventId: z.string().min(1).max(512),
  providerMarketId: z.string().min(1).max(512),
  providerSelectionId: z.string().min(1).max(512),
  status: z.enum(["FOUND", "NOT_FOUND", "AMBIGUOUS"]),
  rawOdds: z.string().trim().regex(/^[+-]?\d+(?:\.\d+)?$/u).max(32).nullable(),
  observedAtMs: z.number().finite().nonnegative(),
  method: z.enum(["DOM", "IN_PAGE_FETCH"]).optional(),
  reason: z.union([z.enum(["IM_SELECTION_UNSUPPORTED", "IM_ID_NOT_FOUND", "IM_ID_AMBIGUOUS",
    "IM_ID_HIDDEN", "IM_PRICE_AMBIGUOUS", "IM_DIRECT_TOKEN_UNAVAILABLE", "IM_DIRECT_REQUEST_FAILED",
    "IM_DIRECT_SELECTION_NOT_FOUND", "IM_DIRECT_SELECTION_AMBIGUOUS", "EXACT_SELECTION_NOT_FOUND",
    "VISIBLE_PRICE_AMBIGUOUS",
    "BTI_DETAIL_REQUEST_FAILED", "BTI_DETAIL_INVALID_JSON", "BTI_EVENT_NOT_FOUND", "BTI_EVENT_AMBIGUOUS",
    "BTI_MARKET_NOT_FOUND",
    "BTI_MARKET_AMBIGUOUS", "BTI_SELECTION_NOT_FOUND", "BTI_SELECTION_AMBIGUOUS", "BTI_PRICE_INVALID",
    "TSPORT_SELECTION_NOT_FOUND", "TSPORT_SELECTION_NOT_RENDERED", "TSPORT_SELECTION_HIDDEN",
    "TSPORT_SELECTION_AMBIGUOUS", "TSPORT_EVENT_NOT_FOUND", "TSPORT_PARTICIPANTS_NOT_FOUND",
    "TSPORT_MARKET_NOT_FOUND", "TSPORT_OUTCOME_NOT_FOUND", "TSPORT_LINE_NOT_FOUND", "TSPORT_PRICE_NOT_FOUND",
    "SBOBET_DIRECT_REQUEST_UNAVAILABLE", "SBOBET_DIRECT_REQUEST_INVALID", "SBOBET_DIRECT_REQUEST_FAILED",
    "SBOBET_DIRECT_INVALID_JSON", "SBOBET_SELECTION_NOT_FOUND", "SBOBET_SELECTION_AMBIGUOUS"]),
  z.string().regex(/^(?:BTI_DETAIL|SBOBET_DIRECT|IM_DIRECT)_HTTP_\d{3}$/u),
  // A name this list has not met yet is still an answer. Rejecting it failed the
  // whole result, so the probe resolved nothing and the check reported TIMEOUT -
  // the one verdict that says nothing about the ticket. Measured 2026-09-01: a
  // probe that refused with SELECTION_IDENTITY_MISMATCH reached the API and was
  // dropped here, and the operator was shown a ten-second wait instead.
  //
  // The shape is what has to be checked, not the membership: bounded, upper
  // snake case, no values inside it.
  z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u)]).optional()
});

const providerLobbies: Readonly<Partial<Record<ProviderId, readonly string[]>>> = {
  SABA: ["SABA"], IM: ["IM"], SBOBET: ["KSPORT", "SBO"], CMD: ["CMD"],
  APSPORT: ["TSPORT"], BTI: ["BTI"]
};

export interface SelectionPriceProbeRequest {
  readonly provider: ProviderId;
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
  readonly eventLabel: string;
  readonly participantA: string;
  readonly participantB: string;
  readonly marketType: string;
  readonly scope: string;
  readonly selection: string;
  readonly line: string | null;
  readonly requestedAtMs: number;
}

export interface VisibleSelectionPrice {
  readonly rawOdds: string;
  readonly observedAtMs: number;
  readonly method: "DOM" | "IN_PAGE_FETCH";
}

interface PendingProbe {
  readonly sourceId: string;
  readonly request: SelectionPriceProbeRequest;
  readonly resolve: (result: VisibleSelectionPrice) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function directReadError(code: string, method: "DOM" | "IN_PAGE_FETCH"): Error {
  return Object.assign(new Error(code), { method });
}

export class SelectionPriceProbeCoordinator {
  readonly #listSources: () => readonly ChromeBridgeSourceSnapshot[];
  readonly #controlPlane: { probeSelectionPrice(sourceId: string, input: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "PROBE_SELECTION_PRICE" }>, "version" | "kind" | "sourceId">): boolean };
  readonly #idFactory: () => string;
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, PendingProbe>();

  constructor(options: { readonly listSources: () => readonly ChromeBridgeSourceSnapshot[];
    readonly controlPlane: { probeSelectionPrice(sourceId: string, input: Omit<Extract<ChromeBridgeControlMessage,
      { readonly kind: "PROBE_SELECTION_PRICE" }>, "version" | "kind" | "sourceId">): boolean };
    readonly idFactory?: () => string; readonly timeoutMs?: number }) {
    this.#listSources = options.listSources;
    this.#controlPlane = options.controlPlane;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs < 250) throw new Error("VISIBLE_PRICE_PROBE_OPTIONS_INVALID");
  }

  probe(request: SelectionPriceProbeRequest): Promise<VisibleSelectionPrice> {
    const lobbies = providerLobbies[request.provider] ?? [];
    const source = this.#listSources().filter((item) => lobbies.includes(item.lobby) && item.state === "LIVE")
      .sort((left, right) => right.lastAcceptedAtMs - left.lastAcceptedAtMs)[0];
    if (source === undefined) return Promise.reject(new Error("VISIBLE_PRICE_SOURCE_NOT_LIVE"));
    const requestId = this.#idFactory();
    return new Promise<VisibleSelectionPrice>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error("VISIBLE_PRICE_PROBE_TIMEOUT"));
      }, this.#timeoutMs);
      this.#pending.set(requestId, { sourceId: source.sourceId, request, resolve, reject, timer });
      const { provider: _provider, requestedAtMs: _requestedAtMs, ...identity } = request;
      if (this.#controlPlane.probeSelectionPrice(source.sourceId, { requestId, ...identity })) return;
      clearTimeout(timer);
      this.#pending.delete(requestId);
      reject(new Error("VISIBLE_PRICE_SOURCE_NOT_LIVE"));
    });
  }

  ingest(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.transport !== "DOM_SNAPSHOT" ||
      envelope.request.pathnameClass !== "/__fieldline_selection_price_probe__" ||
      envelope.payload.encoding !== "UTF8") return false;
    let json: unknown;
    try { json = JSON.parse(envelope.payload.body) as unknown; } catch { return false; }
    const parsed = ResultSchema.safeParse(json);
    if (!parsed.success) return false;
    const pending = this.#pending.get(parsed.data.requestId);
    if (pending === undefined || pending.sourceId !== envelope.sourceId ||
      pending.request.providerEventId !== parsed.data.providerEventId ||
      pending.request.providerMarketId !== parsed.data.providerMarketId ||
      pending.request.providerSelectionId !== parsed.data.providerSelectionId) return false;
    // The corresponding installed CMD bundle always used Runtime.evaluate on
    // the live DOM but did not yet serialize that method in its result.
    const method = parsed.data.method ??
      (pending.request.provider === "CMD" || pending.request.provider === "SABA" ? "DOM" : null);
    if (method === null) return false;
    clearTimeout(pending.timer);
    this.#pending.delete(parsed.data.requestId);
    if (parsed.data.observedAtMs < pending.request.requestedAtMs) {
      pending.reject(directReadError("VISIBLE_PRICE_NOT_FRESH", method));
    } else if (parsed.data.status !== "FOUND" || parsed.data.rawOdds === null) {
      const reason = parsed.data.reason;
      // CMD answers from the book's own catalog when the page never drew the
      // row, so its outcomes join the same two verdicts: the market is not on
      // offer, or the fixture matched more than once.
      const normalized = reason === "EXACT_SELECTION_NOT_FOUND" ||
        (/^(?:SBOBET|BTI|CMD)_.+_NOT_FOUND$/u.test(reason ?? "")) ||
        reason === "CMD_EVENT_NOT_IN_FEED" || reason === "CMD_SELECTION_NOT_ON_OFFER"
        ? "VISIBLE_PRICE_NOT_FOUND" : /^(?:SBOBET|BTI|CMD)_.+_AMBIGUOUS$/u.test(reason ?? "")
          ? "VISIBLE_PRICE_AMBIGUOUS" : reason;
      pending.reject(directReadError(normalized ??
        (parsed.data.status === "AMBIGUOUS" ? "VISIBLE_PRICE_AMBIGUOUS" : "VISIBLE_PRICE_NOT_FOUND"),
      method));
    } else {
      pending.resolve({ rawOdds: parsed.data.rawOdds, observedAtMs: parsed.data.observedAtMs,
        method });
    }
    return true;
  }
}
