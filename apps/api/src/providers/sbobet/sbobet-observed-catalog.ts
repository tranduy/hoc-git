import { normalizeSbobetCatalog, type SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import type { ActiveAccountAccess, ObservedProviderCatalog } from "../cmd/cmd-observed-catalog.js";

interface SbobetSourceSnapshot {
  readonly records: readonly SbobetCatalogInputRecord[];
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

function isSourceSnapshot(value: readonly SbobetCatalogInputRecord[] | SbobetSourceSnapshot): value is SbobetSourceSnapshot {
  return !Array.isArray(value) && "records" in value;
}

export class SbobetObservedCatalogReader {
  readonly provider = "SBOBET" as const;
  readonly #accounts: ActiveAccountAccess;
  readonly #source: SbobetCatalogSource;
  readonly #clock: SbobetCatalogClock;
  readonly #sequences = new Map<string, number>();
  constructor(options: { accounts: ActiveAccountAccess; source: SbobetCatalogSource; clock: SbobetCatalogClock }) {
    this.#accounts = options.accounts; this.#source = options.source; this.#clock = options.clock;
  }
  async read(accountId: string): Promise<ObservedProviderCatalog> {
    const sourceResult = await this.#accounts.withActiveHandle(accountId, "SBOBET", async (handle) => handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("SBOBET_CATALOG_UNAVAILABLE");
      return this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
    }), "FOOTBALL");
    const now = this.#clock.now();
    const snapshot = isSourceSnapshot(sourceResult) ? sourceResult : null;
    const records = snapshot === null ? sourceResult as readonly SbobetCatalogInputRecord[] : snapshot.records;
    const sequence = (this.#sequences.get(accountId) ?? 0) + 1;
    const options = {
      observedAtMs: snapshot?.observedAtMs ?? now.wallClockNowMs,
      receivedMonotonicMs: snapshot?.receivedMonotonicMs ?? now.monotonicNowMs,
      sequence
    };
    const events: ObservedProviderCatalog["events"][number][] = [];
    const markets: ObservedProviderCatalog["markets"][number][] = [];
    const quotes: ObservedProviderCatalog["quotes"][number][] = [];
    let rejectedMarketCount = 0;
    for (const record of records) {
      const eventOnly = normalizeSbobetCatalog([{ ...record, markets: [] }], options);
      if (eventOnly.events.length !== 1) { rejectedMarketCount += Math.max(1, record.markets.length); continue; }
      events.push(eventOnly.events[0]!);
      for (const market of record.markets) {
        const one = normalizeSbobetCatalog([{ ...record, markets: [market] }], options);
        if (one.markets.length !== 1) { rejectedMarketCount += 1; continue; }
        markets.push(one.markets[0]!); quotes.push(...one.quotes);
      }
    }
    if (records.length > 0 && events.length === 0) throw new Error("SBOBET_CATALOG_SCHEMA_ERROR");
    this.#sequences.set(accountId, sequence);
    return { dataMode: "LIVE", accountId, provider: "SBOBET", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: options.observedAtMs,
      rejectedMarketCount, events, markets, quotes };
  }
}

interface SbobetCatalogSource {
  readCatalog(input: { sessionId: string; launchUrl: string }): Promise<readonly SbobetCatalogInputRecord[] | SbobetSourceSnapshot>;
}
interface SbobetCatalogClock { now(): { wallClockNowMs: number; monotonicNowMs: number } }
