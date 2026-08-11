import { normalizeImLolRecords, type ImEsportsMarketRecord } from "@tool-chenh/adapters";
import type { ActiveAccountAccess, ObservedProviderCatalog } from "../cmd/cmd-observed-catalog.js";

export class ImEsportsObservedCatalogReader {
  readonly provider = "IM" as const;
  readonly #accounts: ActiveAccountAccess;
  readonly #source: { readCatalog(input: { sessionId: string; launchUrl: string }): Promise<readonly ImEsportsMarketRecord[]> };
  readonly #clock: { now(): { wallClockNowMs: number; monotonicNowMs: number } };
  readonly #sequences = new Map<string, number>();

  constructor(options: {
    readonly accounts: ActiveAccountAccess;
    readonly source: { readCatalog(input: { sessionId: string; launchUrl: string }): Promise<readonly ImEsportsMarketRecord[]> };
    readonly clock: { now(): { wallClockNowMs: number; monotonicNowMs: number } };
  }) { this.#accounts = options.accounts; this.#source = options.source; this.#clock = options.clock; }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    const records = await this.#accounts.withActiveHandle(accountId, "IM", async (handle) =>
      handle.withSecret(async (secret) => {
        if (secret.kind !== "LAUNCH_URL") throw new Error("IM_ESPORTS_CATALOG_UNAVAILABLE");
        return this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
      }));
    const now = this.#clock.now();
    const sequence = (this.#sequences.get(accountId) ?? 0) + 1;
    const normalized = normalizeImLolRecords(records, { receivedMonotonicMs: now.monotonicNowMs, sequence });
    if (normalized.events.length === 0 || normalized.markets.length === 0) throw new Error("IM_ESPORTS_CATALOG_SCHEMA_ERROR");
    this.#sequences.set(accountId, sequence);
    return {
      dataMode: "LIVE", accountId, provider: "IM", category: "LOL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: now.wallClockNowMs,
      rejectedMarketCount: normalized.diagnostics.filter((item) => item.endsWith("MARKET_REJECTED")).length,
      events: normalized.events, markets: normalized.markets, quotes: normalized.quotes
    };
  }
}
