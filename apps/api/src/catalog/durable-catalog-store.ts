import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  NativeMarketObservationSchema,
  ProviderEventSchema,
  ProviderMarketSchema,
  ProviderQuoteSchema
} from "@tool-chenh/contracts";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { compactBtiNativeObservation } from "./bti-native-compaction.js";
import { readCatalogJson } from "./catalog-json-reader.js";

const observedCatalogSchema = z.strictObject({
  dataMode: z.literal("LIVE"),
  accountId: z.string().trim().min(1).max(128),
  provider: z.enum(["FABET", "CMD", "SABA", "SBOBET", "APSPORT", "BTI", "IM"]),
  category: z.enum(["FOOTBALL", "LOL"]),
  comparisonState: z.literal("AWAITING_SECOND_PROVIDER"),
  observedAtMs: z.number().finite().nonnegative(),
  observedMonotonicMs: z.number().finite().nonnegative().optional(),
  rejectedMarketCount: z.number().int().nonnegative(),
  events: z.array(z.unknown()),
  markets: z.array(z.unknown()),
  quotes: z.array(z.unknown()),
  nativeMarketObservations: z.array(z.unknown()).optional()
});

function validateCatalog(value: unknown): ObservedProviderCatalog | null {
  const envelope = observedCatalogSchema.safeParse(value);
  if (!envelope.success ||
    envelope.data.events.some((event) => !ProviderEventSchema.safeParse(event).success) ||
    envelope.data.markets.some((market) => !ProviderMarketSchema.safeParse(market).success) ||
    envelope.data.quotes.some((quote) => !ProviderQuoteSchema.safeParse(quote).success) ||
    envelope.data.nativeMarketObservations?.some((observation) =>
      !NativeMarketObservationSchema.safeParse(observation).success)) return null;
  const catalog = envelope.data as ObservedProviderCatalog;
  if (catalog.provider !== "BTI" || catalog.nativeMarketObservations === undefined) return catalog;
  return { ...catalog,
    nativeMarketObservations: catalog.nativeMarketObservations.map(compactBtiNativeObservation) };
}

function* serializedCatalog(catalog: ObservedProviderCatalog): Generator<string> {
  yield "{";
  let first = true;
  // writeFile consumes this iterator with backpressure. Keep only one small
  // array group serialized instead of a full JSON string plus its UTF-8 copy.
  for (const [key, value] of Object.entries(catalog)) {
    if (value === undefined) continue;
    if (!first) yield ",";
    first = false;
    yield JSON.stringify(key) + ":";
    if (!Array.isArray(value)) {
      yield JSON.stringify(value);
      continue;
    }
    yield "[";
    for (let index = 0; index < value.length; index += 128) {
      if (index > 0) yield ",";
      yield JSON.stringify(value.slice(index, index + 128)).slice(1, -1);
    }
    yield "]";
  }
  yield "}";
}

/**
 * A catalog is written to a uuid-suffixed temporary and renamed into place.
 * Both steps can be lost: the process can die between them, and on Windows a
 * failed rename is regularly followed by a failed unlink, because whatever
 * held the target open holds the temporary too. Either way the temporary is
 * orphaned and nothing ever looks at it again. Measured 2026-09-12: 4,187 of
 * them had built up against 36 real cache files, 10.5 GB against 516 MB, and
 * the system disk was down to its last 200 MB. Sweeping them is the only way
 * the store stays bounded, since the writer that leaked one is already gone.
 */
const TEMPORARY_STALE_AFTER_MS = 10 * 60_000;

/** Sweeping on every save would stat the whole directory every few seconds. */
export const TEMPORARY_SWEEP_INTERVAL_MS = 5 * 60_000;

export interface CatalogStoreLike {
  load(sourceKey: string): Promise<ObservedProviderCatalog | null>;
  save(sourceKey: string, catalog: ObservedProviderCatalog): Promise<void>;
}

export class DurableCatalogStore implements CatalogStoreLike {
  readonly #root: string;
  readonly #now: () => number;
  #sweptAtMs = 0;

  constructor(root: string, options: { readonly now?: () => number } = {}) {
    if (root.trim().length === 0) throw new Error("CATALOG_STORE_ROOT_INVALID");
    this.#root = resolve(root);
    this.#now = options.now ?? Date.now;
  }

  pathFor(sourceKey: string): string {
    const digest = createHash("sha256").update(sourceKey, "utf8").digest("hex");
    return join(this.#root, `${digest}.json`);
  }

  async load(sourceKey: string): Promise<ObservedProviderCatalog | null> {
    try {
      const parsed = await readCatalogJson(this.pathFor(sourceKey));
      return validateCatalog(parsed);
    } catch {
      return null;
    }
  }

  async save(sourceKey: string, catalog: ObservedProviderCatalog): Promise<void> {
    const validated = validateCatalog(catalog);
    if (validated === null) return;
    const target = this.pathFor(sourceKey);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.#root, { recursive: true });
      await writeFile(temporary, serializedCatalog(validated), { encoding: "utf8", flag: "wx" });
      await rename(temporary, target);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    await this.#sweepOrphanedTemporaries();
  }

  async #sweepOrphanedTemporaries(): Promise<void> {
    const nowMs = this.#now();
    if (nowMs - this.#sweptAtMs < TEMPORARY_SWEEP_INTERVAL_MS) return;
    this.#sweptAtMs = nowMs;
    let names: readonly string[];
    try { names = await readdir(this.#root); } catch { return; }
    for (const name of names) {
      if (!name.endsWith(".tmp")) continue;
      const candidate = join(this.#root, name);
      try {
        const stats = await stat(candidate);
        if (nowMs - stats.mtimeMs < TEMPORARY_STALE_AFTER_MS) continue;
        await rm(candidate, { force: true });
      } catch { /* a temporary that will not go now is swept on a later pass */ }
    }
  }
}
