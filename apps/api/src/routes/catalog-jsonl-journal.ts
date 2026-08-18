import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { CatalogJournal, CatalogJournalEntry } from "./catalog-telemetry.js";

export class JsonlCatalogJournal implements CatalogJournal {
  readonly #path: string;
  readonly #maxBytes: number;
  readonly #maxArchives: number;
  #pending: Promise<void> = Promise.resolve();

  constructor(path: string, options: { readonly maxBytes?: number; readonly maxArchives?: number } = {}) {
    if (!isAbsolute(path) || !path.toLocaleLowerCase("en").endsWith(".jsonl")) {
      throw new Error("CATALOG_JOURNAL_PATH_INVALID");
    }
    const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
    const maxArchives = options.maxArchives ?? 2;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(maxArchives) || maxArchives < 0) {
      throw new Error("CATALOG_JOURNAL_RETENTION_INVALID");
    }
    this.#path = path;
    this.#maxBytes = maxBytes;
    this.#maxArchives = maxArchives;
  }

  async append(entries: readonly CatalogJournalEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const serialized = entries.map((entry) => `${JSON.stringify(entry)}\n`);
    const retained: string[] = [];
    let bytes = 0;
    for (const line of serialized.reverse()) {
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (lineBytes > this.#maxBytes || bytes + lineBytes > this.#maxBytes) continue;
      retained.unshift(line);
      bytes += lineBytes;
    }
    if (retained.length === 0) return;
    const lines = retained.join("");
    const operation = this.#pending.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      await this.#rotateWhenNeeded(bytes);
      await appendFile(this.#path, lines, { encoding: "utf8", flag: "a" });
    });
    this.#pending = operation.catch(() => undefined);
    return operation;
  }

  async #rotateWhenNeeded(incomingBytes: number): Promise<void> {
    let currentBytes = 0;
    try { currentBytes = (await stat(this.#path)).size; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return;
    }
    if (currentBytes + incomingBytes <= this.#maxBytes) return;
    if (currentBytes > this.#maxBytes || this.#maxArchives === 0) {
      await rm(this.#path, { force: true });
      return;
    }
    await rm(`${this.#path}.${this.#maxArchives}`, { force: true });
    for (let index = this.#maxArchives - 1; index >= 1; index--) {
      try { await rename(`${this.#path}.${index}`, `${this.#path}.${index + 1}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    await rename(this.#path, `${this.#path}.1`);
  }
}
