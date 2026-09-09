import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogRevisionStore } from "../catalog/catalog-revision-store.js";
import { registerCatalogRoutes, type CatalogReaderLike } from "./catalog.js";
import type { CatalogStoreLike } from "../catalog/durable-catalog-store.js";

const accountId = "catalog-source:BTI:FOOTBALL";
const sourceKey = "catalog-source|BTI|FOOTBALL";
const url = `/api/catalog/accounts/${accountId}?nativeDetail=counts`;
const catalog = (observedAtMs = 100): ObservedProviderCatalog => ({
  dataMode: "LIVE", accountId, provider: "BTI", category: "FOOTBALL",
  comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs, rejectedMarketCount: 0,
  events: [], markets: [], quotes: [], nativeMarketObservations: []
});
const resources: { app: FastifyInstance; revisions: CatalogRevisionStore }[] = [];
afterEach(async () => {
  for (const { app, revisions } of resources.splice(0)) { revisions.close(); await app.close(); }
});
function setup(reader: CatalogReaderLike, store: CatalogStoreLike) {
  const app = Fastify();
  const revisions = new CatalogRevisionStore({ now: () => 200 });
  registerCatalogRoutes(app, { responseCacheMaxAgeMs: 10_000, sourceKey: async () => sourceKey, ...reader },
    undefined, undefined, store, revisions);
  resources.push({ app, revisions });
  return { app, revisions };
}

describe("catalog publication before disk restore", () => {
  it("serves an existing fresh publication and 304 without loading disk while keeping the collector scheduled", async () => {
    const read = vi.fn(async () => catalog());
    const load = vi.fn(async () => catalog(50));
    const { app, revisions } = setup({ responseCacheMaxAgeMs: 10, read }, { load, save: vi.fn(async () => {}) });
    const published = revisions.publish(accountId, catalog(), { snapshotState: "FRESH", freshnessMs: 10_000 });
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ observedAtMs: 100, snapshotState: "FRESH" });
    expect(load).not.toHaveBeenCalled();
    expect(revisions.get(accountId)).toBe(published);
    expect((await app.inject({ method: "GET", url, headers: { "if-none-match": String(response.headers.etag) } })).statusCode).toBe(304);
    await vi.waitFor(() => expect(read).toHaveBeenCalled(), { timeout: 200, interval: 10 });
    expect(load).not.toHaveBeenCalled();
  });

  it("serves stale published data without disk I/O and coalesces its pending refresh", async () => {
    let finish!: (value: ObservedProviderCatalog) => void;
    const pending = new Promise<ObservedProviderCatalog>(resolve => { finish = resolve; });
    const read = vi.fn(() => pending);
    const load = vi.fn(async () => catalog(50));
    const { app, revisions } = setup({ read }, { load, save: vi.fn(async () => {}) });
    revisions.publish(accountId, catalog(), { snapshotState: "STALE", freshnessMs: 10_000 });
    const first = await app.inject({ method: "GET", url });
    const second = await app.inject({ method: "GET", url });
    expect(first.json()).toMatchObject({ observedAtMs: 100, snapshotState: "STALE" });
    expect(second.json()).toMatchObject({ observedAtMs: 100, snapshotState: "STALE" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    finish(catalog(200));
  });

  it("still restores cold disk data as stale and schedules a fresh read when no publication exists", async () => {
    let finish!: (value: ObservedProviderCatalog) => void;
    const pending = new Promise<ObservedProviderCatalog>(resolve => { finish = resolve; });
    const read = vi.fn(() => pending);
    const load = vi.fn(async () => catalog(50));
    const { app } = setup({ read }, { load, save: vi.fn(async () => {}) });
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ observedAtMs: 50, snapshotState: "STALE" });
    expect(load).toHaveBeenCalledExactlyOnceWith(sourceKey);
    expect(read).toHaveBeenCalledTimes(1);
    finish(catalog(200));
  });

  it("uses a concurrent publication instead of overwriting it with an older pending restore", async () => {
    let finish!: (value: ObservedProviderCatalog) => void;
    const pending = new Promise<ObservedProviderCatalog>(resolve => { finish = resolve; });
    const load = vi.fn(() => pending);
    const read = vi.fn(async () => catalog(300));
    const { app, revisions } = setup({ read }, { load, save: vi.fn(async () => {}) });
    const first = app.inject({ method: "GET", url }).then(response => response);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    revisions.publish(accountId, catalog(200), { snapshotState: "FRESH", freshnessMs: 10_000 });
    finish(catalog(50));
    const response = await first;
    expect(response.json()).toMatchObject({ observedAtMs: 200, snapshotState: "FRESH" });
    expect(revisions.get(accountId)?.observedAtMs).toBe(200);
    expect(load).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });
});
