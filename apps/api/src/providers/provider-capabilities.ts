import type { ProviderCapability, ProviderId } from "@tool-chenh/contracts";
import type { ActiveSecretHandle } from "../sessions/types.js";

export interface ProviderProfile {
  readonly redactedLabel: string;
  readonly currency: string;
  readonly balance: string;
  readonly asOfMs: number;
}

export interface ProviderProfileReader {
  readonly provider: ProviderId;
  readonly capabilities: readonly ProviderCapability[];
  readProfile(handle: ActiveSecretHandle): Promise<ProviderProfile>;
}
