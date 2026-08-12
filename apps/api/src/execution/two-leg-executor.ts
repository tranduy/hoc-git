import type { PreflightTicket, ProviderId } from "@tool-chenh/contracts";

type ExecutionLeg = PreflightTicket["legs"][number];
interface ExecutionLegIdentity {
  readonly provider: ProviderId;
  readonly providerSelectionId: string;
}
export type ExecutionLegResult = ExecutionLegIdentity & (
  | { readonly status: "ACCEPTED"; readonly reason: null }
  | { readonly status: "REJECTED"; readonly reason: "ODDS_CHANGED" | "MARKET_SUSPENDED" | "LIMIT_CHANGED" |
    "INSUFFICIENT_BALANCE" | "PROVIDER_REJECTED" }
  | { readonly status: "UNKNOWN"; readonly reason: "TIMEOUT" | "ADAPTER_ERROR" | "ADAPTER_UNAVAILABLE" |
    "IDENTITY_MISMATCH" }
);
export interface ExecutionLegAdapter {
  readonly provider: ProviderId;
  dryRun(leg: ExecutionLeg): Promise<ExecutionLegResult>;
}
export interface TwoLegExecutionResult {
  readonly ticketId: string;
  readonly idempotencyKey: string;
  readonly mode: "DRY_RUN";
  readonly status: "BOTH_ACCEPTED" | "NONE_ACCEPTED" | "PARTIAL_FAILURE";
  readonly legs: readonly [ExecutionLegResult, ExecutionLegResult];
}

function requestFingerprint(ticket: PreflightTicket): string {
  return JSON.stringify([ticket.ticketId, ticket.signature, ticket.nonce]);
}

export class TwoLegExecutor {
  readonly #adapters: ReadonlyMap<ProviderId, ExecutionLegAdapter>;
  readonly #verifyTicket: (ticket: PreflightTicket) => boolean;
  readonly #clock: { nowMs(): number };
  readonly #timeoutMs: number;
  readonly #requests = new Map<string, { fingerprint: string; result: Promise<TwoLegExecutionResult> }>();

  constructor(options: { readonly adapters: readonly ExecutionLegAdapter[];
    readonly verifyTicket: (ticket: PreflightTicket) => boolean; readonly clock?: { nowMs(): number };
    readonly timeoutMs?: number }) {
    this.#adapters = new Map(options.adapters.map((adapter) => [adapter.provider, adapter]));
    this.#verifyTicket = options.verifyTicket;
    this.#clock = options.clock ?? { nowMs: Date.now };
    this.#timeoutMs = options.timeoutMs ?? 3_000;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) throw new Error("EXECUTION_TIMEOUT_INVALID");
  }

  async execute(input: { readonly ticket: PreflightTicket; readonly idempotencyKey: string;
    readonly mode: "DRY_RUN" }): Promise<TwoLegExecutionResult> {
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 256) {
      throw new Error("EXECUTION_IDEMPOTENCY_KEY_INVALID");
    }
    const fingerprint = requestFingerprint(input.ticket);
    const existing = this.#requests.get(input.idempotencyKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) throw new Error("EXECUTION_IDEMPOTENCY_CONFLICT");
      return existing.result;
    }
    const result = this.#execute(input.ticket, input.idempotencyKey);
    this.#requests.set(input.idempotencyKey, { fingerprint, result });
    return result;
  }

  async #execute(ticket: PreflightTicket, idempotencyKey: string): Promise<TwoLegExecutionResult> {
    if (!this.#verifyTicket(ticket)) throw new Error("EXECUTION_TICKET_INVALID");
    if (ticket.expiresAtMs <= this.#clock.nowMs()) throw new Error("EXECUTION_TICKET_EXPIRED");
    if (ticket.legs.length !== 2 || ticket.legs[0].provider === ticket.legs[1].provider) {
      throw new Error("EXECUTION_TWO_PROVIDER_TICKET_REQUIRED");
    }
    const operations = ticket.legs.map((leg) => {
      const adapter = this.#adapters.get(leg.provider);
      if (adapter === undefined) return Promise.resolve<ExecutionLegResult>({ provider: leg.provider,
        providerSelectionId: leg.providerSelectionId, status: "UNKNOWN", reason: "ADAPTER_UNAVAILABLE" });
      return adapter.dryRun(leg).then((result): ExecutionLegResult => result.provider === leg.provider &&
        result.providerSelectionId === leg.providerSelectionId ? result : ({ provider: leg.provider,
          providerSelectionId: leg.providerSelectionId, status: "UNKNOWN", reason: "IDENTITY_MISMATCH" }))
        .catch((): ExecutionLegResult => ({ provider: leg.provider, providerSelectionId: leg.providerSelectionId,
          status: "UNKNOWN", reason: "ADAPTER_ERROR" }));
    });
    const settled = await Promise.all(operations.map((operation, index) => this.#withTimeout(operation, ticket.legs[index]!)));
    const legs = settled as [ExecutionLegResult, ExecutionLegResult];
    const accepted = legs.filter((leg) => leg.status === "ACCEPTED").length;
    const status = accepted === 2 ? "BOTH_ACCEPTED" as const
      : accepted === 0 && legs.every((leg) => leg.status === "REJECTED") ? "NONE_ACCEPTED" as const
        : "PARTIAL_FAILURE" as const;
    return { ticketId: ticket.ticketId, idempotencyKey, mode: "DRY_RUN", status, legs };
  }

  async #withTimeout(operation: Promise<ExecutionLegResult>, leg: ExecutionLeg): Promise<ExecutionLegResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ExecutionLegResult>((resolve) => {
      timer = setTimeout(() => resolve({ provider: leg.provider,
        providerSelectionId: leg.providerSelectionId, status: "UNKNOWN", reason: "TIMEOUT" }), this.#timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
