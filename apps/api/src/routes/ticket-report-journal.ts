import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { TicketReportEntry, TicketReportJournal } from "./provider-preflight.js";

function isEntry(value: unknown): value is TicketReportEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<TicketReportEntry>;
  return typeof entry.reportId === "string" && typeof entry.createdAtMs === "number" &&
    typeof entry.request === "object" && entry.request !== null &&
    typeof (entry.request as { eventKey?: unknown }).eventKey === "string";
}

export class FileTicketReportJournal implements TicketReportJournal {
  readonly #path: string;
  #pending: Promise<void> = Promise.resolve();

  constructor(path: string) {
    if (!isAbsolute(path) || !path.toLocaleLowerCase("en").endsWith(".jsonl")) {
      throw new Error("TICKET_REPORT_PATH_INVALID");
    }
    this.#path = path;
  }

  async append(entry: TicketReportEntry): Promise<void> {
    const operation = this.#pending.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      await appendFile(this.#path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", flag: "a" });
    });
    this.#pending = operation.catch(() => undefined);
    return operation;
  }

  async list(eventKey: string): Promise<readonly TicketReportEntry[]> {
    await this.#pending;
    let content: string;
    try { content = await readFile(this.#path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return content.split(/\r?\n/u).flatMap((line) => {
      if (line.trim() === "") return [];
      try { const entry: unknown = JSON.parse(line); return isEntry(entry) ? [entry] : []; }
      catch { return []; }
    }).filter((entry) => entry.request.eventKey === eventKey)
      .sort((left, right) => right.createdAtMs - left.createdAtMs).slice(0, 100);
  }
}
