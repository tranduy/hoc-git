import { normalizeCmdAccountStore } from "@tool-chenh/adapters";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ProviderProfile, ProviderProfileReader } from "../provider-capabilities.js";
import type { CmdAccountStoreSource } from "../cmd/cmd-profile-reader.js";

export class SabaProfileReader implements ProviderProfileReader {
  readonly provider = "SABA" as const;
  readonly capabilities = ["PROFILE", "CATALOG"] as const;
  readonly #source: CmdAccountStoreSource;
  readonly #clock: { nowMs(): number };

  constructor(options: { source: CmdAccountStoreSource; clock: { nowMs(): number } }) {
    this.#source = options.source;
    this.#clock = options.clock;
  }

  async readProfile(handle: ActiveSecretHandle): Promise<ProviderProfile> {
    if (handle.provider !== "SABA") throw new Error("SABA_PROFILE_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("SABA_PROFILE_UNAVAILABLE");
      const raw = await this.#source.readAccountStore({ sessionId: handle.sessionId, launchUrl: secret.value });
      const normalized = normalizeCmdAccountStore(raw, this.#clock.nowMs());
      if (normalized === null) throw new Error("SABA_PROFILE_UNAVAILABLE");
      return {
        redactedLabel: normalized.redactedLabel,
        currency: normalized.currency,
        balance: normalized.balance,
        asOfMs: normalized.asOfMs
      };
    });
  }
}
