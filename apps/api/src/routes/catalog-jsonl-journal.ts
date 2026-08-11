import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { CatalogJournal, CatalogJournalEntry } from "./catalog-telemetry.js";

export class JsonlCatalogJournal implements CatalogJournal {
  readonly #path: string;
  #pending: Promise<void> = Promise.resolve();

  constructor(path: string) {
    if (!isAbsolute(path) || !path.toLocaleLowerCase("en").endsWith(".jsonl")) {
      throw new Error("CATALOG_JOURNAL_PATH_INVALID");
    }
    this.#path = path;
  }

  async append(entries: readonly CatalogJournalEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const lines = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    const operation = this.#pending.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      await appendFile(this.#path, lines, { encoding: "utf8", flag: "a" });
    });
    this.#pending = operation.catch(() => undefined);
    return operation;
  }
}
