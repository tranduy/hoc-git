import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileTicketRealtimeAuditJournal } from "./ticket-realtime-audit-journal.js";

describe("FileTicketRealtimeAuditJournal", () => {
  it("persists ordered JSONL entries and rotates within the configured bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "ticket-realtime-audit-"));
    const path = join(root, "logs", "realtime-ticket-checks.jsonl");
    const journal = new FileTicketRealtimeAuditJournal(path, { maxBytes: 500, maxArchives: 1 });
    const request = { eventLabel: "Alpha vs Beta", marketType: "FT_TOTAL", scope: "FULL_TIME",
      capturedAtMs: 1, legs: [] } as never;

    await Promise.all([
      journal.append({ type: "DISPLAY_CAPTURED", checkId: "check-1", atMs: 2, request }),
      journal.append({ type: "DISPLAY_CAPTURED", checkId: "check-2", atMs: 3, request })
    ]);
    await journal.append({ type: "DISPLAY_CAPTURED", checkId: "check-3", atMs: 4, request });

    const files = (await readdir(join(root, "logs"))).sort();
    expect(files).toEqual(["realtime-ticket-checks.jsonl", "realtime-ticket-checks.jsonl.1"]);
    const archived = await readFile(`${path}.1`, "utf8");
    expect(archived.indexOf("check-1")).toBeLessThan(archived.indexOf("check-2"));
    expect(await readFile(path, "utf8")).toContain("check-3");
  });

  it("rejects unsafe destinations and retention", () => {
    expect(() => new FileTicketRealtimeAuditJournal("relative.jsonl")).toThrow("TICKET_AUDIT_PATH_INVALID");
    expect(() => new FileTicketRealtimeAuditJournal(join(tmpdir(), "audit.log"))).toThrow("TICKET_AUDIT_PATH_INVALID");
    expect(() => new FileTicketRealtimeAuditJournal(join(tmpdir(), "audit.jsonl"), { maxBytes: 0 }))
      .toThrow("TICKET_AUDIT_RETENTION_INVALID");
  });
});
