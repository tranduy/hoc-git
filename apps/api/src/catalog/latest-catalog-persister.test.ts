import { describe, expect, it, vi } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { LatestCatalogPersister } from "./latest-catalog-persister.js";

const catalog = (observedAtMs: number) => ({ observedAtMs } as ObservedProviderCatalog);

describe("LatestCatalogPersister", () => {
  it("keeps one write in flight and coalesces a burst to the latest catalog", async () => {
    let release: (() => void) | undefined;
    const save = vi.fn(async () => new Promise<void>((resolve) => { release = resolve; }));
    const persister = new LatestCatalogPersister({ save }, { minimumWriteGapMs: 0, minimumSourceIntervalMs: 0 });

    persister.schedule("SABA", catalog(1));
    persister.schedule("SABA", catalog(2));
    persister.schedule("SABA", catalog(3));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]).toEqual(["SABA", catalog(1)]);

    release?.();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual(["SABA", catalog(3)]);
  });

  it("writes a source at most once per interval and keeps only the newest", async () => {
    // Measured 2026-09-16 on the live stack: six catalogs rewritten in full
    // every minute, 356 MB of them, BTI alone 198 MB, with the API at 82% of a
    // core and the disk at 36%. Each save serialises a whole catalog, and a
    // save takes long enough that the gap between writes never applies.
    let nowMs = 1_000;
    const save = vi.fn(async () => undefined);
    const persister = new LatestCatalogPersister({ save },
      { minimumWriteGapMs: 0, minimumSourceIntervalMs: 60_000, now: () => nowMs });

    persister.schedule("SABA", catalog(1));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    persister.schedule("SABA", catalog(2));
    persister.schedule("SABA", catalog(3));
    nowMs += 59_000;
    persister.schedule("SABA", catalog(4));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(save).toHaveBeenCalledTimes(1);

    persister.schedule("CMD", catalog(5));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual(["CMD", catalog(5)]);

    nowMs += 2_000;
    persister.schedule("SABA", catalog(6));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(save.mock.calls[2]).toEqual(["SABA", catalog(6)]);
    persister.stop();
  });
});
