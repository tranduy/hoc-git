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

  constructor(fetcher: typeof fetch = window.fetch.bind(window)) {
    this.#fetch = fetcher;
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
    const response = await this.#fetch(url, body === undefined ? {
      method: "GET",
      cache: "no-store"
    } : {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Account request failed (${response.status})`);
    try {
      return await response.json();
    } catch {
      throw new Error("Invalid account response");
    }
  }
}
