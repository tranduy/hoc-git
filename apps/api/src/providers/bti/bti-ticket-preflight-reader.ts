import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { toDecimal } from "@tool-chenh/core";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ProviderTicketPreflightReader } from "../provider-capabilities.js";
import type { BtiCatalogSnapshot } from "./bti-browser-manager.js";

export interface BtiPreflightSource {
  readCatalog(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<BtiCatalogSnapshot>;
}

function plain(value: ReturnType<typeof toDecimal>): string { return value.toFixed(value.decimalPlaces()); }

export class BtiTicketPreflightReader implements ProviderTicketPreflightReader {
  readonly provider = "BTI" as const;
  readonly capabilities = ["PREFLIGHT"] as const;
  readonly #source: BtiPreflightSource;
  constructor(options: { readonly source: BtiPreflightSource }) { this.#source = options.source; }

  async preflight(handle: ActiveSecretHandle, request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    if (handle.provider !== "BTI" || handle.category !== "FOOTBALL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
      const snapshot = await this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
      const normalized = normalizeSbobetCatalog(snapshot.records, { provider: "BTI",
        settlementProfile: "football-regulation-including-added-time", observedAtMs: snapshot.observedAtMs,
        receivedMonotonicMs: snapshot.receivedMonotonicMs, sequence: 1 });
      const quote = normalized.quotes.find((candidate) => candidate.providerEventId === request.providerEventId &&
        candidate.providerMarketId === request.providerMarketId &&
        candidate.providerSelectionId === request.providerSelectionId && candidate.selection === request.selection &&
        candidate.line === request.line);
      if (quote === undefined) throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
      const decimalOdds = plain(toDecimal(quote.rawOdds, quote.rawFormat));
      const reasons: ProviderTicketPreflight["reasons"][number][] = ["LIMIT_UNAVAILABLE"];
      if (decimalOdds !== request.expectedDecimalOdds) reasons.push("ODDS_CHANGED");
      if (quote.status !== "OPEN") reasons.push("MARKET_NOT_OPEN");
      return { accountId: request.accountId, provider: "BTI", providerEventId: quote.providerEventId,
        providerMarketId: quote.providerMarketId, providerSelectionId: quote.providerSelectionId,
        selection: quote.selection, line: quote.line, decimalOdds, quoteStatus: quote.status,
        constraint: null, eligible: false, reasons };
    });
  }
}
