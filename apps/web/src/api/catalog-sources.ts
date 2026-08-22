import { CatalogSourceStatusSchema, type CatalogSourceStatus } from "@tool-chenh/contracts";

export interface CatalogSourceApiLike {
  list(): Promise<readonly CatalogSourceStatus[]>;
}

export class CatalogSourceApi implements CatalogSourceApiLike {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(fetcher: typeof fetch = window.fetch.bind(window), timeoutMs = 2_500) {
    this.#fetch = fetcher;
    this.#timeoutMs = timeoutMs;
  }

  async list(): Promise<readonly CatalogSourceStatus[]> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch("/api/catalog/sources", {
        method: "GET", cache: "no-store", signal: controller.signal
      });
      if (!response.ok) throw new Error(`Catalog source request failed (${response.status})`);
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        if (controller.signal.aborted) throw new Error("Catalog source request timed out");
        throw new Error("Invalid catalog source response");
      }
      if (typeof value !== "object" || value === null || !("sources" in value)) {
        throw new Error("Invalid catalog source response");
      }
      const parsed = CatalogSourceStatusSchema.array().safeParse((value as { sources: unknown }).sources);
      if (!parsed.success) throw new Error("Invalid catalog source response");
      return parsed.data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Catalog source request timed out");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
