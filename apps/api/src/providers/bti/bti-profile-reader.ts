import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ProviderProfile, ProviderProfileReader } from "../provider-capabilities.js";
import type { BtiProfileSnapshot } from "./bti-browser-manager.js";

export interface BtiProfileSource {
  readProfile(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<BtiProfileSnapshot>;
}

export function normalizeBtiKBalance(value: string): string | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,3}))?\s*K$/iu.exec(value.trim());
  if (match === null) return null;
  return `${match[1]}${(match[2] ?? "").padEnd(3, "0")}`.replace(/^0+(?=\d)/u, "");
}

function redactedLabel(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length < 4 || normalized.length > 128 || /[\r\n\u0000-\u001f]/u.test(normalized)) return null;
  return `••••${normalized.slice(-4)}`;
}

export class BtiProfileReader implements ProviderProfileReader {
  readonly provider = "BTI" as const;
  readonly capabilities = ["PROFILE", "CATALOG"] as const;
  readonly #source: BtiProfileSource;
  readonly #clock: { nowMs(): number };
  constructor(options: { source: BtiProfileSource; clock: { nowMs(): number } }) { this.#source = options.source; this.#clock = options.clock; }
  async readProfile(handle: ActiveSecretHandle): Promise<ProviderProfile> {
    if (handle.provider !== "BTI") throw new Error("BTI_PROFILE_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("BTI_PROFILE_UNAVAILABLE");
      const raw = await this.#source.readProfile({ sessionId: handle.sessionId, launchUrl: secret.value });
      const redacted = redactedLabel(raw.displayName);
      const balance = normalizeBtiKBalance(raw.balanceText);
      if (redacted === null || balance === null || raw.currencyCode !== "VND" || !Number.isFinite(raw.observedAtMs) || raw.observedAtMs < 0) {
        throw new Error("BTI_PROFILE_UNAVAILABLE");
      }
      return { redactedLabel: redacted, currency: "VND", balance, asOfMs: Math.min(raw.observedAtMs, this.#clock.nowMs()) };
    });
  }
}
