import { CatalogSourceStatusSchema, type CatalogSourceStatus } from "@tool-chenh/contracts";

export interface CatalogSourceApiLike {
  list(): Promise<readonly CatalogSourceStatus[]>;
}

export class CatalogSourceApi implements CatalogSourceApiLike {
  readonly #fetch: typeof fetch;

  constructor(fetcher: typeof fetch = window.fetch.bind(window)) {
    this.#fetch = fetcher;
  }

  async list(): Promise<readonly CatalogSourceStatus[]> {
    const response = await this.#fetch("/api/catalog/sources", { method: "GET", cache: "no-store" });
    if (!response.ok) throw new Error(`Catalog source request failed (${response.status})`);
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error("Invalid catalog source response");
    }
    if (typeof value !== "object" || value === null || !("sources" in value)) {
      throw new Error("Invalid catalog source response");
    }
    const parsed = CatalogSourceStatusSchema.array().safeParse((value as { sources: unknown }).sources);
    if (!parsed.success) throw new Error("Invalid catalog source response");
    return parsed.data;
  }
}
