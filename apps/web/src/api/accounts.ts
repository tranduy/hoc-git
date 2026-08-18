import {
  AccountStatusSchema,
  type AccountStatus,
  type ProviderId
} from "@tool-chenh/contracts";

export interface AccountApiLike {
  list(): Promise<readonly AccountStatus[]>;
  register(input: { readonly sessionId: string; readonly alias: string; readonly provider: ProviderId }): Promise<AccountStatus>;
  refresh(id: string): Promise<AccountStatus>;
}

export class AccountApi implements AccountApiLike {
  readonly #fetch: typeof fetch;
  readonly #listTimeoutMs: number;
  readonly #mutationTimeoutMs: number;

  constructor(fetcher: typeof fetch = window.fetch.bind(window), listTimeoutMs = 2_500, mutationTimeoutMs = 15_000) {
    this.#fetch = fetcher;
    this.#listTimeoutMs = listTimeoutMs;
    this.#mutationTimeoutMs = mutationTimeoutMs;
  }

  async list(): Promise<readonly AccountStatus[]> {
    const value = await this.#request("/api/accounts");
    if (typeof value !== "object" || value === null || !("accounts" in value)) {
      throw new Error("Invalid account response");
    }
    const parsed = AccountStatusSchema.array().safeParse((value as { accounts: unknown }).accounts);
    if (!parsed.success) throw new Error("Invalid account response");
    return parsed.data;
  }

  async register(input: { readonly sessionId: string; readonly alias: string; readonly provider: ProviderId }): Promise<AccountStatus> {
    return this.#accountRequest("/api/accounts", input);
  }

  async refresh(id: string): Promise<AccountStatus> {
    return this.#accountRequest(`/api/accounts/${encodeURIComponent(id)}/refresh`, {});
  }

  async #accountRequest(url: string, body: object): Promise<AccountStatus> {
    const parsed = AccountStatusSchema.safeParse(await this.#request(url, body));
    if (!parsed.success) throw new Error("Invalid account response");
    return parsed.data;
  }

  async #request(url: string, body?: object): Promise<unknown> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), body === undefined
      ? this.#listTimeoutMs : this.#mutationTimeoutMs);
    try {
      const response = await this.#fetch(url, body === undefined ? {
        method: "GET", cache: "no-store", signal: controller.signal
      } : {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(`Account request failed (${response.status})`);
      try {
        return await response.json();
      } catch {
        if (controller.signal.aborted) throw new Error("Account request timed out");
        throw new Error("Invalid account response");
      }
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Account request timed out");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
