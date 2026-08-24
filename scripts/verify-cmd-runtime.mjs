import { runProviderRuntimeVerification } from "./provider-runtime-sampler.mjs";

await runProviderRuntimeVerification({ provider: "CMD", lobby: "CMD",
  accountId: "catalog-source:CMD:FOOTBALL" }, {
  durationMs: process.argv[2], outputPath: process.argv[3] ?? "cmd-runtime-evidence.json"
});
