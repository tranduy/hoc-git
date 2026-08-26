import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ReplayProvider } from "./replay-harness.js";
import { replayCaptureWithProductionAdapters } from "./replay-harness.js";

const providers: readonly ReplayProvider[] = ["CMD", "SABA", "SBOBET", "APSPORT", "IM", "BTI"];
const lobbyProvider: Readonly<Record<string, ReplayProvider>> = {
  CMD: "CMD", SABA: "SABA", KSPORT: "SBOBET", SBO: "SBOBET", TSPORT: "APSPORT", IM: "IM", BTI: "BTI"
};
const captureByProvider = new Map<ReplayProvider, string>();

beforeAll(async () => {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData === undefined) throw new Error("LOCALAPPDATA_REQUIRED_FOR_REAL_CAPTURE_TESTS");
  const directory = join(localAppData, "tool-chenh", "chrome-bridge-captures");
  for (const name of (await readdir(directory)).filter((entry) => entry.endsWith(".jsonl")).sort()) {
    const path = join(directory, name);
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/u)) {
      if (line.trim().length === 0) continue;
      const lobby = (JSON.parse(line) as { lobby?: unknown }).lobby;
      const provider = typeof lobby === "string" ? lobbyProvider[lobby] : undefined;
      if (provider !== undefined && !captureByProvider.has(provider)) captureByProvider.set(provider, path);
    }
  }
});

describe("real production-adapter capture replay", () => {
  for (const provider of providers) {
    it(`replays a real ${provider} capture through the production data plane`, async () => {
      const capturePath = captureByProvider.get(provider);
      expect(capturePath, `missing real capture for ${provider}`).toBeDefined();

      const result = await replayCaptureWithProductionAdapters({ capturePath: capturePath!, provider });

      expect(result.provider).toBe(provider);
      expect(result.envelopes).toBeGreaterThan(0);
      expect(result.rejected.total).toBeGreaterThanOrEqual(0);
      expect(result.rejected.reasons).not.toHaveProperty("NOT_APPLIED");
      expect(result.rejected.reasons).not.toHaveProperty("INGEST_REJECTION_REASON_MISSING");
      expect(result.semanticChanges).toBeGreaterThanOrEqual(0);
    });
  }
});
