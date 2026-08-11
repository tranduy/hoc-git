import type { ProviderSecret, SessionValidationResult, SessionValidator } from "../../sessions/types.js";

export class ImSessionValidator implements SessionValidator {
  readonly provider = "IM";
  readonly #probe: { verifyLaunch(launchUrl: string): Promise<boolean> };
  constructor(probe: { verifyLaunch(launchUrl: string): Promise<boolean> }) { this.#probe = probe; }
  async validate(secret: ProviderSecret): Promise<SessionValidationResult> {
    if (secret.kind !== "LAUNCH_URL") return { ok: false, reason: "SCHEMA_CHANGED" };
    try { return await this.#probe.verifyLaunch(secret.value) ? { ok: true } : { ok: false, reason: "SCHEMA_CHANGED" }; }
    catch { return { ok: false, reason: "UNREACHABLE" }; }
  }
}
