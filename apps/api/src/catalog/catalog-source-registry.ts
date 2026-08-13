import {
  CatalogSourceStatusSchema,
  type CatalogSourceStatus,
  type Category,
  type ProviderId,
  type RedactedSessionStatus,
  type SessionStatusList
} from "@tool-chenh/contracts";
import type { CatalogSourceIdentity } from "../accounts/account-registry.js";
import type { ActiveAccountAccess } from "../providers/cmd/cmd-observed-catalog.js";
import type { ActiveSecretHandle } from "../sessions/types.js";

type CatalogProvider = Exclude<ProviderId, "FABET">;
export type CatalogSourceStrategy = "TK88_CHROME" | "FABET_LOGIN" | "DIRECT_SESSION";

export interface SupportedCatalogPair {
  readonly provider: CatalogProvider;
  readonly category: Category;
  readonly alias: string;
  readonly strategy?: CatalogSourceStrategy;
  readonly anchorProvider?: string;
  readonly anchorCategory?: Category | null;
}

interface CatalogSessionAccess {
  listStatuses(): Promise<SessionStatusList>;
  getActiveSecretHandle(id: string): Promise<ActiveSecretHandle | null>;
}

interface CatalogAccountDelegate extends ActiveAccountAccess {
  resolveCatalogSource(id: string): Promise<CatalogSourceIdentity>;
}

function sourceId(pair: Pick<SupportedCatalogPair, "provider" | "category">): string {
  return `catalog-source:${pair.provider}:${pair.category}`;
}

function newest(sessions: readonly RedactedSessionStatus[]): RedactedSessionStatus | null {
  return [...sessions].sort((left, right) =>
    (right.acquiredAtMs ?? -1) - (left.acquiredAtMs ?? -1) || right.id.localeCompare(left.id))[0] ?? null;
}

function isPairAnchor(session: RedactedSessionStatus, pair: SupportedCatalogPair): boolean {
  const expectedSource = pair.strategy === "TK88_CHROME" ? "TK88_CHROME" :
    pair.strategy === "DIRECT_SESSION" ? "MANUAL_PROVIDER_SESSION" : "FABET_LOGIN";
  return session.source === expectedSource && session.provider === (pair.anchorProvider ?? pair.provider) &&
    session.category === (pair.anchorCategory === undefined ? pair.category : pair.anchorCategory);
}

export class CatalogSourceRegistry implements ActiveAccountAccess {
  readonly #sessions: CatalogSessionAccess;
  readonly #accounts: CatalogAccountDelegate;
  readonly #pairs: readonly SupportedCatalogPair[];
  readonly #pairsById: ReadonlyMap<string, SupportedCatalogPair>;
  #sessionCache: { readonly sessions: readonly RedactedSessionStatus[]; readonly expiresAtMs: number } | null = null;
  #sessionRead: Promise<readonly RedactedSessionStatus[]> | null = null;

  constructor(options: {
    readonly sessions: CatalogSessionAccess;
    readonly accounts: CatalogAccountDelegate;
    readonly supportedPairs: readonly SupportedCatalogPair[];
  }) {
    this.#sessions = options.sessions;
    this.#accounts = options.accounts;
    const pairs = options.supportedPairs.map((pair) => ({ ...pair, alias: pair.alias.trim() }));
    if (pairs.some((pair) => pair.alias.length === 0) || new Set(pairs.map(sourceId)).size !== pairs.length) {
      throw new Error("CATALOG_SOURCE_CONFIG_INVALID");
    }
    this.#pairs = pairs;
    this.#pairsById = new Map(pairs.map((pair) => [sourceId(pair), pair]));
  }

  async listStatuses(): Promise<readonly CatalogSourceStatus[]> {
    const sessions = await this.#sessionStatuses();
    return this.#pairs.map((pair) => {
      const exact = sessions.filter((candidate) => isPairAnchor(candidate, pair));
      const selected = newest(exact.filter((candidate) => candidate.state === "ACTIVE")) ?? newest(exact);
      return CatalogSourceStatusSchema.parse({
        id: sourceId(pair),
        alias: pair.alias,
        provider: pair.provider,
        category: pair.category,
        sessionState: selected?.state ?? "UNCONFIGURED",
        ...(selected === null ? {} : { sessionSource: selected.source }),
        acquiredAtMs: selected?.acquiredAtMs ?? null,
        reason: selected?.reason ?? null
      });
    });
  }

  async resolveCatalogSource(id: string): Promise<CatalogSourceIdentity> {
    const pair = this.#pairsById.get(id);
    if (pair === undefined) {
      if (id.startsWith("catalog-source:")) throw new Error("CATALOG_SOURCE_UNAVAILABLE");
      return this.#accounts.resolveCatalogSource(id);
    }
    const selected = await this.#resolveActive(pair);
    return {
      provider: pair.provider,
      category: pair.category,
      sessionId: selected.id,
      key: `catalog-source|${pair.provider}|${pair.category}`
    };
  }

  async withActiveHandle<T>(
    id: string,
    expectedProvider: ProviderId,
    consume: (handle: ActiveSecretHandle) => Promise<T>,
    expectedCategory?: Category
  ): Promise<T> {
    const pair = this.#pairsById.get(id);
    if (pair === undefined) {
      if (id.startsWith("catalog-source:")) throw new Error("CATALOG_SOURCE_UNAVAILABLE");
      return this.#accounts.withActiveHandle(id, expectedProvider, consume, expectedCategory);
    }
    if (pair.provider !== expectedProvider) throw new Error("ACCOUNT_PROVIDER_MISMATCH");
    if (expectedCategory !== undefined && pair.category !== expectedCategory) throw new Error("ACCOUNT_CATEGORY_MISMATCH");
    if (pair.strategy === "TK88_CHROME" || pair.anchorProvider !== undefined || pair.anchorCategory !== undefined) {
      throw new Error("CATALOG_SOURCE_HANDLE_UNAVAILABLE");
    }
    const selected = await this.#resolveActive(pair);
    const handle = await this.#sessions.getActiveSecretHandle(selected.id);
    if (handle === null || handle.provider !== pair.provider || handle.category !== pair.category) {
      throw new Error("CATALOG_SOURCE_UNAVAILABLE");
    }
    return consume(handle);
  }

  async #resolveActive(pair: SupportedCatalogPair): Promise<RedactedSessionStatus> {
    const selected = newest((await this.#sessionStatuses()).filter((candidate) =>
      isPairAnchor(candidate, pair) && candidate.state === "ACTIVE"));
    if (selected === null) throw new Error("CATALOG_SOURCE_UNAVAILABLE");
    return selected;
  }

  #sessionStatuses(): Promise<readonly RedactedSessionStatus[]> {
    const nowMs = performance.now();
    if (this.#sessionCache !== null && this.#sessionCache.expiresAtMs > nowMs) {
      return Promise.resolve(this.#sessionCache.sessions);
    }
    if (this.#sessionRead !== null) return this.#sessionRead;
    const operation = this.#sessions.listStatuses().then((result) => {
      this.#sessionCache = { sessions: result.sessions, expiresAtMs: performance.now() + 250 };
      return result.sessions;
    }).finally(() => { if (this.#sessionRead === operation) this.#sessionRead = null; });
    this.#sessionRead = operation;
    return operation;
  }
}
