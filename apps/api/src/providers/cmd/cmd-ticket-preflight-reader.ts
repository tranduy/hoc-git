import { normalizeObservedFootballCatalog, type CmdCatalogInputRecord } from "@tool-chenh/adapters";
import type { ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { toDecimal } from "@tool-chenh/core";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { ProviderTicketPreflightReader } from "../provider-capabilities.js";
import type { CmdFootballCatalogSnapshot } from "./cmd-browser-manager.js";

export interface CmdDirectPreflightSource {
  readCatalogFromFabet(): Promise<CmdFootballCatalogSnapshot>;
}

function plain(value: ReturnType<typeof toDecimal>): string { return value.toFixed(value.decimalPlaces()); }

export class CmdTicketPreflightReader implements ProviderTicketPreflightReader {
  readonly provider = "CMD" as const;
  readonly capabilities = ["PREFLIGHT"] as const;
  readonly #source: CmdDirectPreflightSource;
  readonly #timezoneOffsetMinutes: number;

  constructor(options: { readonly source: CmdDirectPreflightSource; readonly timezoneOffsetMinutes?: number }) {
    this.#source = options.source;
    this.#timezoneOffsetMinutes = options.timezoneOffsetMinutes ?? 420;
  }

  async preflight(handle: ActiveSecretHandle, request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight> {
    if (handle.provider !== "CMD" || handle.category !== "FOOTBALL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
    return handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("PREFLIGHT_ACCOUNT_UNAVAILABLE");
      const snapshot = await this.#source.readCatalogFromFabet();
      const normalized = normalizeObservedFootballCatalog("CMD", snapshot.records as readonly CmdCatalogInputRecord[], {
        observedAtMs: snapshot.observedAtMs, receivedMonotonicMs: snapshot.receivedMonotonicMs,
        timezoneOffsetMinutes: this.#timezoneOffsetMinutes, sequence: 1
      });
      const quote = normalized.quotes.find((candidate) => candidate.providerEventId === request.providerEventId &&
        candidate.providerMarketId === request.providerMarketId &&
        candidate.providerSelectionId === request.providerSelectionId && candidate.selection === request.selection &&
        candidate.line === request.line);
      if (quote === undefined) throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
      const decimalOdds = plain(toDecimal(quote.rawOdds, quote.rawFormat));
      const reasons: ProviderTicketPreflight["reasons"][number][] = ["LIMIT_UNAVAILABLE"];
      if (decimalOdds !== request.expectedDecimalOdds) reasons.push("ODDS_CHANGED");
      if (quote.status !== "OPEN") reasons.push("MARKET_NOT_OPEN");
      return { accountId: request.accountId, provider: "CMD", providerEventId: quote.providerEventId,
        providerMarketId: quote.providerMarketId, providerSelectionId: quote.providerSelectionId,
        selection: quote.selection, line: quote.line, rawOdds: quote.rawOdds, rawFormat: quote.rawFormat,
        decimalOdds, quoteStatus: quote.status, providerObservedAtMs: snapshot.observedAtMs,
        receivedMonotonicMs: quote.receivedMonotonicMs, sequence: quote.sequence,
        limitEvidence: null, constraint: null, eligible: false, reasons };
    });
  }
}
