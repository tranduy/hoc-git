import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ActiveAccountAccess, ObservedProviderCatalog } from "../cmd/cmd-observed-catalog.js";
import type { BtiCatalogSnapshot } from "./bti-browser-manager.js";

export interface BtiCatalogSource {
  readCatalog(input: { sessionId: string; launchUrl: string }): Promise<BtiCatalogSnapshot>;
}

export class BtiObservedCatalogReader {
  readonly provider = "BTI" as const;
  readonly #accounts: ActiveAccountAccess;
  readonly #source: BtiCatalogSource;
  readonly #sequences = new Map<string, number>();
  constructor(options: { accounts: ActiveAccountAccess; source: BtiCatalogSource }) { this.#accounts = options.accounts; this.#source = options.source; }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    const snapshot = await this.#accounts.withActiveHandle(accountId, "BTI", async (handle) =>
      handle.withSecret(async (secret) => {
        if (secret.kind !== "LAUNCH_URL") throw new Error("BTI_CATALOG_UNAVAILABLE");
        return this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
      }), "FOOTBALL");
    const sequence = (this.#sequences.get(accountId) ?? 0) + 1;
    const normalized = normalizeSbobetCatalog(snapshot.records, {
      observedAtMs: snapshot.observedAtMs, receivedMonotonicMs: snapshot.receivedMonotonicMs,
      sequence, provider: "BTI", settlementProfile: "football-regulation-including-added-time"
    });
    if (snapshot.records.length > 0 && normalized.events.length === 0) throw new Error("BTI_CATALOG_SCHEMA_ERROR");
    this.#sequences.set(accountId, sequence);
    return { dataMode: "LIVE", accountId, provider: "BTI", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: snapshot.observedAtMs,
      rejectedMarketCount: normalized.diagnostics.length, events: normalized.events, markets: normalized.markets, quotes: normalized.quotes };
  }
}
