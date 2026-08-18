import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("isolates source keys and never exposes the key in its file name", async () => {
    const { root, value } = await store();
    await value.save("IM|LOL|secret-session", catalog("one"));
    await value.save("SABA|LOL|other-session", catalog("two"));
    await expect(value.load("IM|LOL|secret-session")).resolves.toMatchObject({ accountId: "one" });
    await expect(value.load("SABA|LOL|other-session")).resolves.toMatchObject({ accountId: "two" });
    const manifest = await readFile(join(root, "manifest.json"), "utf8").catch(() => "");
    expect(manifest).not.toContain("secret-session");
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
