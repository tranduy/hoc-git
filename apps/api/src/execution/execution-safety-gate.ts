import { randomBytes } from "node:crypto";

interface Arm { readonly ticketId: string; readonly expiresAtMs: number }

export class ExecutionSafetyGate {
  readonly #enabled: boolean;
  readonly #clock: { nowMs(): number };
  readonly #ttlMs: number;
  readonly #tokenFactory: () => string;
  readonly #arms = new Map<string, Arm>();
  #killSwitchReason: string | null = null;

  constructor(options: { readonly enabled?: boolean; readonly clock?: { nowMs(): number };
    readonly ttlMs?: number; readonly tokenFactory?: () => string } = {}) {
    this.#enabled = options.enabled ?? false;
    this.#clock = options.clock ?? { nowMs: Date.now };
    this.#ttlMs = options.ttlMs ?? 10_000;
    this.#tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("hex"));
    if (!Number.isFinite(this.#ttlMs) || this.#ttlMs <= 0 || this.#ttlMs > 30_000) {
      throw new Error("LIVE_ARM_TTL_INVALID");
    }
  }

  arm(ticketId: string, confirmation: string): string {
    if (!this.#enabled) throw new Error("LIVE_EXECUTION_DISABLED");
    if (this.#killSwitchReason !== null) throw new Error("LIVE_KILL_SWITCH_TRIPPED");
    if (ticketId.trim().length === 0 || confirmation !== `ARM ${ticketId}`) {
      throw new Error("LIVE_CONFIRMATION_INVALID");
    }
    const token = this.#tokenFactory();
    if (token.length < 16 || token.length > 256 || this.#arms.has(token)) throw new Error("LIVE_ARM_TOKEN_INVALID");
    this.#arms.set(token, { ticketId, expiresAtMs: this.#clock.nowMs() + this.#ttlMs });
    return token;
  }

  consume(ticketId: string, token: string): boolean {
    if (!this.#enabled || this.#killSwitchReason !== null) return false;
    const arm = this.#arms.get(token);
    if (arm === undefined || arm.ticketId !== ticketId || arm.expiresAtMs <= this.#clock.nowMs()) {
      return false;
    }
    this.#arms.delete(token);
    return true;
  }

  trip(reason: string): void {
    if (this.#killSwitchReason !== null) return;
    this.#killSwitchReason = reason.trim().slice(0, 128) || "UNKNOWN";
    this.#arms.clear();
  }

  status(): { readonly enabled: boolean; readonly killSwitchTripped: boolean; readonly reason: string | null } {
    return { enabled: this.#enabled, killSwitchTripped: this.#killSwitchReason !== null,
      reason: this.#killSwitchReason };
  }
}
