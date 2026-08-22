import { describe, expect, it } from "vitest";
import type { MatchWatchEntry } from "./match-watch.js";
import { clearWatchEntries, loadWatchEntries, saveWatchEntries, watchStorageKey } from "./watch-storage.js";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

class FailingStorage implements Storage {
  get length(): number { throw new DOMException("Storage unavailable", "SecurityError"); }
  clear(): void { throw new DOMException("Storage unavailable", "SecurityError"); }
  getItem(): string | null { throw new DOMException("Storage unavailable", "SecurityError"); }
  key(): string | null { throw new DOMException("Storage unavailable", "SecurityError"); }
  removeItem(): void { throw new DOMException("Storage unavailable", "SecurityError"); }
  setItem(): void { throw new DOMException("Quota exceeded", "QuotaExceededError"); }
}

function entry(index: number): MatchWatchEntry {
  return {
    id: `entry-${index}`, kind: "ODDS_CHANGED", provider: "CMD", providerEventId: "event-1",
    providerMarketId: "market-1", providerSelectionId: "selection-home", competition: "Premier Test",
    matchLabel: "Alpha vs Beta", marketType: "FT_1X2", scope: "FULL_TIME", line: null,
    selection: "HOME", previousValue: "2.1 DECIMAL", currentValue: "2.05 DECIMAL",
    detectedAtMs: index, providerObservedAtMs: index, sampleIntervalMs: 1_000
  };
}

describe("match watch storage", () => {
  it("round-trips only schema-checked event data and caps it at 200 newest rows", () => {
    const storage = new MemoryStorage();
    const values = Array.from({ length: 205 }, (_, index) => entry(index));
    saveWatchEntries(storage, "CMD", "event-1", values);

    const loaded = loadWatchEntries(storage, "CMD", "event-1");
    expect(loaded).toHaveLength(200);
    expect(loaded[0]?.id).toBe("entry-5");
    expect(loaded.at(-1)?.id).toBe("entry-204");
  });

  it("isolates events and clears only the selected event", () => {
    const storage = new MemoryStorage();
    saveWatchEntries(storage, "CMD", "event-1", [entry(1)]);
    saveWatchEntries(storage, "CMD", "event-2", [{ ...entry(2), providerEventId: "event-2" }]);

    clearWatchEntries(storage, "CMD", "event-1");
    expect(loadWatchEntries(storage, "CMD", "event-1")).toEqual([]);
    expect(loadWatchEntries(storage, "CMD", "event-2")).toHaveLength(1);
    expect(watchStorageKey("CMD", "event-2")).toBe("fieldline:match-watch:v1:CMD:event-2");
  });

  it("fails closed on malformed or extra secret-bearing fields", () => {
    const storage = new MemoryStorage();
    const key = watchStorageKey("CMD", "event-1");
    storage.setItem(key, JSON.stringify([{ ...entry(1), accountId: "private-account", token: "token-canary", cookie: "cookie-canary", launchUrl: "https://secret.invalid" }]));

    expect(loadWatchEntries(storage, "CMD", "event-1")).toEqual([]);
    saveWatchEntries(storage, "CMD", "event-1", [entry(2)]);
    const serialized = storage.getItem(key) ?? "";
    expect(serialized).not.toContain("private-account");
    expect(serialized).not.toContain("token-canary");
    expect(serialized).not.toContain("cookie-canary");
    expect(serialized).not.toContain("secret.invalid");
  });

  it("returns an empty log for invalid JSON or a mismatched provider event", () => {
    const storage = new MemoryStorage();
    storage.setItem(watchStorageKey("CMD", "event-1"), "{not-json");
    expect(loadWatchEntries(storage, "CMD", "event-1")).toEqual([]);
    storage.setItem(watchStorageKey("CMD", "event-1"), JSON.stringify([{ ...entry(1), providerEventId: "event-2" }]));
    expect(loadWatchEntries(storage, "CMD", "event-1")).toEqual([]);
  });

  it("never lets unavailable or full browser storage interrupt live monitoring", () => {
    const storage = new FailingStorage();

    expect(loadWatchEntries(storage, "CMD", "event-1")).toEqual([]);
    expect(() => saveWatchEntries(storage, "CMD", "event-1", [entry(1)])).not.toThrow();
    expect(() => clearWatchEntries(storage, "CMD", "event-1")).not.toThrow();
  });
});
