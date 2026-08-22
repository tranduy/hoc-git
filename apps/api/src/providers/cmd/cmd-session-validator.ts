import type { ProviderSecret, SessionValidationResult, SessionValidator } from "../../sessions/types.js";

export interface CmdIdentityProbe {
  verifyLaunch(launchUrl: string): Promise<boolean>;
}

export class CmdSessionValidator implements SessionValidator {
  readonly provider = "CMD";
  readonly #probe: CmdIdentityProbe;

  constructor(probe: CmdIdentityProbe) {
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
