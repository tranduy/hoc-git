import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ActiveAccountAccess, ObservedProviderCatalog } from "../cmd/cmd-observed-catalog.js";
import type { ApsportCatalogSnapshot } from "./apsport-browser-manager.js";

export interface ApsportCatalogSource {
  readCatalog(input: { sessionId: string; launchUrl: string }): Promise<ApsportCatalogSnapshot>;
}

export class ApsportObservedCatalogReader {
  readonly provider = "APSPORT" as const;
  readonly #accounts: ActiveAccountAccess;
  readonly #source: ApsportCatalogSource;
  readonly #sequences = new Map<string, number>();

  constructor(options: { accounts: ActiveAccountAccess; source: ApsportCatalogSource }) {
    this.#accounts = options.accounts;
    this.#source = options.source;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    const snapshot = await this.#accounts.withActiveHandle(accountId, "APSPORT", async (handle) =>
      handle.withSecret(async (secret) => {
        if (secret.kind !== "LAUNCH_URL") throw new Error("APSPORT_CATALOG_UNAVAILABLE");
        return this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
      }), "FOOTBALL");
    const sequence = (this.#sequences.get(accountId) ?? 0) + 1;
    const events: ObservedProviderCatalog["events"][number][] = [];
    const markets: ObservedProviderCatalog["markets"][number][] = [];
    const quotes: ObservedProviderCatalog["quotes"][number][] = [];
    let rejectedMarketCount = 0;
    for (const record of snapshot.records) {
      const eventOnly = normalizeSbobetCatalog([{ ...record, markets: [] }], {
        observedAtMs: snapshot.observedAtMs,
        receivedMonotonicMs: snapshot.receivedMonotonicMs,
        sequence,
        provider: "APSPORT",
        settlementProfile: "football-regulation-including-added-time"
      });
      if (eventOnly.events.length !== 1) { rejectedMarketCount += Math.max(1, record.markets.length); continue; }
      events.push(eventOnly.events[0]!);
      for (const market of record.markets) {
        const normalized = normalizeSbobetCatalog([{ ...record, markets: [market] }], {
          observedAtMs: snapshot.observedAtMs,
          receivedMonotonicMs: snapshot.receivedMonotonicMs,
          sequence,
          provider: "APSPORT",
          settlementProfile: "football-regulation-including-added-time"
        });
        if (normalized.markets.length !== 1) { rejectedMarketCount += 1; continue; }
        markets.push(normalized.markets[0]!);
        quotes.push(...normalized.quotes);
      }
    }
    if (snapshot.records.length > 0 && events.length === 0) throw new Error("APSPORT_CATALOG_SCHEMA_ERROR");
    this.#sequences.set(accountId, sequence);
    return {
      dataMode: "LIVE", accountId, provider: "APSPORT", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: snapshot.observedAtMs,
      rejectedMarketCount, events, markets, quotes
    };
  }
}
