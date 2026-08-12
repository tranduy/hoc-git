import {
  ProviderTicketPreflightRequestSchema,
  ProviderTicketPreflightSchema,
  type ProviderTicketPreflight,
  type ProviderTicketPreflightRequest
} from "@tool-chenh/contracts";

export interface ProviderPreflightApiLike {
  preflight(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight>;
}

export class ProviderPreflightApi implements ProviderPreflightApiLike {
  readonly #fetch: typeof fetch;

  constructor(fetcher: typeof fetch = window.fetch.bind(window)) {
    this.#fetch = fetcher;
  }

  async preflight(input: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    const request = ProviderTicketPreflightRequestSchema.safeParse(input);
    if (!request.success) throw new Error("Invalid provider preflight request");

    const response = await this.#fetch("/api/preflight/provider", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.data)
    });
    const value = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const error = typeof value === "object" && value !== null && "error" in value &&
        typeof (value as { error: unknown }).error === "string"
        ? (value as { error: string }).error : `Provider preflight failed (${response.status})`;
      throw new Error(error);
    }

    const parsed = ProviderTicketPreflightSchema.safeParse(value);
    if (!parsed.success) throw new Error("Invalid provider preflight response");
    return parsed.data;
  }
}

export const defaultProviderPreflightApi = new ProviderPreflightApi();
