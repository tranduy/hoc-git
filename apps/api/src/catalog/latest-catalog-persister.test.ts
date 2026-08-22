import { describe, expect, it, vi } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { LatestCatalogPersister } from "./latest-catalog-persister.js";

const catalog = (observedAtMs: number) => ({ observedAtMs } as ObservedProviderCatalog);

describe("LatestCatalogPersister", () => {
  it("keeps one write in flight and coalesces a burst to the latest catalog", async () => {
    let release: (() => void) | undefined;
    const save = vi.fn(async () => new Promise<void>((resolve) => { release = resolve; }));
    const persister = new LatestCatalogPersister({ save }, { minimumWriteGapMs: 0 });

    persister.schedule("SABA", catalog(1));
    persister.schedule("SABA", catalog(2));
    persister.schedule("SABA", catalog(3));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]).toEqual(["SABA", catalog(1)]);

    release?.();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual(["SABA", catalog(3)]);
  });
});
