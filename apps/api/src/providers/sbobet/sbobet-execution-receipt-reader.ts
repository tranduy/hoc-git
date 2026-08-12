import type { SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import type { PreflightLeg } from "@tool-chenh/contracts";
import { Decimal, toDecimal } from "@tool-chenh/core";
import type { ReceiptObservation, ReceiptReader } from "../../execution/receipt-reconciler.js";
import type { LiveLegResult } from "../../execution/live-two-leg-coordinator.js";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import type { DecodedSbobetReceipt } from "./sbobet-receipt-decoder.js";

interface Accounts {
  withActiveHandle<T>(id: string, provider: "SBOBET", consume: (handle: ActiveSecretHandle) => Promise<T>,
    category?: "FOOTBALL"): Promise<T>;
}

interface Source {
  readCatalog(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<{
    readonly records: readonly SbobetCatalogInputRecord[];
  } | readonly SbobetCatalogInputRecord[]>;
  readReceiptHistory(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly DecodedSbobetReceipt[]>;
}

function plain(value: Decimal): string { return value.toFixed(value.decimalPlaces()); }

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").replace(/đ/giu, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase("en");
}

function exactEvent(value: string, teams: readonly string[]): boolean {
  if (teams.length !== 2) return false;
  const parts = value.split(/\s+(?:vs?\.?|[-–—])\s+/iu).map(normalized);
  return parts.length === 2 && parts[0] === normalized(teams[0]!) && parts[1] === normalized(teams[1]!);
}

function exactMarket(receipt: DecodedSbobetReceipt, marketType: "FT_AH" | "FT_TOTAL" | "FT_1X2"): boolean {
  const name = normalized(receipt.marketDisplayName);
  const period = normalized(receipt.timePeriod).replaceAll(" ", "");
  if (!/^(?:ft|fulltime|toantran)$/u.test(period) && !/(?:full time|toan tran)/u.test(name)) return false;
  if (marketType === "FT_AH") return /(?:handicap|chap)/u.test(name);
  if (marketType === "FT_TOTAL") return /(?:over under|total|tai xiu)/u.test(name);
  return false;
}

function exactSelection(receipt: DecodedSbobetReceipt, selection: string, teams: readonly string[]): boolean {
  const name = normalized(receipt.selectionDisplayName);
  if (selection === "HOME") return name === normalized(teams[0]!);
  if (selection === "AWAY") return name === normalized(teams[1]!);
  if (selection === "OVER") return /^(?:over|tai)(?:\s|$)/u.test(name);
  if (selection === "UNDER") return /^(?:under|xiu)(?:\s|$)/u.test(name);
  return false;
}

function exactLine(receipt: DecodedSbobetReceipt, leg: PreflightLeg, marketType: string): boolean {
  if (leg.line === null) return receipt.points === "";
  try {
    const expected = marketType === "FT_AH" && leg.selection === "AWAY"
      ? new Decimal(leg.line).negated() : new Decimal(leg.line);
    return new Decimal(receipt.points).eq(expected);
  } catch { return false; }
}

function receiptDecimalOdds(receipt: DecodedSbobetReceipt): string | null {
  const style = normalized(receipt.oddsStyle).replaceAll(" ", "");
  const format = style === "malay" ? "MALAY" : style === "decimal" ? "DECIMAL"
    : style === "hongkong" || style === "hk" ? "HK" : null;
  if (format === null) return null;
  try { return plain(toDecimal(receipt.displayOdds, format)); } catch { return null; }
}

function status(receipt: DecodedSbobetReceipt): ReceiptObservation["status"] | null {
  const value = normalized(receipt.settlementStatus || receipt.status);
  if (["active", "settled", "unsettled"].includes(value)) return "ACCEPTED";
  if (["declined", "cancelled", "canceled", "unuccess", "unsuccess"].includes(value)) return "REJECTED";
  if (["pending", "awaiting"].includes(value)) return "PENDING";
  return null;
}

function records(value: Awaited<ReturnType<Source["readCatalog"]>>): readonly SbobetCatalogInputRecord[] {
  return "records" in value ? value.records : value;
}

export class SbobetExecutionReceiptReader implements ReceiptReader {
  readonly provider = "SBOBET" as const;
  readonly #accounts: Accounts;
  readonly #source: Source;

  constructor(options: { readonly accounts: Accounts; readonly source: Source }) {
    this.#accounts = options.accounts; this.#source = options.source;
  }

  async lookup(input: { readonly ticketId: string; readonly leg: PreflightLeg;
    readonly reported: LiveLegResult }): Promise<ReceiptObservation | null> {
    if (input.leg.provider !== "SBOBET") return null;
    return this.#accounts.withActiveHandle(input.leg.accountId, "SBOBET", async (handle) => handle.withSecret(
      async (secret) => {
        if (secret.kind !== "LAUNCH_URL") return null;
        const catalog = await this.#source.readCatalog({ sessionId: handle.sessionId, launchUrl: secret.value });
        const history = await this.#source.readReceiptHistory({ sessionId: handle.sessionId, launchUrl: secret.value });
        const event = records(catalog).find((candidate) => candidate.eventId === input.leg.providerEventId);
        const market = event?.markets.find((candidate) => candidate.marketId === input.leg.providerMarketId);
        const selection = market?.selections.find((candidate) =>
          candidate.selectionId === input.leg.providerSelectionId && candidate.selection === input.leg.selection);
        if (event === undefined || market === undefined || selection === undefined || market.marketType === "FT_1X2") return null;
        const matches = history.filter((receipt) => exactEvent(receipt.eventDisplayName, event.teamNames) &&
          exactMarket(receipt, market.marketType) && exactSelection(receipt, input.leg.selection, event.teamNames) &&
          exactLine(receipt, input.leg, market.marketType) && receiptDecimalOdds(receipt) === input.leg.decimalOdds &&
          new Decimal(receipt.totalStake).eq(input.leg.stake) && receipt.currency === input.leg.currency &&
          status(receipt) !== null);
        if (matches.length !== 1) return null;
        const match = matches[0]!; const state = status(match)!;
        return { provider: "SBOBET", accountId: input.leg.accountId,
          providerEventId: input.leg.providerEventId, providerMarketId: input.leg.providerMarketId,
          providerSelectionId: input.leg.providerSelectionId, selection: input.leg.selection, line: input.leg.line,
          decimalOdds: input.leg.decimalOdds, stake: input.leg.stake, currency: input.leg.currency,
          status: state, receiptId: state === "REJECTED" ? null : match.purchaseId };
      }), "FOOTBALL");
  }
}
