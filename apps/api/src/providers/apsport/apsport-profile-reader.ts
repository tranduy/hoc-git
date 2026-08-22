import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ProviderProfile, ProviderProfileReader } from "../provider-capabilities.js";
import type { ApsportProfileSnapshot } from "./apsport-browser-manager.js";

export interface ApsportProfileSource {
  readProfile(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<ApsportProfileSnapshot>;
}

export function normalizeApsportKBalance(value: string): string | null {
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

export class ApsportProfileReader implements ProviderProfileReader {
  readonly provider = "APSPORT" as const;
  readonly capabilities = ["PROFILE", "CATALOG"] as const;
  readonly #source: ApsportProfileSource;
  readonly #clock: { nowMs(): number };

  constructor(options: { source: ApsportProfileSource; clock: { nowMs(): number } }) {
    this.#source = options.source;
    this.#clock = options.clock;
  }

  async readProfile(handle: ActiveSecretHandle): Promise<ProviderProfile> {
    if (handle.provider !== "APSPORT") throw new Error("APSPORT_PROFILE_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("APSPORT_PROFILE_UNAVAILABLE");
      const raw = await this.#source.readProfile({ sessionId: handle.sessionId, launchUrl: secret.value });
      const label = redactedLabel(raw.displayName);
      const balance = normalizeApsportKBalance(raw.balanceText);
      if (label === null || balance === null || !Number.isFinite(raw.observedAtMs) || raw.observedAtMs < 0) {
        throw new Error("APSPORT_PROFILE_UNAVAILABLE");
      }
      return { redactedLabel: label, currency: "VND", balance, asOfMs: Math.min(raw.observedAtMs, this.#clock.nowMs()) };
    });
  }
}
