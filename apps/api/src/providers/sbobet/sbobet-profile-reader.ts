import type { ProviderProfileReader } from "../provider-capabilities.js";

export class SbobetProfileReader implements ProviderProfileReader {
  readonly provider = "SBOBET";
  readonly capabilities = ["CATALOG"] as const;
  async readProfile(): Promise<never> { throw new Error("SBOBET_PROFILE_UNAVAILABLE"); }
}
