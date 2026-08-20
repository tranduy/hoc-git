import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { TicketRealtimeAuditJournal, TicketRealtimeAuditJournalEntry } from "./provider-preflight.js";

export class FileTicketRealtimeAuditJournal implements TicketRealtimeAuditJournal {
  readonly #path: string;
  readonly #maxBytes: number;
  readonly #maxArchives: number;
  #pending: Promise<void> = Promise.resolve();

  constructor(path: string, options: { readonly maxBytes?: number; readonly maxArchives?: number } = {}) {
    if (!isAbsolute(path) || !path.toLocaleLowerCase("en").endsWith(".jsonl")) {
      throw new Error("TICKET_AUDIT_PATH_INVALID");
    }
    const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    const maxArchives = options.maxArchives ?? 2;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(maxArchives) || maxArchives < 0) {
      throw new Error("TICKET_AUDIT_RETENTION_INVALID");
    }
    this.#path = path;
    this.#maxBytes = maxBytes;
    this.#maxArchives = maxArchives;
  }

  async append(entry: TicketRealtimeAuditJournalEntry): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`;
    const incomingBytes = Buffer.byteLength(line, "utf8");
    if (incomingBytes > this.#maxBytes) throw new Error("TICKET_AUDIT_ENTRY_TOO_LARGE");
    const operation = this.#pending.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      await this.#rotateWhenNeeded(incomingBytes);
      await appendFile(this.#path, line, { encoding: "utf8", flag: "a" });
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
    if (this.#maxArchives === 0) {
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
