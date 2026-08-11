import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ProviderProfile, ProviderProfileReader } from "../provider-capabilities.js";
import type { SbobetProfileSnapshot } from "./sbobet-browser-manager.js";

export interface SbobetProfileSource {
  readProfile(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<SbobetProfileSnapshot>;
}

export function normalizeSbobetKBalance(value: string): string | null {
  const match = /^(0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)(?:\.(\d{1,3}))?\s*K$/iu.exec(value.trim());
  if (match === null) return null;
  const whole = match[1]!.replace(/,/gu, "");
  const fraction = (match[2] ?? "").padEnd(3, "0");
  return `${whole}${fraction}`.replace(/^0+(?=\d)/u, "");
}

function redactedLabel(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length < 4 || normalized.length > 128 || /[\r\n\u0000-\u001f]/u.test(normalized)) return null;
  return `••••${normalized.slice(-4)}`;
}

export class SbobetProfileReader implements ProviderProfileReader {
  readonly provider = "SBOBET" as const;
  readonly capabilities = ["PROFILE", "CATALOG"] as const;
  readonly #source: SbobetProfileSource;
  readonly #clock: { nowMs(): number };

  constructor(options: { source: SbobetProfileSource; clock: { nowMs(): number } }) {
    this.#source = options.source;
    this.#clock = options.clock;
  }

  async readProfile(handle: ActiveSecretHandle): Promise<ProviderProfile> {
    if (handle.provider !== "SBOBET") throw new Error("SBOBET_PROFILE_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("SBOBET_PROFILE_UNAVAILABLE");
      const raw = await this.#source.readProfile({ sessionId: handle.sessionId, launchUrl: secret.value });
      const label = redactedLabel(raw.displayName);
      const balance = normalizeSbobetKBalance(raw.balanceText);
      if (label === null || balance === null || !Number.isFinite(raw.observedAtMs) || raw.observedAtMs < 0) {
        throw new Error("SBOBET_PROFILE_UNAVAILABLE");
      }
      return { redactedLabel: label, currency: "VND", balance, asOfMs: Math.min(raw.observedAtMs, this.#clock.nowMs()) };
    });
  }
}
