import type { ProviderSecret, SessionValidationResult, SessionValidator } from "../../sessions/types.js";

export interface SabaIdentityProbe {
  verifyLaunch(launchUrl: string): Promise<boolean>;
}

export class SabaSessionValidator implements SessionValidator {
  readonly provider = "SABA";
  readonly #probe: SabaIdentityProbe;

  constructor(probe: SabaIdentityProbe) {
    this.#probe = probe;
  }

  async validate(secret: ProviderSecret): Promise<SessionValidationResult> {
    if (secret.kind !== "LAUNCH_URL") return { ok: false, reason: "SCHEMA_CHANGED" };
    try {
      return await this.#probe.verifyLaunch(secret.value)
        ? { ok: true }
        : { ok: false, reason: "SCHEMA_CHANGED" };
    } catch {
      return { ok: false, reason: "UNREACHABLE" };
    }
  }
}
