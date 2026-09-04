import { describe, expect, it, vi } from "vitest";
import { bootstrapCatalogSources, refreshBootstrapCatalogSources } from "./bootstrap-catalog-refresh.js";

describe("bootstrapCatalogSources", () => {
  it("asks only the books whose full list arrives once, at page bootstrap", () => {
    expect(bootstrapCatalogSources([
      { lobby: "SABA", tabId: 4 }, { lobby: "CMD", tabId: 5 },
      { lobby: "IM", tabId: 6 }, { lobby: "BTI", tabId: 7 }, { lobby: "TSPORT", tabId: 8 }
    ])).toEqual([
      { lobby: "SABA", tabId: 4, sourceId: "chrome:SABA:4" },
      { lobby: "IM", tabId: 6, sourceId: "chrome:IM:6" },
      { lobby: "TSPORT", tabId: 8, sourceId: "chrome:TSPORT:8" }
    ]);
  });

  it("starts APSPORT bootstrap without waiting for another provider's slow recovery", async () => {
    let releaseSaba!: () => void;
    const sabaBlocked = new Promise<void>((resolve) => { releaseSaba = resolve; });
    const started: string[] = [];
    const refresh = vi.fn(async (source: { readonly sourceId: string }) => {
      started.push(source.sourceId);
      if (source.sourceId === "chrome:SABA:4") await sabaBlocked;
    });
    const sources = bootstrapCatalogSources([
      { lobby: "SABA", tabId: 4 }, { lobby: "IM", tabId: 6 }, { lobby: "TSPORT", tabId: 8 }
    ]);

    const operation = refreshBootstrapCatalogSources(sources, refresh);
    await vi.waitFor(() => expect(started).toContain("chrome:TSPORT:8"));
    releaseSaba();
    await operation;

    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("asks a tab once however many times it is listed", () => {
    expect(bootstrapCatalogSources([{ lobby: "SABA", tabId: 4 }, { lobby: "SABA", tabId: 4 }]))
      .toEqual([{ lobby: "SABA", tabId: 4, sourceId: "chrome:SABA:4" }]);
  });

  it("asks nothing when no such book is attached", () => {
    expect(bootstrapCatalogSources([{ lobby: "CMD", tabId: 1 }])).toEqual([]);
    expect(bootstrapCatalogSources([])).toEqual([]);
  });
});
