import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CaptureStore } from "./capture-store.js";
import { replayCapture } from "./replay.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function envelope(sequence: number, body: string): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7, sequence,
    observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence, transport: "WS_FRAME",
    request: { hostname: "sports.example", pathnameClass: "/feed", resourceType: "WebSocket" },
    payload: { encoding: "UTF8", body }
  };
}

describe("CaptureStore", () => {
  it("writes sanitized JSONL with neutral filenames and replays ordering", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-capture-"));
    roots.push(root);
    const store = new CaptureStore({ enabled: true, directory: root, maxEntries: 10 });
    await store.record(envelope(1, JSON.stringify({ odds: 2.1, token: "super-secret" })));
    await store.record(envelope(0, JSON.stringify({ odds: 1.9, cookie: "super-secret" })));
    const files = await store.files();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^capture-\d+\.jsonl$/u);
    const text = await readFile(join(root, files[0]!), "utf8");
    expect(text).not.toContain("super-secret");
    expect((await replayCapture(join(root, files[0]!))).map((value) => value.sequence)).toEqual([0, 1]);
  });

  it("isolates write errors and keeps a bounded in-memory ring", async () => {
    const writeLine = vi.fn(async () => { throw new Error("disk full"); });
    const store = new CaptureStore({ enabled: true, directory: "ignored", maxEntries: 2, writeLine });
    await expect(store.record(envelope(0, "{}"))).resolves.toBeUndefined();
    await store.record(envelope(1, "{}"));
    await store.record(envelope(2, "{}"));
    expect(store.recent().map((value) => value.sequence)).toEqual([1, 2]);
    expect(writeLine).toHaveBeenCalledTimes(3);
  });

  it("rotates capture files and retains only the configured file count", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-capture-"));
    roots.push(root);
    const store = new CaptureStore({
      enabled: true, directory: root, maxEntries: 10, maxFileBytes: 420, maxFiles: 2, now: () => 10_000
    });
    for (let sequence = 0; sequence < 5; sequence++) {
      await store.record(envelope(sequence, JSON.stringify({ odds: 1.9, value: "x".repeat(100) })));
    }
    expect(await store.files()).toHaveLength(2);
  });
});
