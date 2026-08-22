import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileTicketReportJournal } from "./ticket-report-journal.js";

describe("FileTicketReportJournal", () => {
  it("persists reports as JSONL and returns only the requested event newest first", async () => {
    const root = await mkdtemp(join(tmpdir(), "ticket-reports-"));
    const path = join(root, "reports", "ticket-reports.jsonl");
    const journal = new FileTicketReportJournal(path);
    const makeEntry = (reportId: string, eventKey: string, createdAtMs: number) => ({ reportId, createdAtMs,
      request: { eventKey, ticketKey: "ticket-1", reason: "wrong price", reportedAtMs: createdAtMs,
        competition: "Test", startAtUtcMs: 10_000, display: {}, estimate: {}, realtimeCheck: null } }) as never;

    await journal.append(makeEntry("report-1", "event-a", 1));
    await journal.append(makeEntry("report-2", "event-b", 2));
    await journal.append(makeEntry("report-3", "event-a", 3));

    expect((await journal.list("event-a")).map((entry) => entry.reportId)).toEqual(["report-3", "report-1"]);
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(3);
  });

  it("returns an empty history when the report file does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "ticket-reports-empty-"));
    const journal = new FileTicketReportJournal(join(root, "reports", "ticket-reports.jsonl"));
    expect(await journal.list("missing-event")).toEqual([]);
  });
});
