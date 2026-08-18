import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CatalogJournalEntry } from "./catalog-telemetry.js";
import { JsonlCatalogJournal } from "./catalog-jsonl-journal.js";

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map(async (path) => rm(path, { recursive: true, force: true }))));

function entry(type: CatalogJournalEntry["type"], odds: string | null): CatalogJournalEntry {
  return {
    type, atMs: 1_000, provider: "SABA", category: "FOOTBALL", providerEventId: "event-1",
    providerMarketId: "market-1", providerSelectionId: "selection-home", marketType: "FT_AH",
    scope: "FULL_TIME", selection: "HOME", line: "0.5", previousOdds: "0.80", currentOdds: odds,
    previousStatus: "OPEN", currentStatus: "OPEN", previousSequence: 1, sequence: 2,
    sourceTimestampMs: 990, observedAtMs: 995
  };
}

describe("JsonlCatalogJournal", () => {
  it("appends one strict public JSON object per line and creates its private local directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "tool-chenh-journal-"));
    temporaryDirectories.push(root);
    const path = join(root, "logs", "catalog-changes.jsonl");
    const journal = new JsonlCatalogJournal(path);

    await journal.append([entry("SNAPSHOT_ACCEPTED", null), entry("ODDS_CHANGED", "0.81")]);

    const text = await readFile(path, "utf8");
    expect(text.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      entry("SNAPSHOT_ACCEPTED", null), entry("ODDS_CHANGED", "0.81")
    ]);
    expect(text).not.toMatch(/token|cookie|password|accountId/iu);
  });

  it("rejects relative or non-jsonl destinations", () => {
    expect(() => new JsonlCatalogJournal("relative.jsonl")).toThrow("CATALOG_JOURNAL_PATH_INVALID");
    expect(() => new JsonlCatalogJournal(join(tmpdir(), "catalog.log"))).toThrow("CATALOG_JOURNAL_PATH_INVALID");
  });

  it("rotates at a hard size bound instead of growing forever", async () => {
    const root = await mkdtemp(join(tmpdir(), "tool-chenh-journal-"));
    temporaryDirectories.push(root);
    const path = join(root, "logs", "catalog-changes.jsonl");
    const journal = new JsonlCatalogJournal(path, { maxBytes: 900, maxArchives: 2 });

    for (let index = 0; index < 8; index++) await journal.append([entry("ODDS_CHANGED", `0.${index}`)]);

    expect((await stat(path)).size).toBeLessThanOrEqual(900);
    expect((await stat(`${path}.1`)).size).toBeLessThanOrEqual(900);
    expect((await stat(`${path}.2`)).size).toBeLessThanOrEqual(900);
  });

  it("deletes a legacy oversized journal instead of preserving it as a huge archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "tool-chenh-journal-"));
    temporaryDirectories.push(root);
    const path = join(root, "catalog-changes.jsonl");
    await writeFile(path, "x".repeat(4_096));
    const journal = new JsonlCatalogJournal(path, { maxBytes: 900, maxArchives: 2 });

    await journal.append([entry("SNAPSHOT_ACCEPTED", null)]);

    expect((await stat(path)).size).toBeLessThanOrEqual(900);
    await expect(stat(`${path}.1`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
