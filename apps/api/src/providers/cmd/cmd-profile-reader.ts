import { normalizeCmdAccountStore } from "@tool-chenh/adapters";
import type { ProviderProfile, ProviderProfileReader } from "../provider-capabilities.js";
import type { ActiveSecretHandle } from "../../sessions/types.js";

export interface CmdAccountStoreSource {
  readAccountStore(input: {
    readonly sessionId: string;
    readonly launchUrl: string;
  }): Promise<unknown>;
}

export interface CmdProfileReaderOptions {
  readonly source: CmdAccountStoreSource;
  readonly clock: { nowMs(): number };
}

export class CmdProfileReader implements ProviderProfileReader {
  readonly provider = "CMD" as const;
  readonly capabilities = ["PROFILE", "CATALOG"] as const;
  readonly #source: CmdAccountStoreSource;
  readonly #clock: { nowMs(): number };

  constructor(options: CmdProfileReaderOptions) {
    this.#source = options.source;
    this.#clock = options.clock;
  }

  async readProfile(handle: ActiveSecretHandle): Promise<ProviderProfile> {
    if (handle.provider !== this.provider) throw new Error("CMD_PROFILE_UNAVAILABLE");
    try {
      return await handle.withSecret(async (secret) => {
        if (secret.kind !== "LAUNCH_URL") throw new Error("CMD_PROFILE_UNAVAILABLE");
        const raw = await this.#source.readAccountStore({
          sessionId: handle.sessionId,
          launchUrl: secret.value
        });
        const normalized = normalizeCmdAccountStore(raw, this.#clock.nowMs());
        if (normalized === null) throw new Error("CMD_PROFILE_UNAVAILABLE");
        return {
          redactedLabel: normalized.redactedLabel,
          currency: normalized.currency,
          balance: normalized.balance,
          asOfMs: normalized.asOfMs
        };
      });
    } catch {
      throw new Error("CMD_PROFILE_UNAVAILABLE");
    }
  }
}
