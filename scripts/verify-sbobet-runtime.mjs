import { runProviderRuntimeVerification } from "./provider-runtime-sampler.mjs";

await runProviderRuntimeVerification({ provider: "SBOBET", lobby: "KSPORT",
  accountId: "catalog-source:SBOBET:FOOTBALL" }, {
  durationMs: process.argv[2], outputPath: process.argv[3] ?? "sbobet-runtime-evidence.json"
});
