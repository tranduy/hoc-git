import {
  normalizeCmdCatalog,
  type CmdCatalogInputRecord
} from "@tool-chenh/adapters";
import type {
  ProviderEvent,
  ProviderMarket,
  ProviderQuote
} from "@tool-chenh/contracts";
import type { ActiveSecretHandle } from "../../sessions/types.js";

export interface ObservedProviderCatalog {
  readonly dataMode: "LIVE";
  readonly accountId: string;
  readonly provider: "CMD";
  readonly category: "FOOTBALL";
  readonly comparisonState: "AWAITING_SECOND_PROVIDER";
  readonly observedAtMs: number;
  readonly rejectedMarketCount: number;
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
}

export interface ActiveAccountAccess {
  withActiveHandle<T>(
    id: string,
    provider: "CMD",
    consume: (handle: ActiveSecretHandle) => Promise<T>
  ): Promise<T>;
}

export interface CmdObservedCatalogReaderOptions {
  readonly accounts: ActiveAccountAccess;
  readonly source: {
    readCatalog(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly CmdCatalogInputRecord[]>;
  };
  readonly clock: { now(): { readonly wallClockNowMs: number; readonly monotonicNowMs: number } };
  readonly timezoneOffsetMinutes: number;
}

export class CmdObservedCatalogReader {
  readonly #accounts: ActiveAccountAccess;
  readonly #source: CmdObservedCatalogReaderOptions["source"];
  readonly #clock: CmdObservedCatalogReaderOptions["clock"];
  readonly #timezoneOffsetMinutes: number;
  readonly #sequences = new Map<string, number>();

  constructor(options: CmdObservedCatalogReaderOptions) {
    if (!Number.isFinite(options.timezoneOffsetMinutes)) throw new Error("CMD_CATALOG_OPTIONS_INVALID");
    this.#accounts = options.accounts;
    this.#source = options.source;
    this.#clock = options.clock;
    this.#timezoneOffsetMinutes = options.timezoneOffsetMinutes;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    let records: readonly CmdCatalogInputRecord[];
    try {
      records = await this.#accounts.withActiveHandle(accountId, "CMD", async (handle) => handle.withSecret(async (secret) => {
        if (secret.kind !== "LAUNCH_URL") throw new Error("CMD_CATALOG_UNAVAILABLE");
        return this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
      }));
    } catch {
      throw new Error("CMD_CATALOG_UNAVAILABLE");
    }
    const now = this.#clock.now();
    const sequence = (this.#sequences.get(accountId) ?? 0) + 1;
    const normalizationOptions = {
      observedAtMs: now.wallClockNowMs,
      receivedMonotonicMs: now.monotonicNowMs,
      timezoneOffsetMinutes: this.#timezoneOffsetMinutes,
      sequence
    };
    const events: ProviderEvent[] = [];
    const markets: ProviderMarket[] = [];
    const quotes: ProviderQuote[] = [];
    let rejectedMarketCount = 0;
    for (const record of records) {
      const eventOnly = normalizeCmdCatalog([{ ...record, groups: [] }], normalizationOptions);
      if (eventOnly.diagnostics.length > 0 || eventOnly.events.length !== 1) {
        rejectedMarketCount += Math.max(1, record.groups.filter((group) =>
          group.betTypeIds.length === 1 && ["3", "5"].includes(group.betTypeIds[0]!)).length);
        continue;
      }
      events.push(eventOnly.events[0]!);
      for (const group of record.groups) {
        if (group.betTypeIds.length !== 1 || !["3", "5"].includes(group.betTypeIds[0]!)) continue;
        const marketOnly = normalizeCmdCatalog([{ ...record, groups: [group] }], normalizationOptions);
        if (marketOnly.diagnostics.length > 0) {
          rejectedMarketCount += 1;
          continue;
        }
        markets.push(...marketOnly.markets);
        quotes.push(...marketOnly.quotes);
      }
    }
    if (records.length > 0 && events.length === 0) throw new Error("CMD_CATALOG_SCHEMA_ERROR");
    this.#sequences.set(accountId, sequence);
    return {
      dataMode: "LIVE",
      accountId,
      provider: "CMD",
      category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER",
      observedAtMs: now.wallClockNowMs,
      rejectedMarketCount,
      events,
      markets,
      quotes
    };
  }
}
