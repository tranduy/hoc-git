import type { ProviderProfileReader } from "../provider-capabilities.js";

export class ImProfileReader implements ProviderProfileReader {
  readonly provider = "IM";
  readonly capabilities = ["CATALOG"] as const;
  async readProfile(): Promise<never> { throw new Error("IM_PROFILE_UNAVAILABLE"); }
}
