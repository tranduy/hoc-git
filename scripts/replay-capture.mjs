import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const providers = Object.freeze({
  CMD: { accountId: "catalog-source:CMD:FOOTBALL", lobbies: new Set(["CMD"]) },
  IM: { accountId: "catalog-source:IM:FOOTBALL", lobbies: new Set(["IM"]) },
  SABA: { accountId: "catalog-source:SABA:FOOTBALL", lobbies: new Set(["SABA"]) },
  SBOBET: { accountId: "catalog-source:SBOBET:FOOTBALL", lobbies: new Set(["KSPORT", "SBO"]) },
  APSPORT: { accountId: "catalog-source:APSPORT:FOOTBALL", lobbies: new Set(["TSPORT"]) },
  BTI: { accountId: "catalog-source:BTI:FOOTBALL", lobbies: new Set(["BTI"]) }
});

export function parseReplayArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  const capturePath = values.get("--capture");
  const provider = values.get("--provider")?.toUpperCase();
  const assertSemanticChanges = values.has("--assert-semantic-changes")
    ? Number(values.get("--assert-semantic-changes")) : null;
  if (typeof capturePath !== "string" || providers[provider] === undefined ||
    (assertSemanticChanges !== null && (!Number.isSafeInteger(assertSemanticChanges) || assertSemanticChanges < 0))) {
    throw new Error("USAGE: --capture <file.jsonl> --provider <CMD|IM|SABA|SBOBET|APSPORT|BTI> " +
      "[--assert-semantic-changes <count>]");
  }
  return { capturePath, provider, assertSemanticChanges };
}

async function sourceHarness() {
  if (process.env.TOOL_CHENH_REPLAY_SOURCE !== "1") throw new Error("SOURCE_HARNESS_REQUIRED");
  const module = await import("../apps/api/src/chrome-bridge/replay-harness.ts");
  return module.replayCaptureWithProductionAdapters;
}

export async function runReplay(options) {
  const replay = await sourceHarness();
  const result = await replay({ capturePath: options.capturePath, provider: options.provider });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (options.assertSemanticChanges !== null && result.semanticChanges < options.assertSemanticChanges) {
    process.exitCode = 1;
  }
  return result;
}

const isMain = process.env.TOOL_CHENH_REPLAY_SOURCE === "1" ||
  (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href);

if (isMain && process.env.TOOL_CHENH_REPLAY_SOURCE !== "1") {
  const runner = resolve("node_modules", "vite-node", "vite-node.mjs");
  const child = spawnSync(process.execPath, [runner, process.argv[1], ...process.argv.slice(2)], {
    cwd: process.cwd(), env: { ...process.env, TOOL_CHENH_REPLAY_SOURCE: "1" }, stdio: "inherit"
  });
  process.exitCode = child.status ?? 1;
} else if (isMain) {
  try { await runReplay(parseReplayArguments(process.argv.slice(2))); }
  catch (error) {
    process.stderr.write(`replay-capture failed: ${error instanceof Error ? error.message : "REPLAY_FAILED"}\n`);
    process.exitCode = 1;
  }
}
