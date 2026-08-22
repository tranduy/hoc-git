import type { PreflightLeg, PreflightTicket, ProviderId } from "@tool-chenh/contracts";

export type LiveLegResult = { readonly provider: ProviderId; readonly providerSelectionId: string } & (
  | { readonly status: "ACCEPTED"; readonly receiptId: string }
  | { readonly status: "REJECTED"; readonly receiptId: null; readonly reason: "PROVIDER_REJECTED" |
    "ODDS_CHANGED" | "MARKET_SUSPENDED" | "LIMIT_CHANGED" }
  | { readonly status: "UNKNOWN"; readonly receiptId: null; readonly reason: "TIMEOUT" | "ADAPTER_ERROR" |
    "IDENTITY_MISMATCH" }
);

export interface PreparedLiveLeg {
  readonly provider: ProviderId;
  readonly providerSelectionId: string;
  commit(): Promise<LiveLegResult>;
  cancel(): Promise<void>;
}

export interface LiveExecutionAdapter {
  readonly provider: ProviderId;
  prepare(leg: PreflightLeg): Promise<PreparedLiveLeg>;
}

export type LiveTwoLegResult =
  | { readonly ticketId: string; readonly status: "NOT_SUBMITTED"; readonly legs: readonly [] }
  | { readonly ticketId: string; readonly status: "BOTH_ACCEPTED" | "NONE_ACCEPTED" | "PARTIAL_FAILURE";
    readonly legs: readonly [LiveLegResult, LiveLegResult] };

export interface LiveExecutionJournal {
  claim(ticket: PreflightTicket): Promise<{ readonly status: "CLAIMED" } |
    { readonly status: "IN_DOUBT"; readonly phase: "CLAIMED" | "COMMITTING" } |
    { readonly status: "COMPLETED"; readonly result: LiveTwoLegResult } |
    { readonly status: "CONFLICT" }>;
  markCommitting(ticket: PreflightTicket): Promise<void>;
  complete(ticket: PreflightTicket, result: LiveTwoLegResult): Promise<void>;
}

export class LiveTwoLegCoordinator {
  readonly #adapters: ReadonlyMap<ProviderId, LiveExecutionAdapter>;
  readonly #verifyTicket: (ticket: PreflightTicket) => boolean;
  readonly #consumeArm: (ticketId: string, armToken: string) => boolean;
  readonly #clock: { nowMs(): number };
  readonly #timeoutMs: number;
  readonly #tripKillSwitch: (result: LiveTwoLegResult) => void;
  readonly #journal: LiveExecutionJournal | null;

  constructor(options: { readonly adapters: readonly LiveExecutionAdapter[];
    readonly verifyTicket: (ticket: PreflightTicket) => boolean;
    readonly consumeArm: (ticketId: string, armToken: string) => boolean;
    readonly clock?: { nowMs(): number }; readonly timeoutMs?: number;
    readonly journal?: LiveExecutionJournal;
    readonly tripKillSwitch: (result: LiveTwoLegResult) => void }) {
    this.#adapters = new Map(options.adapters.map((adapter) => [adapter.provider, adapter]));
    this.#verifyTicket = options.verifyTicket; this.#consumeArm = options.consumeArm;
    this.#clock = options.clock ?? { nowMs: Date.now }; this.#timeoutMs = options.timeoutMs ?? 3_000;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) throw new Error("LIVE_TIMEOUT_INVALID");
    this.#journal = options.journal ?? null;
    this.#tripKillSwitch = options.tripKillSwitch;
  }

  async execute(input: { readonly ticket: PreflightTicket; readonly armToken: string }): Promise<LiveTwoLegResult> {
    if (!this.#verifyTicket(input.ticket)) throw new Error("LIVE_TICKET_INVALID");
    if (input.ticket.expiresAtMs <= this.#clock.nowMs()) throw new Error("LIVE_TICKET_EXPIRED");
    if (input.ticket.legs[0].provider === input.ticket.legs[1].provider) throw new Error("LIVE_TWO_PROVIDERS_REQUIRED");
    if (!this.#consumeArm(input.ticket.ticketId, input.armToken)) throw new Error("LIVE_ARM_INVALID");
    const claim = await this.#journal?.claim(input.ticket) ?? { status: "CLAIMED" as const };
    if (claim.status === "COMPLETED") return claim.result;
    if (claim.status === "IN_DOUBT") throw new Error("LIVE_EXECUTION_IN_DOUBT");
    if (claim.status === "CONFLICT") throw new Error("LIVE_EXECUTION_CONFLICT");

    const preparations = await Promise.allSettled(input.ticket.legs.map(async (leg) => {
      const adapter = this.#adapters.get(leg.provider);
      if (adapter === undefined) throw new Error("LIVE_ADAPTER_UNAVAILABLE");
      const prepared = await adapter.prepare(leg);
      if (prepared.provider !== leg.provider || prepared.providerSelectionId !== leg.providerSelectionId) {
        await prepared.cancel().catch(() => undefined);
        throw new Error("LIVE_PREPARE_IDENTITY_MISMATCH");
      }
      return prepared;
    }));
    if (preparations.some((item) => item.status === "rejected")) {
      await Promise.allSettled(preparations.flatMap((item) => item.status === "fulfilled" ? [item.value.cancel()] : []));
      const result = { ticketId: input.ticket.ticketId, status: "NOT_SUBMITTED" as const, legs: [] as const };
      await this.#journal?.complete(input.ticket, result);
      return result;
    }
    const prepared = preparations.map((item) => (item as PromiseFulfilledResult<PreparedLiveLeg>).value) as
      [PreparedLiveLeg, PreparedLiveLeg];
    await this.#journal?.markCommitting(input.ticket);
    const settled = await Promise.all(prepared.map(async (item, index): Promise<LiveLegResult> => {
      const leg = input.ticket.legs[index]!;
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<LiveLegResult>((resolve) => {
          timer = setTimeout(() => resolve({ provider: leg.provider, providerSelectionId: leg.providerSelectionId,
            status: "UNKNOWN", receiptId: null, reason: "TIMEOUT" }), this.#timeoutMs);
          timer.unref?.();
        });
        const result = await Promise.race([item.commit(), timeout]);
        if (timer !== undefined) clearTimeout(timer);
        return result.provider === leg.provider && result.providerSelectionId === leg.providerSelectionId
          ? result : { provider: leg.provider, providerSelectionId: leg.providerSelectionId,
            status: "UNKNOWN", receiptId: null, reason: "IDENTITY_MISMATCH" };
      } catch {
        return { provider: leg.provider, providerSelectionId: leg.providerSelectionId,
          status: "UNKNOWN", receiptId: null, reason: "ADAPTER_ERROR" };
      }
    })) as [LiveLegResult, LiveLegResult];
    const accepted = settled.filter((leg) => leg.status === "ACCEPTED").length;
    const status = accepted === 2 ? "BOTH_ACCEPTED" as const
      : accepted === 0 && settled.every((leg) => leg.status === "REJECTED") ? "NONE_ACCEPTED" as const
        : "PARTIAL_FAILURE" as const;
    const result: LiveTwoLegResult = { ticketId: input.ticket.ticketId, status, legs: settled };
    try {
      await this.#journal?.complete(input.ticket, result);
    } catch {
      this.#tripKillSwitch(result);
      throw new Error("LIVE_RECEIPT_PERSISTENCE_FAILED");
    }
    if (status === "PARTIAL_FAILURE") this.#tripKillSwitch(result);
    return result;
  }
}
