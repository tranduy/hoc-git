import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { DurableCatalogStore } from "./durable-catalog-store.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function catalog(accountId = "account-1"): ObservedProviderCatalog {
  return {
    dataMode: "LIVE", accountId, provider: "IM", category: "LOL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1_000,
    rejectedMarketCount: 0, events: [], markets: [], quotes: []
  };
}

async function store(): Promise<{ root: string; value: DurableCatalogStore }> {
  const root = await mkdtemp(join(tmpdir(), "tool-chenh-catalog-"));
  roots.push(root);
  return { root, value: new DurableCatalogStore(root) };
}

describe("DurableCatalogStore", () => {
  it("atomically saves and restores a verified catalog by source key", async () => {
    const { value } = await store();
    await value.save("IM|LOL|session", catalog());
    await expect(value.load("IM|LOL|session")).resolves.toEqual(catalog());
  });

  it("preserves the explicit APSPORT observation clock pair without accepting an invalid anchor", async () => {
    const { value } = await store();
    const apsport = { ...catalog(), provider: "APSPORT" as const, category: "FOOTBALL" as const,
      observedMonotonicMs: 100.25 };
    await value.save("APSPORT|FOOTBALL|session", apsport);
    await expect(value.load("APSPORT|FOOTBALL|session")).resolves.toEqual(apsport);
    for (const invalid of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
      await value.save("APSPORT|FOOTBALL|session", { ...apsport, observedMonotonicMs: invalid });
      await expect(value.load("APSPORT|FOOTBALL|session")).resolves.toEqual(apsport);
    }
  });

  it("preserves BTI native observations and receipt times across a new store instance", async () => {
    const { root, value } = await store();
    const bti: ObservedProviderCatalog = { ...catalog("catalog-source:BTI:FOOTBALL"),
      provider: "BTI", category: "FOOTBALL", nativeMarketObservations: [{
        provider: "BTI", category: "FOOTBALL", providerEventId: "event", providerMarketId: "market",
        nativeType: "unknown", nativeLabel: null, nativeScope: null, outcomeLabels: [],
        observedAtMs: 900, disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED"
      }] };
    await value.save("BTI|FOOTBALL|session", bti);
    await expect(new DurableCatalogStore(root).load("BTI|FOOTBALL|session")).resolves.toEqual(bti);
    const malformed = { ...bti, nativeMarketObservations: [{ ...bti.nativeMarketObservations![0]!, token: "secret" }] };
    await value.save("BTI|FOOTBALL|session", malformed);
    await expect(value.load("BTI|FOOTBALL|session")).resolves.toEqual(bti);
    await writeFile(value.pathFor("BTI|FOOTBALL|session"), JSON.stringify(malformed));
    await expect(value.load("BTI|FOOTBALL|session")).resolves.toBeNull();
  });

  it("isolates source keys and never exposes the key in its file name", async () => {
    const { root, value } = await store();
    await value.save("IM|LOL|secret-session", catalog("one"));
    await value.save("SABA|LOL|other-session", catalog("two"));
    await expect(value.load("IM|LOL|secret-session")).resolves.toMatchObject({ accountId: "one" });
    await expect(value.load("SABA|LOL|other-session")).resolves.toMatchObject({ accountId: "two" });
    const manifest = await readFile(join(root, "manifest.json"), "utf8").catch(() => "");
    expect(manifest).not.toContain("secret-session");
  });

  it("writes a large catalog in bounded JSON pieces and restores every observation", async () => {
    const { value } = await store();
    const large: ObservedProviderCatalog = { ...catalog(), nativeMarketObservations: Array.from({ length: 1025 },
      (_, index) => ({ provider: "BTI", category: "FOOTBALL", providerEventId: "event",
        providerMarketId: `market-${index}`, nativeType: "unknown", nativeLabel: null, nativeScope: null,
        outcomeLabels: [], observedAtMs: 900, disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED" })) };
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      await value.save("BTI|FOOTBALL|large", large);
      const largestPiece = Math.max(...stringify.mock.results.map((result) =>
        result.type === "return" && typeof result.value === "string" ? result.value.length : 0));
      expect(largestPiece).toBeLessThan(64 * 1024);
    } finally { stringify.mockRestore(); }
    await expect(value.load("BTI|FOOTBALL|large")).resolves.toEqual(large);
  });

  it("fails soft for corrupt or schema-invalid persisted data", async () => {
    const { value } = await store();
    await value.save("IM|LOL|session", catalog());
    const path = value.pathFor("IM|LOL|session");
    await writeFile(path, JSON.stringify({ ...catalog(), provider: "NOT_A_PROVIDER" }), "utf8");
    await expect(value.load("IM|LOL|session")).resolves.toBeNull();
    await writeFile(path, "{broken", "utf8");
    await expect(value.load("IM|LOL|session")).resolves.toBeNull();
  });

  it("does not interrupt collection when persistence itself fails", async () => {
    const { root } = await store();
    const blocked = join(root, "blocked");
    await writeFile(blocked, "not a directory", "utf8");
    const value = new DurableCatalogStore(blocked);
    await expect(value.save("IM|LOL|session", catalog())).resolves.toBeUndefined();
    await expect(value.load("IM|LOL|session")).resolves.toBeNull();
  });
});
