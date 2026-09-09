import { describe, expect, it, vi } from "vitest";
import { PendingSourceWork, retainedPayloadBytes } from "./pending-source-work.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("PendingSourceWork", () => {
  it("bounds active and queued bytes independently for each source", async () => {
    const queue = new PendingSourceWork({ maxBytes: 100, maxEntries: 4 });
    const held = deferred();
    const first = queue.enqueue("A", 60, () => held.promise);
    const queued = vi.fn(async () => undefined);
    const second = queue.enqueue("A", 40, queued);
    expect(queue.enqueue("A", 1, queued)).toBeNull();
    expect(queue.enqueue("B", 101, queued)).toBeNull();
    await queue.enqueue("B", 100, queued);
    expect(queued).toHaveBeenCalledTimes(1);
    expect(queue.usage("A")).toEqual({ bytes: 100, entries: 2 });
    held.resolve();
    await Promise.all([first, second]);
    expect(queued).toHaveBeenCalledTimes(2);
    expect(queue.usage("A")).toEqual({ bytes: 0, entries: 0 });
  });

  it("settles cancelled pending work before a blocked head completes, without opening another physical lane", async () => {
    const queue = new PendingSourceWork({ maxBytes: 100, maxEntries: 4 });
    const held = deferred();
    const first = queue.enqueue("A", 50, () => held.promise);
    const discarded = vi.fn(async () => undefined);
    const pending = queue.enqueue("A", 40, discarded);
    await Promise.resolve();
    queue.clear("A");
    await pending;
    expect(discarded).not.toHaveBeenCalled();
    expect(queue.usage("A")).toEqual({ bytes: 50, entries: 1 });
    const next = vi.fn(async () => undefined);
    const replacement = queue.enqueue("A", 40, next);
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    held.resolve();
    await Promise.all([first, replacement]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("bounds tiny jobs by count and continues after an individual rejection", async () => {
    const queue = new PendingSourceWork({ maxBytes: 100, maxEntries: 2 });
    const held = deferred();
    const first = queue.enqueue("A", 0, async () => { await held.promise; throw new Error("failed"); })!;
    const next = vi.fn(async () => undefined);
    const second = queue.enqueue("A", 0, next);
    expect(queue.enqueue("A", 0, next)).toBeNull();
    held.resolve();
    await expect(first).rejects.toThrow("failed");
    await second;
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("accounts for nested raw frame strings without serializing another payload copy", () => {
    expect(retainedPayloadBytes({ response: { payloadData: "x".repeat(2_000) } }, 10_000)).toBeGreaterThan(4_000);
    expect(retainedPayloadBytes({ response: { payloadData: "x".repeat(2_000) } }, 1_000)).toBeGreaterThan(1_000);
  });
});
