import { ProviderTicketPreflightRequestSchema, ProviderTicketPreflightSchema,
  type AccountStatus, type ProviderId, type ProviderTicketPreflight,
  type ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import type { ProviderTicketPreflightReader } from "../providers/provider-capabilities.js";
import type { ActiveSecretHandle } from "../sessions/types.js";

interface AccountAccess {
  listStatuses(): Promise<readonly AccountStatus[]>;
  withActiveHandle<T>(id: string, expectedProvider: ProviderId,
    consume: (handle: ActiveSecretHandle) => Promise<T>): Promise<T>;
}

export class ProviderPreflightRegistry {
  readonly #accounts: AccountAccess;
  readonly #readers: ReadonlyMap<ProviderId, ProviderTicketPreflightReader>;
  readonly #inflight = new Map<string, Promise<ProviderTicketPreflight>>();

  constructor(options: { readonly accounts: AccountAccess; readonly readers: readonly ProviderTicketPreflightReader[] }) {
    this.#accounts = options.accounts;
    this.#readers = new Map(options.readers.map((reader) => [reader.provider, reader]));
  }

  async providerForAccount(accountId: string): Promise<ProviderId> {
    const account = (await this.#accounts.listStatuses()).find((candidate) => candidate.id === accountId);
    if (account === undefined) throw new Error("PREFLIGHT_ACCOUNT_NOT_FOUND");
    if (account.sessionState !== "ACTIVE") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
    return account.provider;
  }

  async preflight(input: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    const request = ProviderTicketPreflightRequestSchema.parse(input);
    const key = JSON.stringify([request.accountId, request.providerEventId, request.providerMarketId,
      request.providerSelectionId, request.selection, request.line, request.expectedDecimalOdds, request.requestedStake]);
    const active = this.#inflight.get(key);
    if (active !== undefined) return active;
    const operation = this.#preflight(request);
    this.#inflight.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.#inflight.get(key) === operation) this.#inflight.delete(key);
    }
  }

  async #preflight(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    const provider = await this.providerForAccount(request.accountId);
    const reader = this.#readers.get(provider);
    if (reader === undefined || !reader.capabilities.includes("PREFLIGHT")) {
      throw new Error("PREFLIGHT_PROVIDER_UNSUPPORTED");
    }
    const result = await this.#accounts.withActiveHandle(request.accountId, provider,
      async (handle) => reader.preflight(handle, request));
    const parsed = ProviderTicketPreflightSchema.parse(result);
    if (parsed.accountId !== request.accountId || parsed.provider !== provider ||
      parsed.providerEventId !== request.providerEventId || parsed.providerMarketId !== request.providerMarketId ||
      parsed.providerSelectionId !== request.providerSelectionId || parsed.selection !== request.selection ||
      parsed.line !== request.line) throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
    return parsed;
  }
}
