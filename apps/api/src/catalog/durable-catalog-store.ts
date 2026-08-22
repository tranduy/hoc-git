import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ProviderEventSchema,
  ProviderMarketSchema,
  ProviderQuoteSchema
} from "@tool-chenh/contracts";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

const observedCatalogSchema = z.strictObject({
  dataMode: z.literal("LIVE"),
  accountId: z.string().trim().min(1).max(128),
  provider: z.enum(["FABET", "CMD", "SABA", "SBOBET", "APSPORT", "BTI", "IM"]),
  category: z.enum(["FOOTBALL", "LOL"]),
  comparisonState: z.literal("AWAITING_SECOND_PROVIDER"),
  observedAtMs: z.number().finite().nonnegative(),
  rejectedMarketCount: z.number().int().nonnegative(),
  events: z.array(z.unknown()),
  markets: z.array(z.unknown()),
  quotes: z.array(z.unknown())
});

function validateCatalog(value: unknown): ObservedProviderCatalog | null {
  const envelope = observedCatalogSchema.safeParse(value);
  if (!envelope.success ||
    envelope.data.events.some((event) => !ProviderEventSchema.safeParse(event).success) ||
    envelope.data.markets.some((market) => !ProviderMarketSchema.safeParse(market).success) ||
    envelope.data.quotes.some((quote) => !ProviderQuoteSchema.safeParse(quote).success)) return null;
  return envelope.data as ObservedProviderCatalog;
}

export interface CatalogStoreLike {
  load(sourceKey: string): Promise<ObservedProviderCatalog | null>;
  save(sourceKey: string, catalog: ObservedProviderCatalog): Promise<void>;
}

export class DurableCatalogStore implements CatalogStoreLike {
  readonly #root: string;

  constructor(root: string) {
    if (root.trim().length === 0) throw new Error("CATALOG_STORE_ROOT_INVALID");
    this.#root = resolve(root);
  }

  pathFor(sourceKey: string): string {
    const digest = createHash("sha256").update(sourceKey, "utf8").digest("hex");
    return join(this.#root, `${digest}.json`);
  }

  async load(sourceKey: string): Promise<ObservedProviderCatalog | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.pathFor(sourceKey), "utf8"));
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
      await writeFile(temporary, JSON.stringify(validated), { encoding: "utf8", flag: "wx" });
      await rename(temporary, target);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
