import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileKillSwitch } from "./file-kill-switch.js";

const paths: string[] = [];
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("FileKillSwitch", () => {
  it("stays tripped after restart and preserves only bounded non-secret evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tool-chenh-kill-")); paths.push(directory);
    const first = new FileKillSwitch(directory, { nowMs: () => 1234 });
    await first.trip({ reason: "PARTIAL_FAILURE", ticketId: "ticket-1", providers: ["SABA", "SBOBET"] });
    await expect(new FileKillSwitch(directory).status()).resolves.toEqual({ tripped: true,
      reason: "PARTIAL_FAILURE", ticketId: "ticket-1", providers: ["SABA", "SBOBET"], trippedAtMs: 1234 });
  });

  it("is latched first-write-wins and cannot be reset through this API", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tool-chenh-kill-")); paths.push(directory);
    const gate = new FileKillSwitch(directory, { nowMs: () => 1000 });
    await gate.trip({ reason: "TIMEOUT", ticketId: "ticket-a", providers: ["SABA", "SBOBET"] });
    await gate.trip({ reason: "OTHER", ticketId: "ticket-b", providers: ["APSPORT", "BTI"] });
    await expect(gate.status()).resolves.toMatchObject({ reason: "TIMEOUT", ticketId: "ticket-a" });
  });

  it("fails closed for a malformed latch file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tool-chenh-kill-")); paths.push(directory);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, "kill-switch.json"), "{}", "utf8");
    await expect(new FileKillSwitch(directory).status()).rejects.toThrow("KILL_SWITCH_STORE_INVALID");
  });
});
