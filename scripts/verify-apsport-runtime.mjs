import { runProviderRuntimeVerification } from "./provider-runtime-sampler.mjs";

await runProviderRuntimeVerification({ provider: "APSPORT", lobby: "TSPORT",
  accountId: "catalog-source:APSPORT:FOOTBALL" }, {
  durationMs: process.argv[2], outputPath: process.argv[3] ?? "apsport-runtime-evidence.json"
});
