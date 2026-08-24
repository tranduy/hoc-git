import { runProviderRuntimeVerification } from "./provider-runtime-sampler.mjs";

await runProviderRuntimeVerification({ provider: "IM", lobby: "IM",
  accountId: "catalog-source:IM:FOOTBALL" }, {
  durationMs: process.argv[2], outputPath: process.argv[3] ?? "im-runtime-evidence.json"
});
