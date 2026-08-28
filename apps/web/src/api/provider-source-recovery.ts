import type { RecoverableProvider, ProviderRecoveryMode } from "../watch/provider-source-recovery.js";

export interface ProviderSourceRecoveryApiLike {
  recover(provider: RecoverableProvider, mode: ProviderRecoveryMode): Promise<void>;
}

export class ProviderSourceRecoveryApi implements ProviderSourceRecoveryApiLike {
  readonly #fetch: typeof fetch;

  constructor(fetcher: typeof fetch = window.fetch.bind(window)) {
    this.#fetch = fetcher;
  }

  async recover(provider: RecoverableProvider, mode: ProviderRecoveryMode): Promise<void> {
    if (mode === "MANUAL") return this.#hardRefresh(provider);
    try {
      await this.#requestFreshSnapshot(provider);
    } catch (error) {
      if (provider === "SBOBET") throw error;
      await this.#hardRefresh(provider);
    }
  }

  async #requestFreshSnapshot(provider: RecoverableProvider): Promise<void> {
    const sourcesResponse = await this.#fetch("/api/chrome-bridge/sources", { method: "GET", cache: "no-store" });
    if (!sourcesResponse.ok) throw await responseError(sourcesResponse, "SOURCE_DISCOVERY_FAILED");
    const sources = bridgeSources(await sourcesResponse.json());
    const acceptedLobbies = new Set(providerLobbies(provider));
    const source = sources.filter((candidate) => (candidate.state === "LIVE" || candidate.state === "STALE") &&
      acceptedLobbies.has(candidate.lobby)).sort((left, right) =>
        right.lastAcceptedAtMs - left.lastAcceptedAtMs)[0];
    if (source === undefined) throw new Error("SOURCE_NOT_ATTACHED");

    const response = await this.#fetch("/api/chrome-bridge/request-snapshot", {
      method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: source.sourceId, timeoutMs: 10_000 })
    });
    if (!response.ok) throw await responseError(response, "SOURCE_RECOVERY_FAILED");
    const result = await response.json() as unknown;
    if (!freshBaselineConfirmation(result, source.sourceId)) {
      throw new Error("FRESH_BASELINE_NOT_CONFIRMED");
    }
  }

  async #hardRefresh(provider: RecoverableProvider): Promise<void> {
    const response = await this.#fetch(`/api/maintenance/refresh-provider/${provider}`, {
      method: "POST", cache: "no-store"
    });
    if (!response.ok) throw await responseError(response, "SOURCE_RECOVERY_FAILED");
    const value = await response.json() as unknown;
    if (!isObject(value) || value.provider !== provider || typeof value.requested !== "number" ||
      value.requested < 1) throw new Error("FRESH_BASELINE_NOT_CONFIRMED");
  }
}

interface BridgeSource {
  readonly lobby: string;
  readonly sourceId: string;
  readonly state: string;
  readonly lastAcceptedAtMs: number;
}

function providerLobbies(provider: RecoverableProvider): readonly string[] {
  if (provider === "SBOBET") return ["KSPORT", "SBO"];
  if (provider === "APSPORT") return ["TSPORT"];
  return [provider];
}

function bridgeSources(value: unknown): readonly BridgeSource[] {
  if (!isObject(value) || !Array.isArray(value.sources)) throw new Error("INVALID_SOURCE_RESPONSE");
  return value.sources.flatMap((source): BridgeSource[] => {
    if (!isObject(source) || typeof source.lobby !== "string" || typeof source.sourceId !== "string" ||
      typeof source.state !== "string" || typeof source.lastAcceptedAtMs !== "number") return [];
    return [{ lobby: source.lobby, sourceId: source.sourceId, state: source.state,
      lastAcceptedAtMs: source.lastAcceptedAtMs }];
  });
}

function freshBaselineConfirmation(value: unknown, sourceId: string): boolean {
  if (!isObject(value) || value.sourceId !== sourceId || value.requested !== 1 || !isObject(value.baseline)) return false;
  return typeof value.baseline.sourceEpoch === "string" &&
    typeof value.baseline.activeGeneration === "string" &&
    typeof value.baseline.lastCompleteBaselineAtMs === "number";
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    const value = await response.json() as unknown;
    if (isObject(value) && typeof value.error === "string") return new Error(value.error);
  } catch { /* malformed error body falls back to the stable client code */ }
  return new Error(fallback);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
