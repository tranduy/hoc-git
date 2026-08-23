import { describe, expect, it, vi } from "vitest";
import type { PersistedSabaWsSnapshots } from "./network-observer.js";
import { SabaSnapshotStorage } from "./saba-snapshot-storage.js";

const storageKey = "sabaWsSnapshotsV1";

function snapshot(sourceId: string): PersistedSabaWsSnapshots {
  return { version: 1, sourceId, documentMarker: "document", partitions: [] };
}

describe("SabaSnapshotStorage", () => {
  it("serializes shared-key saves and clears so a stale save cannot reintroduce a cleared provider", async () => {
    let releaseFirstRead!: () => void;
    let firstReadObserved!: () => void;
    const firstReadBlocked = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
    const sawFirstRead = new Promise<void>((resolve) => { firstReadObserved = resolve; });
    const values: Record<string, unknown> = {
      [storageKey]: { "chrome:SABA:1": snapshot("chrome:SABA:1") }
    };
    let blockRead = true;
    const area = {
      get: vi.fn(async (key: string) => {
        const read = { [key]: structuredClone(values[key]) };
        if (blockRead) {
          blockRead = false;
          firstReadObserved();
          await firstReadBlocked;
        }
        return read;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)); }),
      remove: vi.fn(async (key: string) => { delete values[key]; })
    };
    const storage = new SabaSnapshotStorage(area, storageKey);

    const saveB = storage.save(snapshot("chrome:SABA:2"));
    await sawFirstRead;
    const clearA = storage.clear("chrome:SABA:1");
    releaseFirstRead();
    await Promise.all([saveB, clearA]);

    expect(values[storageKey]).toEqual({ "chrome:SABA:2": snapshot("chrome:SABA:2") });
  });

  it("releases the global mutation lane after an error", async () => {
    const values: Record<string, unknown> = {};
    let failFirstSet = true;
    const area = {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(values[key]) })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        if (failFirstSet) {
          failFirstSet = false;
          throw new Error("storage unavailable");
        }
        Object.assign(values, structuredClone(items));
      }),
      remove: vi.fn(async (key: string) => { delete values[key]; })
    };
    const storage = new SabaSnapshotStorage(area, storageKey);

    await expect(storage.save(snapshot("chrome:SABA:1"))).rejects.toThrow("storage unavailable");
    await expect(storage.save(snapshot("chrome:SABA:2"))).resolves.toBeUndefined();

    expect(values[storageKey]).toEqual({ "chrome:SABA:2": snapshot("chrome:SABA:2") });
  });
});
