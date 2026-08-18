import type { Category, ProviderId } from "@tool-chenh/contracts";
import type { CatalogSourceIdentity } from "../accounts/account-registry.js";
import type { ObservedProviderCatalog } from "./cmd/cmd-observed-catalog.js";
import type { SessionRecoveryRequest } from "../sessions/session-manager.js";

export interface ProviderCatalogReader {
  readonly provider: ProviderId;
  read(accountId: string): Promise<ObservedProviderCatalog>;
}

interface CatalogSourceResolver {
  resolveCatalogSource(accountId: string): Promise<CatalogSourceIdentity>;
}

export interface ProviderCatalogReaderRegistration {
  readonly provider: ProviderId;
  readonly category: Category;
  readonly reader: ProviderCatalogReader;
  readonly cancel?: () => Promise<void>;
}

function safeCatalogFailureReason(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const codes = current.message.match(/[A-Z][A-Z0-9_]{4,}/gu) ?? [];
    if (codes.length > 0) return codes.sort((left, right) => right.length - left.length)[0]!;
    if (/timed?\s*out/iu.test(current.message) || current.name === "TimeoutError") return "TIMEOUT";
    if (/(?:page|context|browser).*closed/iu.test(current.message)) return "PAGE_CLOSED";
    current = current.cause;
  }
  return "UNCLASSIFIED";
}

function authenticationSignal(error: unknown): SessionRecoveryRequest["signal"] | null {
  const reason = safeCatalogFailureReason(error);
  if (/(?:NOT_AUTHENTICATED|LOGIN_PAGE)/u.test(reason)) return { kind: "LOGIN_PAGE" };
  if (/(?:UNAUTHORIZED|AUTH_EXPIRED|HTTP_?401)/u.test(reason)) return { kind: "AUTH_EXPIRED", status: 401 };
  if (/HTTP_?403/u.test(reason)) return { kind: "AUTH_EXPIRED", status: 403 };
  if (/(?:SOURCE_EXPIRED|LAUNCH_EXPIRED|TOKEN_EXPIRED)/u.test(reason)) {
    return { kind: "TOKEN_EXPIRED", expiredAtMs: Date.now() };
  }
  return null;
}

export class MultiProviderCatalogReader {
  // The underlying browser readers normally need several seconds on a cold
  // page. Keep the HTTP request alive long enough for the first two priority
  // books, then serve their last verified snapshot while the next refresh is
  // running. Executable signals still require a separate short-lived
  // provider preflight; this cache only keeps the comparison surface visible.
  readonly requestTimeoutMs = 15_000;
  readonly responseCacheMaxAgeMs = 1_000;
  readonly snapshotFreshnessMaxAgeMs = 60_000;
  // Failed launches are cold. Keep healthy feeds at the one-second cadence,
  // but do not reopen an expired browser page every five seconds.
  readonly failureRetryBaseMs = 60_000;
  readonly failureRetryMaxMs = 600_000;
  readonly collectionTimeoutMs = 30_000;
  readonly #sources: CatalogSourceResolver;
  readonly #readers: ReadonlyMap<string, ProviderCatalogReaderRegistration>;
  readonly #onAuthenticationFailure: ((failure: SessionRecoveryRequest) => void | Promise<void>) | null;
  readonly #waiting: Array<() => void> = [];
  #activeReads = 0;
  // Keep one lane available after the two slowest browser sources have
  // occupied theirs. Otherwise a failed SABA/BTI session can starve every
  // healthy price source for tens of seconds.
  readonly #maxConcurrentReads = 1;

  constructor(options: {
    readonly sources: CatalogSourceResolver;
    readonly readers: readonly ProviderCatalogReaderRegistration[];
    readonly onAuthenticationFailure?: (failure: SessionRecoveryRequest) => void | Promise<void>;
  }) {
    this.#sources = options.sources;
    this.#readers = new Map(options.readers.map((registration) => [
      `${registration.provider}|${registration.category}`, registration
    ]));
    this.#onAuthenticationFailure = options.onAuthenticationFailure ?? null;
  }

  async sourceKey(accountId: string): Promise<string> {
    const logical = /^catalog-source:([^:]+):([^:]+)$/u.exec(accountId);
    if (logical !== null && this.#readers.has(`${logical[1]}|${logical[2]}`)) {
      return `catalog-source|${logical[1]}|${logical[2]}`;
    }
    return (await this.#sources.resolveCatalogSource(accountId)).key;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    await this.#acquire();
    let source: CatalogSourceIdentity | null = null;
    try {
      source = await this.#sources.resolveCatalogSource(accountId);
      const registration = this.#readers.get(`${source.provider}|${source.category}`);
      if (registration === undefined || registration.reader.provider !== source.provider) {
        throw new Error("CATALOG_UNAVAILABLE");
      }
      const catalog = await registration.reader.read(accountId);
      if (catalog.provider !== source.provider || catalog.category !== source.category || catalog.accountId !== accountId) {
        throw new Error("CATALOG_UNAVAILABLE");
      }
      return catalog;
    } catch (error) {
      const signal = authenticationSignal(error);
      if (signal !== null && source !== null && source.provider !== "CMD" && source.provider !== "FABET" &&
        this.#onAuthenticationFailure !== null) {
        void Promise.resolve(this.#onAuthenticationFailure({
          credentialSourceId: "fabet",
          providers: [source.provider],
          signal,
        })).catch(() => undefined);
      }
      process.stderr.write(`Catalog read failed: ${JSON.stringify({ accountId,
        reason: safeCatalogFailureReason(error) })}\n`);
      throw new Error("CATALOG_UNAVAILABLE");
    } finally {
      this.#release();
    }
  }

  async cancel(accountId: string): Promise<void> {
    const source = await this.#sources.resolveCatalogSource(accountId);
    await this.#readers.get(`${source.provider}|${source.category}`)?.cancel?.();
  }

  async restartAll(): Promise<void> {
    const results = await Promise.allSettled([...this.#readers.values()].map(async (registration) => {
      await registration.cancel?.();
    }));
    if (results.some((result) => result.status === "rejected")) throw new Error("READER_RESTART_FAILED");
  }

  #acquire(): Promise<void> {
    if (this.#activeReads < this.#maxConcurrentReads) {
      this.#activeReads += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.#waiting.push(() => {
      this.#activeReads += 1;
      resolve();
    }));
  }

  #release(): void {
    this.#activeReads -= 1;
    this.#waiting.shift()?.();
  }
}
