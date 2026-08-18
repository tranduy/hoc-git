import {
  normalizeObservedFootballCatalog,
  type CmdCatalogInputRecord
} from "@tool-chenh/adapters";
import type {
  Category,
  ProviderId,
  ProviderEvent,
  ProviderMarket,
  ProviderQuote
} from "@tool-chenh/contracts";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { CmdFootballCatalogSnapshot } from "./cmd-browser-manager.js";

export interface ObservedProviderCatalog {
  readonly dataMode: "LIVE";
  readonly accountId: string;
  readonly provider: ProviderId;
  readonly category: "FOOTBALL" | "LOL";
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
    provider: ProviderId,
    consume: (handle: ActiveSecretHandle) => Promise<T>,
    expectedCategory?: Category
  ): Promise<T>;
}

export interface CmdObservedCatalogReaderOptions {
  readonly provider?: ProviderId;
  readonly accounts?: ActiveAccountAccess;
  readonly source?: {
    readCatalog(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly CmdCatalogInputRecord[]>;
  };
  readonly jitSource?: {
    readCatalogFromFabet(): Promise<CmdFootballCatalogSnapshot>;
  };
  readonly clock: { now(): { readonly wallClockNowMs: number; readonly monotonicNowMs: number } };
  readonly timezoneOffsetMinutes: number;
}

export class CmdObservedCatalogReader {
  readonly provider: ProviderId;
  readonly #accounts: ActiveAccountAccess | null;
  readonly #source: NonNullable<CmdObservedCatalogReaderOptions["source"]> | null;
  readonly #jitSource: NonNullable<CmdObservedCatalogReaderOptions["jitSource"]> | null;
  readonly #clock: CmdObservedCatalogReaderOptions["clock"];
  readonly #timezoneOffsetMinutes: number;
  readonly #provider: ProviderId;
  readonly #sequences = new Map<string, number>();

  constructor(options: CmdObservedCatalogReaderOptions) {
    if (!Number.isFinite(options.timezoneOffsetMinutes) ||
      (options.jitSource === undefined && (options.accounts === undefined || options.source === undefined))) {
      throw new Error("CMD_CATALOG_OPTIONS_INVALID");
    }
    this.#accounts = options.accounts ?? null;
    this.#source = options.source ?? null;
    this.#jitSource = options.jitSource ?? null;
    this.#clock = options.clock;
    this.#timezoneOffsetMinutes = options.timezoneOffsetMinutes;
    this.#provider = options.provider ?? "CMD";
    this.provider = this.#provider;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    let records: readonly CmdCatalogInputRecord[];
    let now: { readonly wallClockNowMs: number; readonly monotonicNowMs: number };
    if (this.#jitSource !== null) {
      try {
        const snapshot = await this.#jitSource.readCatalogFromFabet();
        records = snapshot.records;
        now = { wallClockNowMs: snapshot.observedAtMs, monotonicNowMs: snapshot.receivedMonotonicMs };
      } catch { throw new Error("CMD_CATALOG_UNAVAILABLE"); }
    } else {
      try {
        records = await this.#accounts!.withActiveHandle(accountId, this.#provider,
          async (handle) => handle.withSecret(async (secret) => {
            if (secret.kind !== "LAUNCH_URL") throw new Error("CMD_CATALOG_UNAVAILABLE");
            return this.#source!.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
          }), "FOOTBALL");
      } catch { throw new Error("CMD_CATALOG_UNAVAILABLE"); }
      now = this.#clock.now();
    }
    if (records.length === 0) throw new Error("CMD_CATALOG_UNAVAILABLE");
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
      const eventOnly = normalizeObservedFootballCatalog(this.#provider, [{ ...record, groups: [] }], normalizationOptions);
      if (eventOnly.diagnostics.length > 0 || eventOnly.events.length !== 1) {
        rejectedMarketCount += Math.max(1, record.groups.filter((group) =>
          group.betTypeIds.length === 1 && group.betTypeIds[0] === "1").length);
        continue;
      }
      events.push(eventOnly.events[0]!);
      for (const group of record.groups) {
        if (group.betTypeIds.length !== 1 || !["1", "3"].includes(group.betTypeIds[0]!)) continue;
        const marketOnly = normalizeObservedFootballCatalog(this.#provider, [{ ...record, groups: [group] }], normalizationOptions);
        if (marketOnly.diagnostics.length > 0) {
          rejectedMarketCount += 1;
          continue;
        }
        const market = marketOnly.markets[0];
        if (market === undefined || (market.marketType !== "FT_AH" && market.marketType !== "FT_TOTAL")) continue;
        markets.push(market);
        quotes.push(...marketOnly.quotes);
      }
    }
    if (records.length > 0 && events.length === 0) throw new Error("CMD_CATALOG_SCHEMA_ERROR");
    this.#sequences.set(accountId, sequence);
    return {
      dataMode: "LIVE",
      accountId,
      provider: this.#provider,
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
