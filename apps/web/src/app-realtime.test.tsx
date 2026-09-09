import { act, cleanup, render, screen } from "@testing-library/react";
import type { AppSnapshot, CatalogRevisionEntry } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogRealtimeFeed, SnapshotClientOptions } from "./api/client.js";

const clientHarness = vi.hoisted(() => ({ options: null as SnapshotClientOptions | null }));

vi.mock("./api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/client.js")>();
  return { ...actual, SnapshotClient: class {
    constructor(options: SnapshotClientOptions) { clientHarness.options = options; }
    async start(): Promise<void> { /* controlled by the test */ }
    stop(): void { /* controlled by the test */ }
  } };
});

vi.mock("./pages/live-catalog-page.js", () => ({
  LiveCatalogPage: ({ catalogRealtime }: { readonly catalogRealtime?: CatalogRealtimeFeed }) =>
    <output data-testid="catalog-feed">{JSON.stringify(catalogRealtime)}</output>
}));

import { App } from "./app.js";

const snapshot: AppSnapshot = {
  revision: 1, generatedAtMs: 1, providerStatuses: [],
  counts: { FOOTBALL: { events: 0, markets: 0 }, LOL: { events: 0, markets: 0 },
    mappings: { VERIFIED: 0, REVIEW_REQUIRED: 0, REJECTED: 0 }, opportunities: 0 },
  events: [], markets: [], opportunities: [], blockedDiagnostics: []
};

function entry(revision: string): CatalogRevisionEntry {
  return { accountId: "catalog-source:IM:FOOTBALL", revision, observedAtMs: 100, snapshotState: "FRESH" };
}

afterEach(() => {
  cleanup();
  clientHarness.options = null;
  window.history.replaceState({}, "", "/football-live");
});

describe("App catalog realtime epochs", () => {
  it("retains the strongest stale observation when later entries in a batch have older timestamps", () => {
    window.history.replaceState({}, "", "/football-live");
    render(<App initialSnapshot={snapshot} />);
    const options = clientHarness.options!;
    act(() => options.onCatalogBaseline?.([], 0));
    const strongest = { ...entry("stale-102"), observedAtMs: 102, snapshotState: "STALE" as const };
    const older = { ...strongest, revision: "stale-101", observedAtMs: 101 };
    const fresh = { ...entry("fresh-102"), observedAtMs: 102 };
    act(() => {
      options.onCatalogRevision?.(strongest, 1);
      options.onCatalogRevision?.(older, 2);
      options.onCatalogRevision?.(fresh, 3);
    });
    expect(JSON.parse(screen.getByTestId("catalog-feed").textContent!).revisions).toEqual([
      { entry: strongest, sequence: 1 }, { entry: fresh, sequence: 3 }
    ]);
  });

  it("preserves each account's stale invalidation when React batches a burst of newer revisions", () => {
    window.history.replaceState({}, "", "/football-live");
    render(<App initialSnapshot={snapshot} />);
    const options = clientHarness.options!;
    act(() => options.onCatalogBaseline?.([entry("im-initial")], 1));
    const stale = { ...entry("im-stale"), snapshotState: "STALE" as const };
    const bti = { ...entry("bti-fresh"), accountId: "catalog-source:BTI:FOOTBALL" };
    const im = { ...entry("im-new"), observedAtMs: 101 };
    act(() => {
      options.onCatalogRevision?.(stale, 2);
      options.onCatalogRevision?.(bti, 3);
      options.onCatalogRevision?.(im, 4);
    });
    expect(JSON.parse(screen.getByTestId("catalog-feed").textContent!).revisions).toEqual([
      { entry: stale, sequence: 2 }, { entry: bti, sequence: 3 }, { entry: im, sequence: 4 }
    ]);

    const newerIm = { ...im, revision: "im-newer", observedAtMs: 102 };
    act(() => options.onCatalogRevision?.(newerIm, 5));
    expect(JSON.parse(screen.getByTestId("catalog-feed").textContent!).revisions).toEqual([
      { entry: stale, sequence: 2 }, { entry: bti, sequence: 3 }, { entry: newerIm, sequence: 5 }
    ]);
    act(() => options.onCatalogBaseline?.([newerIm], 0));
    expect(JSON.parse(screen.getByTestId("catalog-feed").textContent!).revisions).toEqual([]);
  });

  it("drops the previous socket revision when a reconnect baseline arrives", () => {
    window.history.replaceState({}, "", "/football-live");
    render(<App initialSnapshot={snapshot} />);
    const options = clientHarness.options!;

    act(() => {
      options.onCatalogBaseline?.([entry("same-prices")], 499);
      options.onCatalogRevision?.(entry("old-change"), 500);
    });
    expect(JSON.parse(screen.getByTestId("catalog-feed").textContent!).revision.sequence).toBe(500);

    act(() => options.onCatalogBaseline?.([entry("same-prices")], 6));

    expect(JSON.parse(screen.getByTestId("catalog-feed").textContent!).revision).toBeNull();
  });
});
