import { runProviderRuntimeVerification } from "./provider-runtime-sampler.mjs";

await runProviderRuntimeVerification({ provider: "SABA", lobby: "SABA",
  accountId: "catalog-source:SABA:FOOTBALL" }, {
  durationMs: process.argv[2], outputPath: process.argv[3] ?? "saba-runtime-evidence.json"
});
